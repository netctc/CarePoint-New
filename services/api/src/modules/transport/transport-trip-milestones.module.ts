import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Injectable,
  Module,
  NotFoundException,
  Param,
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

const SAFE_ID = /^[A-Za-z0-9_.:-]{1,180}$/;
const TRACKING_SOURCE = "TRACKING_SESSION";
const TELEMETRY_SOURCE = "TELEMETRY_HEARTBEAT";
const GEOFENCE_SOURCE = "TELEMETRY_GEOFENCE";

export const TRANSPORT_TRIP_MILESTONE_CODES = [
  "TRACKING_STARTED",
  "FIRST_POSITION_RECEIVED",
  "NEAR_PICKUP",
  "PICKUP_ARRIVAL_DETECTED",
  "NEAR_DESTINATION",
  "DESTINATION_ARRIVAL_DETECTED",
  "TRACKING_STOPPED",
] as const;

export type TransportTripMilestoneCode =
  (typeof TRANSPORT_TRIP_MILESTONE_CODES)[number];

type DetectionInput = {
  request: {
    id: string;
    patientId: string;
    status: string;
    mode: string;
    pickupLatitude: unknown;
    pickupLongitude: unknown;
    destinationLatitude: unknown;
    destinationLongitude: unknown;
  };
  providerId: string;
  transportUnitId: string;
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  capturedAt: Date;
};

@Injectable()
export class TransportTripMilestoneService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async recordTrackingStarted(input: {
    requestId: string;
    patientId: string;
    lifecycleStatus: string;
    providerId: string;
    transportUnitId: string;
    occurredAt: Date;
  }) {
    return this.recordMilestone({
      ...input,
      code: "TRACKING_STARTED",
      source: TRACKING_SOURCE,
      distanceMeters: null,
      telemetryCapturedAt: null,
      notifyPatient: false,
    });
  }

  async recordTrackingStopped(input: {
    requestId: string;
    patientId: string;
    lifecycleStatus: string;
    providerId: string;
    transportUnitId: string;
    occurredAt: Date;
  }) {
    return this.recordMilestone({
      ...input,
      code: "TRACKING_STOPPED",
      source: TRACKING_SOURCE,
      distanceMeters: null,
      telemetryCapturedAt: null,
      notifyPatient: false,
    });
  }

  async detectFromHeartbeat(input: DetectionInput) {
    const created: TransportTripMilestoneCode[] = [];
    const first = await this.recordMilestone({
      requestId: input.request.id,
      patientId: input.request.patientId,
      lifecycleStatus: input.request.status,
      providerId: input.providerId,
      transportUnitId: input.transportUnitId,
      code: "FIRST_POSITION_RECEIVED",
      source: TELEMETRY_SOURCE,
      distanceMeters: null,
      telemetryCapturedAt: input.capturedAt,
      occurredAt: input.capturedAt,
      notifyPatient: false,
    });
    if (first) created.push("FIRST_POSITION_RECEIVED");

    if (
      input.accuracyMeters == null ||
      input.accuracyMeters > this.maxAccuracyMeters()
    ) {
      return {
        created,
        geofenceEvaluation: "SKIPPED_LOW_ACCURACY",
        maxAccuracyMeters: this.maxAccuracyMeters(),
      };
    }

    if (input.request.status === "EN_ROUTE" || input.request.status === "ARRIVED") {
      const pickup = this.coordinatePair(
        input.request.pickupLatitude,
        input.request.pickupLongitude,
      );
      if (pickup) {
        const distance = Math.round(
          this.distanceMeters(
            input.latitude,
            input.longitude,
            pickup.latitude,
            pickup.longitude,
          ),
        );
        const arrivalThreshold = Math.min(
          this.pickupArrivalMeters(),
          this.nearPickupMeters(),
        );
        if (distance <= arrivalThreshold) {
          const milestone = await this.recordMilestone({
            requestId: input.request.id,
            patientId: input.request.patientId,
            lifecycleStatus: input.request.status,
            providerId: input.providerId,
            transportUnitId: input.transportUnitId,
            code: "PICKUP_ARRIVAL_DETECTED",
            source: GEOFENCE_SOURCE,
            distanceMeters: distance,
            telemetryCapturedAt: input.capturedAt,
            occurredAt: input.capturedAt,
            notifyPatient: true,
          });
          if (milestone) created.push("PICKUP_ARRIVAL_DETECTED");
        } else if (distance <= this.nearPickupMeters()) {
          const milestone = await this.recordMilestone({
            requestId: input.request.id,
            patientId: input.request.patientId,
            lifecycleStatus: input.request.status,
            providerId: input.providerId,
            transportUnitId: input.transportUnitId,
            code: "NEAR_PICKUP",
            source: GEOFENCE_SOURCE,
            distanceMeters: distance,
            telemetryCapturedAt: input.capturedAt,
            occurredAt: input.capturedAt,
            notifyPatient: true,
          });
          if (milestone) created.push("NEAR_PICKUP");
        }
      }
    }

    if (input.request.status === "TRANSPORTING") {
      const destination = this.coordinatePair(
        input.request.destinationLatitude,
        input.request.destinationLongitude,
      );
      if (destination) {
        const distance = Math.round(
          this.distanceMeters(
            input.latitude,
            input.longitude,
            destination.latitude,
            destination.longitude,
          ),
        );
        const arrivalThreshold = Math.min(
          this.destinationArrivalMeters(),
          this.nearDestinationMeters(),
        );
        if (distance <= arrivalThreshold) {
          const milestone = await this.recordMilestone({
            requestId: input.request.id,
            patientId: input.request.patientId,
            lifecycleStatus: input.request.status,
            providerId: input.providerId,
            transportUnitId: input.transportUnitId,
            code: "DESTINATION_ARRIVAL_DETECTED",
            source: GEOFENCE_SOURCE,
            distanceMeters: distance,
            telemetryCapturedAt: input.capturedAt,
            occurredAt: input.capturedAt,
            notifyPatient: true,
          });
          if (milestone) created.push("DESTINATION_ARRIVAL_DETECTED");
        } else if (distance <= this.nearDestinationMeters()) {
          const milestone = await this.recordMilestone({
            requestId: input.request.id,
            patientId: input.request.patientId,
            lifecycleStatus: input.request.status,
            providerId: input.providerId,
            transportUnitId: input.transportUnitId,
            code: "NEAR_DESTINATION",
            source: GEOFENCE_SOURCE,
            distanceMeters: distance,
            telemetryCapturedAt: input.capturedAt,
            occurredAt: input.capturedAt,
            notifyPatient: true,
          });
          if (milestone) created.push("NEAR_DESTINATION");
        }
      }
    }

    return {
      created,
      geofenceEvaluation: "EVALUATED",
      maxAccuracyMeters: this.maxAccuracyMeters(),
    };
  }

  async patientTimeline(principal: AuthPrincipal, requestIdRaw: string) {
    const requestId = this.requiredId(requestIdRaw, "requestId");
    const patient = await this.prisma.patientProfile.findUnique({
      where: { userId: principal.accountId },
      select: { id: true },
    });
    if (!patient) throw new NotFoundException("Patient profile not found.");
    const request = await this.prisma.medicalTransportRequest.findFirst({
      where: { id: requestId, patientId: patient.id },
      select: { id: true, status: true, etaMinutes: true },
    });
    if (!request) throw new NotFoundException("Medical transport request not found.");
    return this.timeline(request);
  }

  async providerTimeline(principal: AuthPrincipal, requestIdRaw: string) {
    const requestId = this.requiredId(requestIdRaw, "requestId");
    const provider = await this.prisma.provider.findUnique({
      where: { userId: principal.accountId },
      select: { id: true, status: true },
    });
    if (!provider || provider.status !== "ACTIVE") {
      throw new ForbiddenException("Active transport provider required.");
    }
    const request = await this.prisma.medicalTransportRequest.findFirst({
      where: { id: requestId, assignedProviderId: provider.id },
      select: { id: true, status: true, etaMinutes: true },
    });
    if (!request) throw new NotFoundException("Assigned medical transport job not found.");
    return this.timeline(request);
  }

  async adminTimeline(requestIdRaw: string) {
    const requestId = this.requiredId(requestIdRaw, "requestId");
    const request = await this.prisma.medicalTransportRequest.findUnique({
      where: { id: requestId },
      select: { id: true, status: true, etaMinutes: true },
    });
    if (!request) throw new NotFoundException("Medical transport request not found.");
    return this.timeline(request);
  }

  private async timeline(request: {
    id: string;
    status: string;
    etaMinutes: number | null;
  }) {
    const [lifecycle, milestones] = await Promise.all([
      this.prisma.medicalTransportEvent.findMany({
        where: { transportRequestId: request.id },
        orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
        take: 300,
      }),
      this.prisma.transportTripMilestone.findMany({
        where: { transportRequestId: request.id },
        orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
        take: 100,
      }),
    ]);

    const items = [
      ...lifecycle.map((row) => ({
        id: row.id,
        kind: "LIFECYCLE",
        authority: "AUTHORITATIVE_LIFECYCLE",
        code: row.toStatus,
        source: "MEDICAL_TRANSPORT_EVENT",
        occurredAt: row.occurredAt,
        fromStatus: row.fromStatus,
        toStatus: row.toStatus,
        etaMinutes: row.etaMinutes,
        distanceMeters: null,
        suggestedAction: null,
      })),
      ...milestones.map((row) => ({
        id: row.id,
        kind: "MILESTONE",
        authority: "AUTOMATED_DETECTION",
        code: row.code,
        source: row.source,
        occurredAt: row.occurredAt,
        fromStatus: null,
        toStatus: null,
        etaMinutes: null,
        distanceMeters: row.distanceMeters,
        suggestedAction: this.suggestedAction(row.code),
      })),
    ].sort((left, right) => {
      const delta = left.occurredAt.getTime() - right.occurredAt.getTime();
      return delta || left.id.localeCompare(right.id);
    });

    return {
      requestId: request.id,
      lifecycleStatus: request.status,
      routeEtaMinutes: request.etaMinutes,
      automaticLifecycleMutation: false,
      geofencePolicy: {
        maxAccuracyMeters: this.maxAccuracyMeters(),
        nearPickupMeters: this.nearPickupMeters(),
        pickupArrivalMeters: this.pickupArrivalMeters(),
        nearDestinationMeters: this.nearDestinationMeters(),
        destinationArrivalMeters: this.destinationArrivalMeters(),
      },
      items,
    };
  }

  private async recordMilestone(input: {
    requestId: string;
    patientId: string;
    lifecycleStatus: string;
    providerId: string;
    transportUnitId: string;
    code: TransportTripMilestoneCode;
    source: string;
    distanceMeters: number | null;
    telemetryCapturedAt: Date | null;
    occurredAt: Date;
    notifyPatient: boolean;
  }): Promise<boolean> {
    const result = await this.prisma.transportTripMilestone.createMany({
      data: [
        {
          transportRequestId: input.requestId,
          providerId: input.providerId,
          transportUnitId: input.transportUnitId,
          code: input.code,
          source: input.source,
          lifecycleStatus: input.lifecycleStatus,
          distanceMeters: input.distanceMeters,
          telemetryCapturedAt: input.telemetryCapturedAt,
          occurredAt: input.occurredAt,
        },
      ],
      skipDuplicates: true,
    });
    if (result.count !== 1) return false;

    await this.audit.write({
      actorId: null,
      action: "MEDICAL_TRANSPORT_MILESTONE_DETECTED",
      objectType: "MEDICAL_TRANSPORT_REQUEST",
      objectId: input.requestId,
      purpose: "TRANSPORT_OPERATIONS",
      result: "SUCCESS",
      metadata: {
        code: input.code,
        source: input.source,
        lifecycleStatus: input.lifecycleStatus,
        distanceMeters: input.distanceMeters,
        coordinateValuesExcludedFromAudit: true,
        automaticLifecycleMutation: false,
      },
    });

    if (input.notifyPatient) {
      const patient = await this.prisma.patientProfile.findUnique({
        where: { id: input.patientId },
        select: { userId: true },
      });
      if (patient?.userId) {
        await this.notifications.notifyAccount({
          accountId: patient.userId,
          dedupeKey: `transport-milestone:${input.requestId}:${input.code}`,
          type: "TRANSPORT_UPDATE",
          entityType: "MEDICAL_TRANSPORT_REQUEST",
          entityId: input.requestId,
          safeTitleKey: "notification.transport.title",
          safeBodyKey: "notification.transport.body",
        });
      }
    }
    return true;
  }

  private suggestedAction(code: string) {
    if (code === "PICKUP_ARRIVAL_DETECTED") return "CONFIRM_PICKUP_ARRIVAL";
    if (code === "DESTINATION_ARRIVAL_DETECTED") {
      return "CONFIRM_DESTINATION_ARRIVAL_OR_HANDOFF";
    }
    if (code === "NEAR_PICKUP") return "PREPARE_FOR_PICKUP";
    if (code === "NEAR_DESTINATION") return "PREPARE_FOR_DESTINATION_HANDOFF";
    return null;
  }

  private coordinatePair(latitudeRaw: unknown, longitudeRaw: unknown) {
    if (latitudeRaw == null || longitudeRaw == null) return null;
    const latitude = Number(latitudeRaw);
    const longitude = Number(longitudeRaw);
    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      return null;
    }
    return { latitude, longitude };
  }

  private distanceMeters(
    latitudeA: number,
    longitudeA: number,
    latitudeB: number,
    longitudeB: number,
  ) {
    const radians = (degrees: number) => (degrees * Math.PI) / 180;
    const earthRadiusMeters = 6_371_000;
    const dLat = radians(latitudeB - latitudeA);
    const dLon = radians(longitudeB - longitudeA);
    const latA = radians(latitudeA);
    const latB = radians(latitudeB);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(latA) * Math.cos(latB) * Math.sin(dLon / 2) ** 2;
    return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  private maxAccuracyMeters() {
    return this.envInteger("TRANSPORT_GEOFENCE_MAX_ACCURACY_METERS", 100, 10, 1000);
  }

  private nearPickupMeters() {
    return this.envInteger("TRANSPORT_GEOFENCE_NEAR_PICKUP_METERS", 500, 50, 5000);
  }

  private pickupArrivalMeters() {
    return this.envInteger("TRANSPORT_GEOFENCE_PICKUP_ARRIVAL_METERS", 120, 25, 2000);
  }

  private nearDestinationMeters() {
    return this.envInteger("TRANSPORT_GEOFENCE_NEAR_DESTINATION_METERS", 750, 50, 5000);
  }

  private destinationArrivalMeters() {
    return this.envInteger(
      "TRANSPORT_GEOFENCE_DESTINATION_ARRIVAL_METERS",
      150,
      25,
      2000,
    );
  }

  private envInteger(name: string, fallback: number, min: number, max: number) {
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
}

@RequirePermissions("PATIENT_TRANSPORT_REQUEST")
@Controller("medical-transport")
class PatientTransportTripMilestoneController {
  constructor(private readonly milestones: TransportTripMilestoneService) {}

  @Get(":requestId/timeline")
  @Header("Cache-Control", "no-store")
  timeline(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("requestId") requestId: string,
  ) {
    return this.milestones.patientTimeline(principal, requestId);
  }
}

@RequirePermissions("TRANSPORT_RESPOND")
@Controller("provider/medical-transport")
class ProviderTransportTripMilestoneController {
  constructor(private readonly milestones: TransportTripMilestoneService) {}

  @Get(":requestId/timeline")
  @Header("Cache-Control", "no-store")
  timeline(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("requestId") requestId: string,
  ) {
    return this.milestones.providerTimeline(principal, requestId);
  }
}

@RequirePermissions("TRANSPORT_OPERATE")
@Controller("admin/transport")
class AdminTransportTripMilestoneController {
  constructor(private readonly milestones: TransportTripMilestoneService) {}

  @Get(":requestId/timeline")
  @Header("Cache-Control", "no-store")
  timeline(@Param("requestId") requestId: string) {
    return this.milestones.adminTimeline(requestId);
  }
}

@Module({
  imports: [CommunicationsModule],
  controllers: [
    PatientTransportTripMilestoneController,
    ProviderTransportTripMilestoneController,
    AdminTransportTripMilestoneController,
  ],
  providers: [TransportTripMilestoneService],
  exports: [TransportTripMilestoneService],
})
export class TransportTripMilestonesModule {}
