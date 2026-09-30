import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
} from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import {
  CurrentPrincipal,
  RequirePermissions,
} from "../../security/api-security.module";
import { CommunicationsModule } from "../communications/communications.module";
import { NotificationsService } from "../communications/notifications.service";
import {
  TransportTripMilestonesModule,
  TransportTripMilestoneService,
} from "./transport-trip-milestones.module";

const SAFE_ID = /^[A-Za-z0-9_.:-]{1,180}$/;
const CLIENT_EVENT_ID = /^[A-Za-z0-9_.:-]{8,180}$/;
const TRACKING_STATUSES = new Set(["EN_ROUTE", "ARRIVED", "TRANSPORTING"]);
const STOP_REASONS = new Set([
  "PROVIDER_STOPPED",
  "JOB_COMPLETED",
  "UNIT_CHANGED",
  "PRIVACY_STOP",
  "APP_SIGN_OUT",
]);

type StartTrackingBody = {
  shareWithPatient?: unknown;
};

type HeartbeatBody = {
  clientEventId?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  accuracyMeters?: unknown;
  headingDegrees?: unknown;
  speedKph?: unknown;
  capturedAt?: unknown;
};

type StopTrackingBody = {
  reason?: unknown;
};

@Injectable()
class TransportTelemetryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly notifications: NotificationsService,
    private readonly milestones: TransportTripMilestoneService,
  ) {}

  async providerStatus(principal: AuthPrincipal, requestIdRaw: string) {
    const context = await this.requireProviderRequest(principal, requestIdRaw, false);
    const session = await this.prisma.transportTrackingSession.findUnique({
      where: { transportRequestId: context.request.id },
    });
    return this.providerEnvelope(context.request, session);
  }

  async start(
    principal: AuthPrincipal,
    requestIdRaw: string,
    body: StartTrackingBody,
  ) {
    const context = await this.requireProviderRequest(principal, requestIdRaw, true);
    if (body.shareWithPatient !== true) {
      throw new BadRequestException(
        "shareWithPatient must be explicitly true to start vehicle location sharing.",
      );
    }
    if (!context.assignment?.transportUnitId || !context.unit) {
      throw new ConflictException(
        "Assign an active compatible transport unit before starting location sharing.",
      );
    }

    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + this.sessionTtlMinutes() * 60_000,
    );

    const session = await this.prisma.transportTrackingSession.upsert({
      where: { transportRequestId: context.request.id },
      create: {
        transportRequestId: context.request.id,
        providerId: context.provider.id,
        transportUnitId: context.unit.id,
        sharingStatus: "ACTIVE",
        shareWithPatient: true,
        startedByAccountId: principal.accountId,
        startedAt: now,
        lastHeartbeatAt: null,
        stoppedAt: null,
        stopReason: null,
        expiresAt,
      },
      update: {
        providerId: context.provider.id,
        transportUnitId: context.unit.id,
        sharingStatus: "ACTIVE",
        shareWithPatient: true,
        startedByAccountId: principal.accountId,
        startedAt: now,
        lastHeartbeatAt: null,
        stoppedAt: null,
        stopReason: null,
        expiresAt,
      },
    });

    await this.audit.write({
      actorId: principal.accountId,
      action: "MEDICAL_TRANSPORT_TRACKING_STARTED",
      objectType: "MEDICAL_TRANSPORT_REQUEST",
      objectId: context.request.id,
      purpose: "MEDICAL_TRANSPORT",
      result: "SUCCESS",
      metadata: {
        providerId: context.provider.id,
        transportUnitId: context.unit.id,
        shareWithPatient: true,
        sessionTtlMinutes: this.sessionTtlMinutes(),
      },
    });
    await this.notifyPatient(context.request.patientId, context.request.id, "tracking-started");
    await this.milestones.recordTrackingStarted({
      requestId: context.request.id,
      patientId: context.request.patientId,
      lifecycleStatus: context.request.status,
      providerId: context.provider.id,
      transportUnitId: context.unit.id,
      occurredAt: now,
    });
    await this.purgeExpiredTelemetry();

    return this.providerEnvelope(context.request, session);
  }

  async heartbeat(
    principal: AuthPrincipal,
    requestIdRaw: string,
    body: HeartbeatBody,
  ) {
    const context = await this.requireProviderRequest(principal, requestIdRaw, true);
    const clientEventId = this.clientEventId(body.clientEventId);
    const point = this.point(body);
    const capturedAt = this.capturedAt(body.capturedAt);

    const session = await this.prisma.transportTrackingSession.findUnique({
      where: { transportRequestId: context.request.id },
    });
    const now = new Date();
    if (
      !session ||
      session.providerId !== context.provider.id ||
      session.sharingStatus !== "ACTIVE" ||
      session.shareWithPatient !== true ||
      session.expiresAt.getTime() <= now.getTime()
    ) {
      throw new ConflictException(
        "Vehicle location sharing is not active for this transport request.",
      );
    }
    if (
      !context.assignment?.transportUnitId ||
      context.assignment.transportUnitId !== session.transportUnitId ||
      context.unit?.id !== session.transportUnitId
    ) {
      throw new ConflictException(
        "The assigned transport unit changed. Restart vehicle location sharing.",
      );
    }
    if (capturedAt.getTime() < session.startedAt.getTime() - 60_000) {
      throw new BadRequestException(
        "capturedAt cannot predate the active tracking session.",
      );
    }

    const existing = await this.prisma.transportUnitTelemetry.findUnique({
      where: { clientEventId },
    });
    if (existing) {
      if (
        existing.sessionId !== session.id ||
        existing.transportRequestId !== context.request.id ||
        existing.providerId !== context.provider.id
      ) {
        throw new ConflictException(
          "clientEventId was already used for different telemetry content.",
        );
      }
      const milestoneDetection = await this.milestones.detectFromHeartbeat({
        request: context.request,
        providerId: context.provider.id,
        transportUnitId: session.transportUnitId,
        latitude: Number(existing.latitude),
        longitude: Number(existing.longitude),
        accuracyMeters:
          existing.accuracyMeters == null ? null : Number(existing.accuracyMeters),
        capturedAt: existing.capturedAt,
      });
      return {
        replayed: true,
        telemetry: this.telemetry(existing),
        milestoneDetection,
        tracking: await this.providerEnvelope(context.request, session),
      };
    }

    const retentionExpiresAt = new Date(
      now.getTime() + this.retentionHours() * 60 * 60 * 1000,
    );
    const telemetry = await this.prisma.$transaction(async (tx) => {
      const currentSession = await tx.transportTrackingSession.findUnique({
        where: { id: session.id },
      });
      if (
        !currentSession ||
        currentSession.sharingStatus !== "ACTIVE" ||
        currentSession.shareWithPatient !== true ||
        currentSession.expiresAt.getTime() <= Date.now() ||
        currentSession.transportUnitId !== context.unit!.id
      ) {
        throw new ConflictException(
          "Vehicle location sharing changed before the heartbeat was accepted.",
        );
      }

      const created = await tx.transportUnitTelemetry.create({
        data: {
          sessionId: currentSession.id,
          transportRequestId: context.request.id,
          providerId: context.provider.id,
          transportUnitId: context.unit!.id,
          clientEventId,
          latitude: point.latitude,
          longitude: point.longitude,
          accuracyMeters: point.accuracyMeters,
          headingDegrees: point.headingDegrees,
          speedKph: point.speedKph,
          source: "PROVIDER_MOBILE_FOREGROUND",
          capturedAt,
          expiresAt: retentionExpiresAt,
        },
      });

      const nextHeartbeat =
        !currentSession.lastHeartbeatAt ||
        capturedAt.getTime() > currentSession.lastHeartbeatAt.getTime()
          ? capturedAt
          : currentSession.lastHeartbeatAt;
      await tx.transportTrackingSession.update({
        where: { id: currentSession.id },
        data: { lastHeartbeatAt: nextHeartbeat },
      });
      return created;
    });

    await this.audit.write({
      actorId: principal.accountId,
      action: "MEDICAL_TRANSPORT_TELEMETRY_RECEIVED",
      objectType: "MEDICAL_TRANSPORT_REQUEST",
      objectId: context.request.id,
      purpose: "MEDICAL_TRANSPORT",
      result: "SUCCESS",
      metadata: {
        providerId: context.provider.id,
        transportUnitId: context.unit.id,
        source: "PROVIDER_MOBILE_FOREGROUND",
        capturedAt: capturedAt.toISOString(),
        accuracyMeters: point.accuracyMeters,
        coordinateValuesExcludedFromAudit: true,
      },
    });

    const milestoneDetection = await this.milestones.detectFromHeartbeat({
      request: context.request,
      providerId: context.provider.id,
      transportUnitId: context.unit.id,
      latitude: point.latitude,
      longitude: point.longitude,
      accuracyMeters: point.accuracyMeters,
      capturedAt,
    });
    await this.purgeExpiredTelemetry();
    const refreshed = await this.prisma.transportTrackingSession.findUniqueOrThrow({
      where: { id: session.id },
    });
    return {
      replayed: false,
      telemetry: this.telemetry(telemetry),
      milestoneDetection,
      tracking: await this.providerEnvelope(context.request, refreshed),
    };
  }

  async stop(
    principal: AuthPrincipal,
    requestIdRaw: string,
    body: StopTrackingBody,
  ) {
    const context = await this.requireProviderRequest(principal, requestIdRaw, false);
    const reason = this.stopReason(body.reason);
    const session = await this.prisma.transportTrackingSession.findUnique({
      where: { transportRequestId: context.request.id },
    });
    if (!session || session.providerId !== context.provider.id) {
      return {
        requestId: context.request.id,
        sharingStatus: "NOT_STARTED",
        shareWithPatient: false,
      };
    }

    const stoppedAt = new Date();
    const updated = await this.prisma.transportTrackingSession.update({
      where: { id: session.id },
      data: {
        sharingStatus: "STOPPED",
        shareWithPatient: false,
        stoppedAt,
        stopReason: reason,
      },
    });

    await this.audit.write({
      actorId: principal.accountId,
      action: "MEDICAL_TRANSPORT_TRACKING_STOPPED",
      objectType: "MEDICAL_TRANSPORT_REQUEST",
      objectId: context.request.id,
      purpose: "MEDICAL_TRANSPORT",
      result: "SUCCESS",
      metadata: {
        providerId: context.provider.id,
        transportUnitId: session.transportUnitId,
        stopReason: reason,
      },
    });
    await this.notifyPatient(context.request.patientId, context.request.id, "tracking-stopped");
    await this.milestones.recordTrackingStopped({
      requestId: context.request.id,
      patientId: context.request.patientId,
      lifecycleStatus: context.request.status,
      providerId: context.provider.id,
      transportUnitId: session.transportUnitId,
      occurredAt: stoppedAt,
    });
    return this.providerEnvelope(context.request, updated);
  }

  async patientTracking(principal: AuthPrincipal, requestIdRaw: string) {
    const requestId = this.requiredId(requestIdRaw, "requestId");
    const patient = await this.prisma.patientProfile.findUnique({
      where: { userId: principal.accountId },
      select: { id: true },
    });
    if (!patient) throw new NotFoundException("Patient profile not found.");

    const request = await this.prisma.medicalTransportRequest.findFirst({
      where: { id: requestId, patientId: patient.id },
      select: {
        id: true,
        patientId: true,
        status: true,
        mode: true,
        etaMinutes: true,
        assignedProviderId: true,
      },
    });
    if (!request) throw new NotFoundException("Medical transport request not found.");

    const now = new Date();
    const session = await this.prisma.transportTrackingSession.findUnique({
      where: { transportRequestId: request.id },
    });
    const lifecycleActive = TRACKING_STATUSES.has(request.status);
    const sessionVisible =
      lifecycleActive &&
      session?.sharingStatus === "ACTIVE" &&
      session.shareWithPatient === true &&
      session.expiresAt.getTime() > now.getTime();

    if (!sessionVisible || !session) {
      return {
        requestId: request.id,
        visible: false,
        visibilityStatus: this.patientVisibilityStatus(request.status, session, now),
        trackingMode: "PROVIDER_DEVICE_FOREGROUND",
        routeEtaMinutes: request.etaMinutes,
        trackingPositionIsRouteEta: false,
        location: null,
      };
    }

    const latest = await this.prisma.transportUnitTelemetry.findFirst({
      where: {
        sessionId: session.id,
        capturedAt: { gte: session.startedAt },
        expiresAt: { gt: now },
      },
      orderBy: [{ capturedAt: "desc" }, { receivedAt: "desc" }],
    });
    if (!latest) {
      return {
        requestId: request.id,
        visible: false,
        visibilityStatus: "WAITING_FOR_HEARTBEAT",
        trackingMode: "PROVIDER_DEVICE_FOREGROUND",
        routeEtaMinutes: request.etaMinutes,
        trackingPositionIsRouteEta: false,
        location: null,
      };
    }

    const ageSeconds = this.ageSeconds(latest.capturedAt, now);
    await this.audit.write({
      actorId: principal.accountId,
      action: "PATIENT_TRANSPORT_TRACKING_READ",
      objectType: "MEDICAL_TRANSPORT_REQUEST",
      objectId: request.id,
      purpose: "MEDICAL_TRANSPORT",
      result: "SUCCESS",
      metadata: {
        freshness: this.freshness(ageSeconds),
        coordinateValuesExcludedFromAudit: true,
      },
    });

    return {
      requestId: request.id,
      visible: true,
      visibilityStatus: "AVAILABLE",
      trackingMode: "PROVIDER_DEVICE_FOREGROUND",
      routeEtaMinutes: request.etaMinutes,
      trackingPositionIsRouteEta: false,
      freshness: this.freshness(ageSeconds),
      ageSeconds,
      location: this.telemetry(latest),
    };
  }

  async operationsOverview(principal: AuthPrincipal) {
    const now = new Date();
    await this.purgeExpiredTelemetry();

    const sessions = await this.prisma.transportTrackingSession.findMany({
      where: {
        sharingStatus: "ACTIVE",
        shareWithPatient: true,
        expiresAt: { gt: now },
      },
      orderBy: { updatedAt: "desc" },
      take: 250,
    });
    const requestIds = sessions.map((row) => row.transportRequestId);
    const providerIds = [...new Set(sessions.map((row) => row.providerId))];
    const unitIds = [...new Set(sessions.map((row) => row.transportUnitId))];

    const [requests, providers, units, telemetryRows] = await Promise.all([
      requestIds.length
        ? this.prisma.medicalTransportRequest.findMany({
            where: { id: { in: requestIds } },
            select: {
              id: true,
              mode: true,
              status: true,
              etaMinutes: true,
              scheduledFor: true,
            },
          })
        : [],
      providerIds.length
        ? this.prisma.provider.findMany({
            where: { id: { in: providerIds } },
            select: { id: true, displayName: true },
          })
        : [],
      unitIds.length
        ? this.prisma.transportUnit.findMany({
            where: { id: { in: unitIds } },
            select: {
              id: true,
              code: true,
              registrationCode: true,
              mode: true,
              active: true,
            },
          })
        : [],
      sessions.length
        ? this.prisma.transportUnitTelemetry.findMany({
            where: {
              sessionId: { in: sessions.map((row) => row.id) },
              expiresAt: { gt: now },
            },
            orderBy: [{ capturedAt: "desc" }, { receivedAt: "desc" }],
            take: 4000,
          })
        : [],
    ]);

    const requestById = new Map(requests.map((row) => [row.id, row]));
    const providerById = new Map(providers.map((row) => [row.id, row]));
    const unitById = new Map(units.map((row) => [row.id, row]));
    const latestBySession = new Map<string, (typeof telemetryRows)[number]>();
    for (const row of telemetryRows) {
      if (!latestBySession.has(row.sessionId)) latestBySession.set(row.sessionId, row);
    }

    const items = sessions
      .map((session) => {
        const request = requestById.get(session.transportRequestId);
        if (!request || !TRACKING_STATUSES.has(request.status)) return null;
        const latest = latestBySession.get(session.id);
        const ageSeconds = latest ? this.ageSeconds(latest.capturedAt, now) : null;
        return {
          sessionId: session.id,
          requestId: session.transportRequestId,
          provider: providerById.get(session.providerId) ?? null,
          unit: unitById.get(session.transportUnitId) ?? null,
          request: {
            mode: request.mode,
            status: request.status,
            scheduledFor: request.scheduledFor,
            routeEtaMinutes: request.etaMinutes,
          },
          sharingStatus: session.sharingStatus,
          shareWithPatient: session.shareWithPatient,
          startedAt: session.startedAt,
          expiresAt: session.expiresAt,
          lastHeartbeatAt: session.lastHeartbeatAt,
          freshness: latest
            ? this.freshness(ageSeconds!)
            : "NO_HEARTBEAT",
          ageSeconds,
          location: latest ? this.telemetry(latest) : null,
          trackingPositionIsRouteEta: false,
        };
      })
      .filter((value): value is NonNullable<typeof value> => value !== null);

    await this.audit.write({
      actorId: principal.accountId,
      action: "ADMIN_TRANSPORT_TELEMETRY_READ",
      objectType: "TRANSPORT_FLEET_TELEMETRY",
      objectId: "ACTIVE",
      purpose: "TRANSPORT_OPERATIONS",
      result: "SUCCESS",
      metadata: {
        activeSessionCount: items.length,
        freshCount: items.filter((item) => item.freshness === "FRESH").length,
        staleCount: items.filter((item) => item.freshness === "STALE").length,
        coordinateValuesExcludedFromAudit: true,
      },
    });

    return {
      generatedAt: now.toISOString(),
      trackingMode: "PROVIDER_DEVICE_FOREGROUND",
      routeEtaIsSeparate: true,
      freshnessSeconds: this.freshSeconds(),
      retentionHours: this.retentionHours(),
      sessionTtlMinutes: this.sessionTtlMinutes(),
      summary: {
        activeSessions: items.length,
        fresh: items.filter((item) => item.freshness === "FRESH").length,
        stale: items.filter((item) => item.freshness === "STALE").length,
        noHeartbeat: items.filter((item) => item.freshness === "NO_HEARTBEAT").length,
      },
      items,
    };
  }

  private async providerEnvelope(request: any, session: any) {
    const now = new Date();
    if (!session) {
      return {
        requestId: request.id,
        lifecycleStatus: request.status,
        sharingStatus: "NOT_STARTED",
        shareWithPatient: false,
        trackingAllowed: TRACKING_STATUSES.has(request.status),
        trackingMode: "PROVIDER_DEVICE_FOREGROUND",
        routeEtaMinutes: request.etaMinutes ?? null,
        trackingPositionIsRouteEta: false,
        latest: null,
      };
    }
    const latest = await this.prisma.transportUnitTelemetry.findFirst({
      where: {
        sessionId: session.id,
        capturedAt: { gte: session.startedAt },
        expiresAt: { gt: now },
      },
      orderBy: [{ capturedAt: "desc" }, { receivedAt: "desc" }],
    });
    const expired = session.expiresAt.getTime() <= now.getTime();
    const active =
      session.sharingStatus === "ACTIVE" &&
      session.shareWithPatient === true &&
      !expired &&
      TRACKING_STATUSES.has(request.status);
    const ageSeconds = latest ? this.ageSeconds(latest.capturedAt, now) : null;
    return {
      requestId: request.id,
      lifecycleStatus: request.status,
      sessionId: session.id,
      transportUnitId: session.transportUnitId,
      sharingStatus: expired ? "EXPIRED" : session.sharingStatus,
      shareWithPatient: active,
      trackingAllowed: TRACKING_STATUSES.has(request.status),
      trackingMode: "PROVIDER_DEVICE_FOREGROUND",
      startedAt: session.startedAt,
      lastHeartbeatAt: session.lastHeartbeatAt,
      stoppedAt: session.stoppedAt,
      stopReason: session.stopReason,
      expiresAt: session.expiresAt,
      routeEtaMinutes: request.etaMinutes ?? null,
      trackingPositionIsRouteEta: false,
      freshness: latest ? this.freshness(ageSeconds!) : "NO_HEARTBEAT",
      ageSeconds,
      latest: latest ? this.telemetry(latest) : null,
    };
  }

  private async requireProviderRequest(
    principal: AuthPrincipal,
    requestIdRaw: string,
    requireActiveTrackingStatus: boolean,
  ) {
    const requestId = this.requiredId(requestIdRaw, "requestId");
    const provider = await this.prisma.provider.findUnique({
      where: { userId: principal.accountId },
      include: { otherProviderProfile: { include: { category: true } } },
    });
    const family = provider?.otherProviderProfile?.category.family;
    if (
      !provider ||
      provider.class !== "OTHER_PROVIDER" ||
      provider.status !== "ACTIVE" ||
      !provider.otherProviderProfile?.category.active ||
      (family !== "MEDICAL_TRANSPORT_GROUND" &&
        family !== "MEDICAL_TRANSPORT_AIR")
    ) {
      throw new ForbiddenException(
        "This account is not authorized for medical transport telemetry.",
      );
    }

    const request = await this.prisma.medicalTransportRequest.findFirst({
      where: {
        id: requestId,
        assignedProviderId: provider.id,
        mode: family === "MEDICAL_TRANSPORT_AIR" ? "AIR" : "GROUND",
      },
    });
    if (!request) {
      throw new NotFoundException("Assigned medical transport job not found.");
    }
    if (requireActiveTrackingStatus && !TRACKING_STATUSES.has(request.status)) {
      throw new ConflictException(
        "Vehicle location sharing is available only while the assigned transport is active.",
      );
    }

    const assignment = await this.prisma.crewAssignment.findFirst({
      where: {
        transportRequestId: request.id,
        providerId: provider.id,
      },
      orderBy: { revision: "desc" },
    });
    const unit = assignment?.transportUnitId
      ? await this.prisma.transportUnit.findFirst({
          where: {
            id: assignment.transportUnitId,
            providerId: provider.id,
            active: true,
            mode: request.mode,
          },
        })
      : null;

    return { provider, request, assignment, unit };
  }

  private telemetry(row: any) {
    return {
      id: row.id,
      transportUnitId: row.transportUnitId,
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      accuracyMeters:
        row.accuracyMeters == null ? null : Number(row.accuracyMeters),
      headingDegrees:
        row.headingDegrees == null ? null : Number(row.headingDegrees),
      speedKph: row.speedKph == null ? null : Number(row.speedKph),
      source: row.source,
      capturedAt: row.capturedAt,
      receivedAt: row.receivedAt,
      expiresAt: row.expiresAt,
    };
  }

  private point(body: HeartbeatBody) {
    const latitude = this.number(body.latitude, "latitude", -90, 90);
    const longitude = this.number(body.longitude, "longitude", -180, 180);
    const accuracyMeters = this.optionalNumber(
      body.accuracyMeters,
      "accuracyMeters",
      0,
      5000,
    );
    const headingDegrees = this.optionalNumber(
      body.headingDegrees,
      "headingDegrees",
      0,
      360,
    );
    const speedKph = this.optionalNumber(body.speedKph, "speedKph", 0, 300);
    return {
      latitude,
      longitude,
      accuracyMeters,
      headingDegrees,
      speedKph,
    };
  }

  private capturedAt(value: unknown) {
    if (typeof value !== "string") {
      throw new BadRequestException("capturedAt is required.");
    }
    const capturedAt = new Date(value);
    if (!Number.isFinite(capturedAt.getTime())) {
      throw new BadRequestException("capturedAt must be a valid ISO date-time.");
    }
    const now = Date.now();
    if (capturedAt.getTime() > now + 5 * 60_000) {
      throw new BadRequestException("capturedAt cannot be more than 5 minutes in the future.");
    }
    if (
      capturedAt.getTime() <
      now - this.maxCaptureAgeMinutes() * 60_000
    ) {
      throw new BadRequestException(
        "capturedAt is older than the accepted telemetry window.",
      );
    }
    return capturedAt;
  }

  private patientVisibilityStatus(status: string, session: any, now: Date) {
    if (!TRACKING_STATUSES.has(status)) return "TRANSPORT_NOT_ACTIVE";
    if (!session) return "NOT_STARTED";
    if (session.expiresAt.getTime() <= now.getTime()) return "EXPIRED";
    if (session.sharingStatus !== "ACTIVE" || session.shareWithPatient !== true) {
      return "STOPPED";
    }
    return "WAITING_FOR_HEARTBEAT";
  }

  private freshness(ageSeconds: number) {
    return ageSeconds <= this.freshSeconds() ? "FRESH" : "STALE";
  }

  private ageSeconds(from: Date, to: Date) {
    return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 1000));
  }

  private async purgeExpiredTelemetry() {
    await this.prisma.transportUnitTelemetry.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
  }

  private async notifyPatient(
    patientId: string,
    requestId: string,
    phase: string,
  ) {
    const patient = await this.prisma.patientProfile.findUnique({
      where: { id: patientId },
      select: { userId: true },
    });
    if (!patient?.userId) return;
    await this.notifications.notifyAccount({
      accountId: patient.userId,
      dedupeKey: `transport:${requestId}:${phase}`,
      type: "TRANSPORT_UPDATE",
      entityType: "MEDICAL_TRANSPORT_REQUEST",
      entityId: requestId,
      safeTitleKey: "notification.transport.title",
      safeBodyKey: "notification.transport.body",
    });
  }

  private sessionTtlMinutes() {
    return this.envInteger(
      "TRANSPORT_TRACKING_SESSION_TTL_MINUTES",
      480,
      30,
      1440,
    );
  }

  private retentionHours() {
    return this.envInteger(
      "TRANSPORT_TELEMETRY_RETENTION_HOURS",
      24,
      1,
      168,
    );
  }

  private freshSeconds() {
    return this.envInteger(
      "TRANSPORT_TELEMETRY_FRESH_SECONDS",
      90,
      15,
      600,
    );
  }

  private maxCaptureAgeMinutes() {
    return this.envInteger(
      "TRANSPORT_TELEMETRY_MAX_CAPTURE_AGE_MINUTES",
      10,
      1,
      60,
    );
  }

  private envInteger(
    name: string,
    fallback: number,
    min: number,
    max: number,
  ) {
    const value = Number(process.env[name]);
    return Number.isInteger(value) && value >= min && value <= max
      ? value
      : fallback;
  }

  private requiredId(value: unknown, field: string) {
    if (typeof value !== "string" || !SAFE_ID.test(value.trim())) {
      throw new BadRequestException(`${field} is invalid.`);
    }
    return value.trim();
  }

  private clientEventId(value: unknown) {
    if (typeof value !== "string" || !CLIENT_EVENT_ID.test(value.trim())) {
      throw new BadRequestException("clientEventId is invalid.");
    }
    return value.trim();
  }

  private stopReason(value: unknown) {
    if (value == null || value === "") return "PROVIDER_STOPPED";
    if (typeof value !== "string") {
      throw new BadRequestException("reason is invalid.");
    }
    const reason = value.trim().toUpperCase();
    if (!STOP_REASONS.has(reason)) {
      throw new BadRequestException("reason is invalid.");
    }
    return reason;
  }

  private number(
    value: unknown,
    field: string,
    min: number,
    max: number,
  ) {
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
      throw new BadRequestException(`${field} is invalid.`);
    }
    return parsed;
  }

  private optionalNumber(
    value: unknown,
    field: string,
    min: number,
    max: number,
  ) {
    if (value == null || value === "") return null;
    return this.number(value, field, min, max);
  }
}

@RequirePermissions("TRANSPORT_RESPOND")
@Controller("provider/medical-transport")
class ProviderTransportTelemetryController {
  constructor(private readonly service: TransportTelemetryService) {}

  @Get(":requestId/tracking")
  @Header("Cache-Control", "no-store")
  status(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("requestId") requestId: string,
  ) {
    return this.service.providerStatus(principal, requestId);
  }

  @Post(":requestId/tracking/start")
  @Header("Cache-Control", "no-store")
  start(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("requestId") requestId: string,
    @Body() body: StartTrackingBody,
  ) {
    return this.service.start(principal, requestId, body ?? {});
  }

  @Post(":requestId/tracking/heartbeat")
  @Header("Cache-Control", "no-store")
  heartbeat(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("requestId") requestId: string,
    @Body() body: HeartbeatBody,
  ) {
    return this.service.heartbeat(principal, requestId, body ?? {});
  }

  @Post(":requestId/tracking/stop")
  @Header("Cache-Control", "no-store")
  stop(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("requestId") requestId: string,
    @Body() body: StopTrackingBody,
  ) {
    return this.service.stop(principal, requestId, body ?? {});
  }
}

@RequirePermissions("PATIENT_TRANSPORT_REQUEST")
@Controller("medical-transport")
class PatientTransportTelemetryController {
  constructor(private readonly service: TransportTelemetryService) {}

  @Get(":requestId/tracking")
  @Header("Cache-Control", "no-store")
  tracking(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("requestId") requestId: string,
  ) {
    return this.service.patientTracking(principal, requestId);
  }
}

@RequirePermissions("TRANSPORT_OPERATE")
@Controller("admin/transport/telemetry")
class AdminTransportTelemetryController {
  constructor(private readonly service: TransportTelemetryService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  overview(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.service.operationsOverview(principal);
  }
}

@Module({
  imports: [CommunicationsModule, TransportTripMilestonesModule],
  controllers: [
    ProviderTransportTelemetryController,
    PatientTransportTelemetryController,
    AdminTransportTelemetryController,
  ],
  providers: [TransportTelemetryService],
})
export class TransportTelemetryModule {}
