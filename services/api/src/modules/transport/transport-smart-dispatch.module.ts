import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
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
  jsonStringArray,
  missingCurrentCredentialTypes,
} from "../../security/provider-credential-validity";
import {
  CurrentPrincipal,
  RequirePermissions,
} from "../../security/api-security.module";

const ACTIVE_STATUSES = [
  "REQUESTED",
  "ASSIGNED",
  "EN_ROUTE",
  "ARRIVED",
  "TRANSPORTING",
] as const;
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,180}$/;
const SAFE_CODE = /^[A-Z0-9_:-]{3,80}$/;

type Severity = "CRITICAL" | "WARNING" | "INFO";
type PriorityBand = "CRITICAL" | "HIGH" | "MEDIUM" | "NORMAL";
type Signal = {
  code: string;
  severity: Severity;
  title: string;
  detail: string;
  since: Date;
  recommendedAction:
    | "ASSIGN_PROVIDER"
    | "ASSIGN_RESOURCES"
    | "RECALCULATE_ETA"
    | "REVIEW_PROVIDER"
    | "REVIEW_INCIDENT"
    | "CONFIRM_PICKUP_ARRIVAL"
    | "CONFIRM_DESTINATION_HANDOFF"
    | "REVIEW_TELEMETRY"
    | "ADVANCE_OR_REVIEW_STATUS";
};

type ResolutionBody = {
  note?: unknown;
};

@Injectable()
export class TransportSmartDispatchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
  ) {}

  async overview(principal: AuthPrincipal) {
    const snapshot = await this.buildSnapshot();
    await this.audit.write({
      actorId: principal.accountId,
      action: "ADMIN_TRANSPORT_SMART_DISPATCH_READ",
      objectType: "TRANSPORT_SMART_DISPATCH",
      objectId: "ACTIVE",
      purpose: "TRANSPORT_OPERATIONS",
      result: "SUCCESS",
      metadata: {
        activeRequests: snapshot.summary.activeRequests,
        critical: snapshot.summary.critical,
        high: snapshot.summary.high,
        openEscalations: snapshot.summary.openEscalations,
        autoAssignmentPerformed: false,
      },
    });
    return snapshot;
  }

  async evaluate(principal: AuthPrincipal) {
    const now = new Date();
    const snapshot = await this.buildSnapshot(now);
    const persistable = snapshot.items.flatMap((item) =>
      item.signals
        .filter((signal) => signal.severity !== "INFO")
        .map((signal) => ({
          requestId: item.requestId,
          signal,
        })),
    );

    const existing = await this.prisma.transportOperationalEscalation.findMany({
      where: { status: { in: ["OPEN", "ACKNOWLEDGED", "RESOLVED"] } },
      orderBy: { updatedAt: "desc" },
      take: 5000,
    });
    const existingByKey = new Map(
      existing.map((row) => [this.key(row.transportRequestId, row.code), row]),
    );
    const currentKeys = new Set(
      persistable.map(({ requestId, signal }) => this.key(requestId, signal.code)),
    );

    let opened = 0;
    let reopened = 0;
    let updated = 0;
    for (const { requestId, signal } of persistable) {
      const key = this.key(requestId, signal.code);
      const prior = existingByKey.get(key);
      if (!prior) opened += 1;
      else if (prior.status === "RESOLVED") reopened += 1;
      else updated += 1;

      await this.prisma.transportOperationalEscalation.upsert({
        where: {
          transportRequestId_code: {
            transportRequestId: requestId,
            code: signal.code,
          },
        },
        create: {
          transportRequestId: requestId,
          code: signal.code,
          severity: signal.severity,
          status: "OPEN",
          recommendedAction: signal.recommendedAction,
          firstTriggeredAt: signal.since,
          lastTriggeredAt: now,
          occurrenceCount: 1,
        },
        update: {
          severity: signal.severity,
          status: prior?.status === "RESOLVED" ? "OPEN" : prior?.status ?? "OPEN",
          recommendedAction: signal.recommendedAction,
          lastTriggeredAt: now,
          occurrenceCount: { increment: 1 },
          ...(prior?.status === "RESOLVED"
            ? {
                acknowledgedAt: null,
                acknowledgedByAccountId: null,
                resolvedAt: null,
                resolvedByAccountId: null,
                resolutionNote: null,
                autoResolved: false,
              }
            : {}),
        },
      });
    }

    const unresolved = existing.filter(
      (row) => row.status !== "RESOLVED" && !currentKeys.has(this.key(row.transportRequestId, row.code)),
    );
    let autoResolved = 0;
    for (const row of unresolved) {
      const result = await this.prisma.transportOperationalEscalation.updateMany({
        where: {
          id: row.id,
          status: { in: ["OPEN", "ACKNOWLEDGED"] },
        },
        data: {
          status: "RESOLVED",
          resolvedAt: now,
          resolvedByAccountId: null,
          resolutionNote: "Condition cleared by Phase 10 smart-dispatch evaluation.",
          autoResolved: true,
        },
      });
      autoResolved += result.count;
    }

    await this.audit.write({
      actorId: principal.accountId,
      action: "ADMIN_TRANSPORT_SMART_DISPATCH_EVALUATED",
      objectType: "TRANSPORT_SMART_DISPATCH",
      objectId: "ACTIVE",
      purpose: "TRANSPORT_OPERATIONS",
      result: "SUCCESS",
      metadata: {
        evaluatedRequests: snapshot.items.length,
        detectedEscalations: persistable.length,
        opened,
        reopened,
        updated,
        autoResolved,
        autoAssignmentPerformed: false,
        automaticLifecycleMutation: false,
      },
    });

    const refreshed = await this.buildSnapshot(now);
    return {
      ...refreshed,
      evaluation: {
        evaluatedAt: now.toISOString(),
        detectedEscalations: persistable.length,
        opened,
        reopened,
        updated,
        autoResolved,
      },
    };
  }

  async acknowledge(
    principal: AuthPrincipal,
    requestIdRaw: string,
    codeRaw: string,
  ) {
    const requestId = this.requiredId(requestIdRaw, "requestId");
    const code = this.code(codeRaw);
    const escalation = await this.prisma.transportOperationalEscalation.findUnique({
      where: { transportRequestId_code: { transportRequestId: requestId, code } },
    });
    if (!escalation) throw new NotFoundException("Transport escalation not found.");
    if (escalation.status === "RESOLVED") {
      throw new ConflictException("Resolved escalation cannot be acknowledged.");
    }

    const acknowledgedAt = new Date();
    const updated = await this.prisma.transportOperationalEscalation.update({
      where: { id: escalation.id },
      data: {
        status: "ACKNOWLEDGED",
        acknowledgedAt,
        acknowledgedByAccountId: principal.accountId,
      },
    });
    await this.audit.write({
      actorId: principal.accountId,
      action: "ADMIN_TRANSPORT_ESCALATION_ACKNOWLEDGED",
      objectType: "TRANSPORT_OPERATIONAL_ESCALATION",
      objectId: updated.id,
      purpose: "TRANSPORT_OPERATIONS",
      result: "SUCCESS",
      metadata: {
        requestId,
        code,
        severity: updated.severity,
      },
    });
    return this.publicEscalation(updated);
  }

  async resolve(
    principal: AuthPrincipal,
    requestIdRaw: string,
    codeRaw: string,
    body: ResolutionBody,
  ) {
    const requestId = this.requiredId(requestIdRaw, "requestId");
    const code = this.code(codeRaw);
    const note = this.optionalNote(body.note);
    const escalation = await this.prisma.transportOperationalEscalation.findUnique({
      where: { transportRequestId_code: { transportRequestId: requestId, code } },
    });
    if (!escalation) throw new NotFoundException("Transport escalation not found.");

    const resolvedAt = new Date();
    const updated = await this.prisma.transportOperationalEscalation.update({
      where: { id: escalation.id },
      data: {
        status: "RESOLVED",
        resolvedAt,
        resolvedByAccountId: principal.accountId,
        resolutionNote: note ?? "Resolved by transport operations.",
        autoResolved: false,
      },
    });
    await this.audit.write({
      actorId: principal.accountId,
      action: "ADMIN_TRANSPORT_ESCALATION_RESOLVED",
      objectType: "TRANSPORT_OPERATIONAL_ESCALATION",
      objectId: updated.id,
      purpose: "TRANSPORT_OPERATIONS",
      result: "SUCCESS",
      metadata: {
        requestId,
        code,
        severity: updated.severity,
        automaticLifecycleMutation: false,
      },
    });
    return this.publicEscalation(updated);
  }

  private async buildSnapshot(now = new Date()) {
    const thresholds = this.thresholds();
    const requests = await this.prisma.medicalTransportRequest.findMany({
      where: { status: { in: [...ACTIVE_STATUSES] as any[] } },
      orderBy: [{ scheduledFor: "asc" }, { requestedAt: "asc" }],
      take: 300,
    });
    const requestIds = requests.map((row) => row.id);
    const patientIds = [...new Set(requests.map((row) => row.patientId))];
    const assignedProviderIds = [
      ...new Set(
        requests
          .map((row) => row.assignedProviderId)
          .filter((value): value is string => Boolean(value)),
      ),
    ];

    const providerCandidates = await this.prisma.provider.findMany({
      where: {
        class: "OTHER_PROVIDER",
        otherProviderProfile: {
          category: {
            family: { in: ["MEDICAL_TRANSPORT_GROUND", "MEDICAL_TRANSPORT_AIR"] },
          },
        },
      },
      include: {
        user: { select: { id: true, status: true } },
        credentials: true,
        otherProviderProfile: { include: { category: true } },
      },
      orderBy: [{ displayName: "asc" }, { id: "asc" }],
      take: 500,
    });
    const allProviderIds = [
      ...new Set([
        ...providerCandidates.map((row) => row.id),
        ...assignedProviderIds,
      ]),
    ];

    const [
      patients,
      assignments,
      routeRevisions,
      incidents,
      units,
      sessions,
      telemetryRows,
      milestones,
      escalations,
    ] = await Promise.all([
      patientIds.length
        ? this.prisma.patientProfile.findMany({
            where: { id: { in: patientIds } },
            select: { id: true, firstName: true, lastName: true },
          })
        : [],
      requestIds.length
        ? this.prisma.crewAssignment.findMany({
            where: { transportRequestId: { in: requestIds } },
            orderBy: { assignedAt: "desc" },
            take: 3000,
          })
        : [],
      requestIds.length
        ? this.prisma.transportRouteRevision.findMany({
            where: { transportRequestId: { in: requestIds } },
            orderBy: { createdAt: "desc" },
            take: 3000,
          })
        : [],
      requestIds.length
        ? this.prisma.transportIncident.findMany({
            where: {
              transportRequestId: { in: requestIds },
              severity: { in: ["WARNING", "CRITICAL"] },
              occurredAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
            },
            orderBy: { occurredAt: "desc" },
            take: 3000,
          })
        : [],
      allProviderIds.length
        ? this.prisma.transportUnit.findMany({
            where: { providerId: { in: allProviderIds } },
            orderBy: [{ providerId: "asc" }, { code: "asc" }],
          })
        : [],
      requestIds.length
        ? this.prisma.transportTrackingSession.findMany({
            where: { transportRequestId: { in: requestIds } },
          })
        : [],
      requestIds.length
        ? this.prisma.transportUnitTelemetry.findMany({
            where: {
              transportRequestId: { in: requestIds },
              expiresAt: { gt: now },
            },
            orderBy: [{ capturedAt: "desc" }, { receivedAt: "desc" }],
            take: 5000,
          })
        : [],
      requestIds.length
        ? this.prisma.transportTripMilestone.findMany({
            where: { transportRequestId: { in: requestIds } },
            orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
            take: 3000,
          })
        : [],
      requestIds.length
        ? this.prisma.transportOperationalEscalation.findMany({
            where: { transportRequestId: { in: requestIds } },
            orderBy: { updatedAt: "desc" },
            take: 3000,
          })
        : [],
    ]);

    const patientById = new Map(patients.map((row) => [row.id, row]));
    const providerById = new Map(providerCandidates.map((row) => [row.id, row]));
    const unitsByProvider = new Map<string, typeof units>();
    for (const unit of units) {
      const list = unitsByProvider.get(unit.providerId) ?? [];
      list.push(unit);
      unitsByProvider.set(unit.providerId, list);
    }
    const latestAssignment = this.latestByRequest(assignments, "assignedAt");
    const latestRoute = this.latestByRequest(routeRevisions, "createdAt");
    const sessionsByRequest = new Map(sessions.map((row) => [row.transportRequestId, row]));
    const latestTelemetryByRequest = new Map<string, (typeof telemetryRows)[number]>();
    for (const row of telemetryRows) {
      if (!latestTelemetryByRequest.has(row.transportRequestId)) {
        latestTelemetryByRequest.set(row.transportRequestId, row);
      }
    }
    const milestonesByRequest = new Map<string, typeof milestones>();
    for (const row of milestones) {
      const list = milestonesByRequest.get(row.transportRequestId) ?? [];
      list.push(row);
      milestonesByRequest.set(row.transportRequestId, list);
    }
    const incidentsByRequest = new Map<string, typeof incidents>();
    for (const row of incidents) {
      const list = incidentsByRequest.get(row.transportRequestId) ?? [];
      list.push(row);
      incidentsByRequest.set(row.transportRequestId, list);
    }
    const escalationByKey = new Map(
      escalations.map((row) => [this.key(row.transportRequestId, row.code), row]),
    );

    const activeJobsByProvider = new Map<string, number>();
    for (const request of requests) {
      if (request.assignedProviderId) {
        activeJobsByProvider.set(
          request.assignedProviderId,
          (activeJobsByProvider.get(request.assignedProviderId) ?? 0) + 1,
        );
      }
    }

    const candidateProfiles = providerCandidates.map((provider) => {
      const category = provider.otherProviderProfile?.category;
      const family = category?.family;
      const mode = family === "MEDICAL_TRANSPORT_AIR" ? "AIR" : "GROUND";
      const providerUnits = unitsByProvider.get(provider.id) ?? [];
      const activeUnits = providerUnits.filter(
        (unit) => unit.active && unit.mode === mode,
      );
      const required = jsonStringArray(category?.requiredCredentialTypes);
      const usable = (provider.credentials ?? []).filter(
        (credential: { status?: string }) =>
          credential.status === "VALID" || credential.status === "VERIFIED",
      );
      const missingCredentialTypes = missingCurrentCredentialTypes(required, usable);
      const dispatchReady =
        provider.status === "ACTIVE" &&
        provider.user?.status === "ACTIVE" &&
        category?.active === true &&
        missingCredentialTypes.length === 0 &&
        activeUnits.length > 0;
      const activeJobs = activeJobsByProvider.get(provider.id) ?? 0;
      return {
        id: provider.id,
        displayName: provider.displayName,
        mode,
        dispatchReady,
        activeJobs,
        activeUnitCount: activeUnits.length,
        missingCredentialTypes,
      };
    });

    const items = requests.map((request) => {
      const patient = patientById.get(request.patientId);
      const provider = request.assignedProviderId
        ? providerById.get(request.assignedProviderId)
        : undefined;
      const assignment = latestAssignment.get(request.id) as any;
      const route = latestRoute.get(request.id) as any;
      const session = sessionsByRequest.get(request.id);
      const latestTelemetry = latestTelemetryByRequest.get(request.id);
      const requestMilestones = milestonesByRequest.get(request.id) ?? [];
      const requestIncidents = incidentsByRequest.get(request.id) ?? [];
      const signals: Signal[] = [];

      const assignmentAge = this.minutesBetween(request.requestedAt, now);
      if (
        request.status === "REQUESTED" &&
        !request.assignedProviderId &&
        assignmentAge >= thresholds.assignmentSlaMinutes
      ) {
        signals.push({
          code: "ASSIGNMENT_OVERDUE",
          severity: this.overdueSeverity(
            assignmentAge - thresholds.assignmentSlaMinutes,
          ),
          title: "Provider assignment overdue",
          detail: "Medical Transport remains unassigned beyond the dispatch SLA.",
          since: request.requestedAt,
          recommendedAction: "ASSIGN_PROVIDER",
        });
      }

      if (
        request.assignedProviderId &&
        request.status === "ASSIGNED" &&
        (!assignment ||
          !assignment.transportUnitId ||
          assignment.crewProviderIds.length === 0)
      ) {
        const anchor = request.assignedAt ?? request.updatedAt;
        const age = this.minutesBetween(anchor, now);
        if (age >= thresholds.resourceReadySlaMinutes) {
          signals.push({
            code: "RESOURCE_NOT_READY",
            severity: this.overdueSeverity(age - thresholds.resourceReadySlaMinutes),
            title: "Crew or unit readiness overdue",
            detail: "Assigned provider does not yet have a complete crew/unit revision.",
            since: anchor,
            recommendedAction: "ASSIGN_RESOURCES",
          });
        }
      }

      if (request.mode === "GROUND" && request.assignedProviderId && request.etaMinutes == null) {
        const anchor = route?.createdAt ?? request.assignedAt ?? request.updatedAt;
        const age = this.minutesBetween(anchor, now);
        if (age >= thresholds.etaRefreshSlaMinutes) {
          signals.push({
            code:
              route?.source === "PROVIDER_DESTINATION_CHANGE"
                ? "ETA_STALE_AFTER_DESTINATION_CHANGE"
                : "ETA_ATTENTION",
            severity:
              age >= thresholds.etaRefreshSlaMinutes * 2 ? "CRITICAL" : "WARNING",
            title: "Route ETA requires attention",
            detail: "A current Ground Transport ETA is unavailable.",
            since: anchor,
            recommendedAction: "RECALCULATE_ETA",
          });
        }
      }

      if (
        (request.status === "REQUESTED" || request.status === "ASSIGNED") &&
        now.getTime() >
          request.scheduledFor.getTime() + thresholds.departureGraceMinutes * 60_000
      ) {
        const overdue = this.minutesBetween(request.scheduledFor, now);
        signals.push({
          code: "DEPARTURE_OVERDUE",
          severity:
            overdue >= thresholds.departureGraceMinutes * 2 ? "CRITICAL" : "WARNING",
          title: "Scheduled departure is overdue",
          detail: "Transport has not advanced to EN_ROUTE after the configured grace period.",
          since: request.scheduledFor,
          recommendedAction: "ADVANCE_OR_REVIEW_STATUS",
        });
      }

      if (
        provider &&
        !this.providerDispatchReady(
          provider,
          unitsByProvider.get(provider.id) ?? [],
        )
      ) {
        signals.push({
          code: "PROVIDER_READINESS_RISK",
          severity: "CRITICAL",
          title: "Assigned provider is not dispatch ready",
          detail: "Provider status, credential validity, category or active fleet no longer satisfies readiness.",
          since: request.updatedAt,
          recommendedAction: "REVIEW_PROVIDER",
        });
      }

      const criticalIncident = requestIncidents.find((row) => row.severity === "CRITICAL");
      const warningIncident = requestIncidents.find((row) => row.severity === "WARNING");
      if (criticalIncident) {
        signals.push({
          code: "CRITICAL_INCIDENT_REVIEW",
          severity: "CRITICAL",
          title: "Critical transport incident requires review",
          detail: `${criticalIncident.category} · ${criticalIncident.reasonCode}`,
          since: criticalIncident.occurredAt,
          recommendedAction: "REVIEW_INCIDENT",
        });
      } else if (warningIncident) {
        signals.push({
          code: "WARNING_INCIDENT_REVIEW",
          severity: "WARNING",
          title: "Transport incident requires review",
          detail: `${warningIncident.category} · ${warningIncident.reasonCode}`,
          since: warningIncident.occurredAt,
          recommendedAction: "REVIEW_INCIDENT",
        });
      }

      if (
        session &&
        session.sharingStatus === "ACTIVE" &&
        session.shareWithPatient === true &&
        session.expiresAt.getTime() > now.getTime() &&
        ["EN_ROUTE", "ARRIVED", "TRANSPORTING"].includes(request.status)
      ) {
        if (!latestTelemetry) {
          const age = this.minutesBetween(session.startedAt, now);
          if (age * 60 >= thresholds.telemetryStaleSeconds) {
            signals.push({
              code: "TELEMETRY_HEARTBEAT_MISSING",
              severity: age * 60 >= thresholds.telemetryCriticalSeconds ? "CRITICAL" : "WARNING",
              title: "Vehicle telemetry heartbeat missing",
              detail: "Location sharing is active but no retained heartbeat is available.",
              since: session.startedAt,
              recommendedAction: "REVIEW_TELEMETRY",
            });
          }
        } else {
          const ageSeconds = Math.max(
            0,
            Math.floor((now.getTime() - latestTelemetry.capturedAt.getTime()) / 1000),
          );
          if (ageSeconds >= thresholds.telemetryStaleSeconds) {
            signals.push({
              code: "TELEMETRY_STALE",
              severity:
                ageSeconds >= thresholds.telemetryCriticalSeconds
                  ? "CRITICAL"
                  : "WARNING",
              title: "Vehicle telemetry is stale",
              detail: `Latest accepted foreground heartbeat is ${ageSeconds} seconds old.`,
              since: latestTelemetry.capturedAt,
              recommendedAction: "REVIEW_TELEMETRY",
            });
          }
        }
      }

      const pickupDetected = requestMilestones.find(
        (row) => row.code === "PICKUP_ARRIVAL_DETECTED",
      );
      if (pickupDetected && request.status === "EN_ROUTE") {
        const age = this.minutesBetween(pickupDetected.occurredAt, now);
        if (age >= thresholds.milestoneConfirmationMinutes) {
          signals.push({
            code: "PICKUP_CONFIRMATION_PENDING",
            severity:
              age >= thresholds.milestoneCriticalMinutes ? "CRITICAL" : "WARNING",
            title: "Pickup arrival detection awaits confirmation",
            detail: "Telemetry detected pickup arrival, but lifecycle remains EN_ROUTE.",
            since: pickupDetected.occurredAt,
            recommendedAction: "CONFIRM_PICKUP_ARRIVAL",
          });
        }
      }

      const destinationDetected = requestMilestones.find(
        (row) => row.code === "DESTINATION_ARRIVAL_DETECTED",
      );
      if (destinationDetected && request.status === "TRANSPORTING") {
        const age = this.minutesBetween(destinationDetected.occurredAt, now);
        if (age >= thresholds.milestoneConfirmationMinutes) {
          signals.push({
            code: "DESTINATION_CONFIRMATION_PENDING",
            severity:
              age >= thresholds.milestoneCriticalMinutes ? "CRITICAL" : "WARNING",
            title: "Destination arrival detection awaits confirmation",
            detail: "Telemetry detected destination arrival, but lifecycle remains TRANSPORTING.",
            since: destinationDetected.occurredAt,
            recommendedAction: "CONFIRM_DESTINATION_HANDOFF",
          });
        }
      }

      signals.sort((a, b) => {
        const severity = this.severityWeight(b.severity) - this.severityWeight(a.severity);
        if (severity !== 0) return severity;
        return a.since.getTime() - b.since.getTime();
      });

      const urgency = this.scheduleUrgency(request.scheduledFor, now);
      const priorityScore = Math.min(
        999,
        signals.reduce((sum, signal) => sum + this.signalWeight(signal.severity), 0) +
          urgency.score +
          (!request.assignedProviderId ? 20 : 0),
      );
      const priorityBand = this.priorityBand(signals, priorityScore);

      const candidateRecommendations =
        request.status === "REQUESTED" && !request.assignedProviderId
          ? candidateProfiles
              .filter((candidate) => candidate.mode === request.mode && candidate.dispatchReady)
              .map((candidate) => ({
                providerId: candidate.id,
                displayName: candidate.displayName,
                score: Math.max(
                  1,
                  100 -
                    candidate.activeJobs * 15 +
                    Math.min(candidate.activeUnitCount, 3) * 5,
                ),
                activeJobs: candidate.activeJobs,
                activeUnitCount: candidate.activeUnitCount,
                basis: [
                  "MODE_MATCH",
                  "DISPATCH_READY",
                  "ACTIVE_UNIT_CAPACITY",
                  "CURRENT_ACTIVE_JOB_LOAD",
                ],
              }))
              .sort((a, b) => b.score - a.score || a.displayName.localeCompare(b.displayName))
              .slice(0, 5)
          : [];

      const signalViews = signals.map((signal) => {
        const escalation = escalationByKey.get(this.key(request.id, signal.code));
        return {
          code: signal.code,
          severity: signal.severity,
          title: signal.title,
          detail: signal.detail,
          since: signal.since,
          recommendedAction: signal.recommendedAction,
          escalation: escalation ? this.publicEscalation(escalation) : null,
        };
      });

      const patientLabel = [patient?.firstName, patient?.lastName]
        .filter(Boolean)
        .join(" ")
        .trim();

      return {
        requestId: request.id,
        patientLabel: patientLabel || "Patient",
        mode: request.mode,
        status: request.status,
        scheduledFor: request.scheduledFor,
        assignedProvider: provider
          ? { id: provider.id, displayName: provider.displayName }
          : null,
        etaMinutes: request.etaMinutes,
        priorityScore,
        priorityBand,
        scheduleUrgency: urgency.label,
        topRecommendedAction: signalViews[0]?.recommendedAction ?? null,
        signals: signalViews,
        candidateRecommendations,
        autoAssignmentPerformed: false,
        automaticLifecycleMutation: false,
      };
    });

    items.sort((a, b) => {
      if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
      return new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime();
    });

    const openEscalations = escalations.filter(
      (row) => row.status === "OPEN" || row.status === "ACKNOWLEDGED",
    ).length;

    return {
      generatedAt: now.toISOString(),
      evaluationMode: "DETERMINISTIC_RULES",
      evaluationIntervalSeconds: thresholds.evaluationIntervalSeconds,
      autoAssignmentPerformed: false,
      automaticLifecycleMutation: false,
      providerRecommendationUsesLiveLocation: false,
      thresholds,
      summary: {
        activeRequests: items.length,
        critical: items.filter((row) => row.priorityBand === "CRITICAL").length,
        high: items.filter((row) => row.priorityBand === "HIGH").length,
        unassigned: items.filter((row) => !row.assignedProvider).length,
        openEscalations,
      },
      items,
    };
  }

  private latestByRequest<T extends { transportRequestId: string }>(
    rows: T[],
    _timeField: string,
  ) {
    const map = new Map<string, T>();
    for (const row of rows) {
      if (!map.has(row.transportRequestId)) map.set(row.transportRequestId, row);
    }
    return map;
  }

  private providerDispatchReady(provider: any, units: any[]) {
    const category = provider.otherProviderProfile?.category;
    const family = category?.family;
    const mode = family === "MEDICAL_TRANSPORT_AIR" ? "AIR" : "GROUND";
    const required = jsonStringArray(category?.requiredCredentialTypes);
    const usable = (provider.credentials ?? []).filter(
      (credential: { status?: string }) =>
        credential.status === "VALID" || credential.status === "VERIFIED",
    );
    return (
      provider.status === "ACTIVE" &&
      provider.user?.status === "ACTIVE" &&
      category?.active === true &&
      missingCurrentCredentialTypes(required, usable).length === 0 &&
      units.some((unit) => unit.active && unit.mode === mode)
    );
  }

  private thresholds() {
    const telemetryStaleSeconds = this.envInteger(
      "TRANSPORT_SMART_TELEMETRY_STALE_SECONDS",
      180,
      60,
      3600,
    );
    const milestoneConfirmationMinutes = this.envInteger(
      "TRANSPORT_SMART_MILESTONE_CONFIRMATION_MINUTES",
      3,
      1,
      60,
    );
    const telemetryCriticalSeconds = Math.max(
      telemetryStaleSeconds,
      this.envInteger(
        "TRANSPORT_SMART_TELEMETRY_CRITICAL_SECONDS",
        Math.min(7200, Math.max(600, telemetryStaleSeconds * 3)),
        telemetryStaleSeconds,
        7200,
      ),
    );
    const milestoneCriticalMinutes = Math.max(
      milestoneConfirmationMinutes,
      this.envInteger(
        "TRANSPORT_SMART_MILESTONE_CRITICAL_MINUTES",
        Math.min(240, Math.max(10, milestoneConfirmationMinutes * 3)),
        milestoneConfirmationMinutes,
        240,
      ),
    );
    return {
      evaluationIntervalSeconds: this.envInteger(
        "TRANSPORT_SMART_DISPATCH_EVALUATION_SECONDS",
        60,
        15,
        600,
      ),
      assignmentSlaMinutes: this.envInteger(
        "TRANSPORT_ASSIGNMENT_SLA_MINUTES",
        15,
        1,
        1440,
      ),
      resourceReadySlaMinutes: this.envInteger(
        "TRANSPORT_RESOURCE_READY_SLA_MINUTES",
        10,
        1,
        1440,
      ),
      etaRefreshSlaMinutes: this.envInteger(
        "TRANSPORT_ETA_REFRESH_SLA_MINUTES",
        10,
        1,
        1440,
      ),
      departureGraceMinutes: this.envInteger(
        "TRANSPORT_DEPARTURE_GRACE_MINUTES",
        10,
        1,
        1440,
      ),
      telemetryStaleSeconds,
      telemetryCriticalSeconds,
      milestoneConfirmationMinutes,
      milestoneCriticalMinutes,
    };
  }

  private scheduleUrgency(scheduledFor: Date, now: Date) {
    const minutes = Math.floor((scheduledFor.getTime() - now.getTime()) / 60_000);
    if (minutes < 0) return { label: "OVERDUE", score: 40 };
    if (minutes <= 15) return { label: "DUE_WITHIN_15_MIN", score: 25 };
    if (minutes <= 60) return { label: "DUE_WITHIN_60_MIN", score: 10 };
    return { label: "SCHEDULED", score: 0 };
  }

  private priorityBand(signals: Signal[], score: number): PriorityBand {
    if (signals.some((signal) => signal.severity === "CRITICAL")) return "CRITICAL";
    if (signals.some((signal) => signal.severity === "WARNING") || score >= 60) return "HIGH";
    if (score >= 25) return "MEDIUM";
    return "NORMAL";
  }

  private signalWeight(severity: Severity) {
    return severity === "CRITICAL" ? 80 : severity === "WARNING" ? 35 : 10;
  }

  private severityWeight(severity: Severity) {
    return severity === "CRITICAL" ? 3 : severity === "WARNING" ? 2 : 1;
  }

  private overdueSeverity(overdueMinutes: number): Severity {
    return overdueMinutes >= 15 ? "CRITICAL" : "WARNING";
  }

  private minutesBetween(from: Date, to: Date) {
    return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 60_000));
  }

  private publicEscalation(row: any) {
    return {
      id: row.id,
      code: row.code,
      severity: row.severity,
      status: row.status,
      recommendedAction: row.recommendedAction,
      firstTriggeredAt: row.firstTriggeredAt,
      lastTriggeredAt: row.lastTriggeredAt,
      occurrenceCount: row.occurrenceCount,
      acknowledgedAt: row.acknowledgedAt,
      resolvedAt: row.resolvedAt,
      autoResolved: row.autoResolved,
      resolutionNote: row.resolutionNote,
    };
  }

  private requiredId(value: unknown, field: string) {
    if (typeof value !== "string" || !SAFE_ID.test(value.trim())) {
      throw new BadRequestException(`${field} is invalid.`);
    }
    return value.trim();
  }

  private code(value: unknown) {
    if (typeof value !== "string" || !SAFE_CODE.test(value.trim().toUpperCase())) {
      throw new BadRequestException("escalation code is invalid.");
    }
    return value.trim().toUpperCase();
  }

  private optionalNote(value: unknown) {
    if (value == null || value === "") return null;
    if (typeof value !== "string") {
      throw new BadRequestException("note is invalid.");
    }
    const note = value.trim();
    if (note.length > 500) {
      throw new BadRequestException("note is too long.");
    }
    return note || null;
  }

  private envInteger(name: string, fallback: number, min: number, max: number) {
    const value = Number(process.env[name]);
    return Number.isInteger(value) && value >= min && value <= max
      ? value
      : fallback;
  }

  private key(requestId: string, code: string) {
    return `${requestId}\u0000${code}`;
  }
}

@Controller("admin/transport/smart-dispatch")
@RequirePermissions("TRANSPORT_OPERATE")
class TransportSmartDispatchController {
  constructor(private readonly smart: TransportSmartDispatchService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  overview(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.smart.overview(principal);
  }

  @Post("evaluate")
  @Header("Cache-Control", "no-store")
  evaluate(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.smart.evaluate(principal);
  }

  @Post(":requestId/escalations/:code/acknowledge")
  @Header("Cache-Control", "no-store")
  acknowledge(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("requestId") requestId: string,
    @Param("code") code: string,
  ) {
    return this.smart.acknowledge(principal, requestId, code);
  }

  @Post(":requestId/escalations/:code/resolve")
  @Header("Cache-Control", "no-store")
  resolve(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("requestId") requestId: string,
    @Param("code") code: string,
    @Body() body: ResolutionBody,
  ) {
    return this.smart.resolve(principal, requestId, code, body ?? {});
  }
}

@Module({
  controllers: [TransportSmartDispatchController],
  providers: [TransportSmartDispatchService],
})
export class TransportSmartDispatchModule {}
