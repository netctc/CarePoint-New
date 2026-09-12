import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import {
  MedicalTransportAssistanceLevels,
  MedicalTransportModes,
  MedicalTransportStatuses,
  assertValidEmergencyLocation,
  type CreateMedicalTransportRequestInput,
  type MedicalTransportAssignmentInput,
  type MedicalTransportCancelInput,
  type MedicalTransportResponderUpdateInput,
} from "@carepoint/contracts";
import type { AuthPrincipal } from "@carepoint/identity";
import { Prisma, type MedicalTransportMode, type MedicalTransportStatus } from "@prisma/client";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { CommunicationsModule } from "../communications/communications.module";
import { NotificationsService } from "../communications/notifications.service";

const MIN_SCHEDULE_LEAD_MS = 15 * 60 * 1000;
const PATIENT_CANCEL_ALLOWED: readonly MedicalTransportStatus[] = ["REQUESTED", "ASSIGNED"];
const RESPONDER_NEXT: Partial<Record<MedicalTransportStatus, MedicalTransportStatus>> = {
  ASSIGNED: "EN_ROUTE",
  EN_ROUTE: "ARRIVED",
  ARRIVED: "TRANSPORTING",
  TRANSPORTING: "COMPLETED",
};

@Injectable()
class MedicalTransportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async createPatientRequest(principal: AuthPrincipal, input: CreateMedicalTransportRequestInput) {
    const patient = await this.patientForAccount(principal.accountId);
    const clientRequestId = this.requiredText(input.clientRequestId, 8, 180, "clientRequestId");
    const mode = this.transportMode(input.mode);
    const assistance = this.assistance(input.assistance ?? "STANDARD");
    assertValidEmergencyLocation(input.pickupLatitude, input.pickupLongitude);
    assertValidEmergencyLocation(input.destinationLatitude, input.destinationLongitude);
    const scheduledFor = new Date(input.scheduledFor);
    if (!Number.isFinite(scheduledFor.getTime())) throw new BadRequestException("scheduledFor must be a valid ISO date-time.");
    if (scheduledFor.getTime() < Date.now() + MIN_SCHEDULE_LEAD_MS) throw new BadRequestException("Scheduled medical transport must be at least 15 minutes in the future. Use Emergency Ambulance for urgent care transport.");

    const existing = await this.prisma.medicalTransportRequest.findUnique({
      where: { patientId_clientRequestId: { patientId: patient.id, clientRequestId } },
    });
    if (existing) return this.patientEnvelope(patient.id, existing.id);

    let requestId: string;
    try {
      requestId = await this.prisma.$transaction(async (tx) => {
        const request = await tx.medicalTransportRequest.create({
          data: {
            patientId: patient.id,
            mode,
            assistance,
            scheduledFor,
            pickupLatitude: input.pickupLatitude,
            pickupLongitude: input.pickupLongitude,
            destinationLatitude: input.destinationLatitude,
            destinationLongitude: input.destinationLongitude,
            clientRequestId,
            ...(input.pickupAddress?.trim() ? { pickupAddress: input.pickupAddress.trim().slice(0, 500) } : {}),
            ...(input.destinationAddress?.trim() ? { destinationAddress: input.destinationAddress.trim().slice(0, 500) } : {}),
            ...(input.callbackPhone?.trim() ? { callbackPhone: input.callbackPhone.trim().slice(0, 80) } : {}),
          },
        });
        await tx.medicalTransportEvent.create({ data: { transportRequestId: request.id, actorAccountId: principal.accountId, toStatus: "REQUESTED" } });
        return request.id;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!this.isUniqueConflict(error)) throw error;
      const raced = await this.prisma.medicalTransportRequest.findUnique({
        where: { patientId_clientRequestId: { patientId: patient.id, clientRequestId } },
      });
      if (!raced) throw error;
      requestId = raced.id;
    }

    await this.audit.write({ actorId: principal.accountId, action: "MEDICAL_TRANSPORT_REQUESTED", objectType: "MEDICAL_TRANSPORT_REQUEST", objectId: requestId, purpose: "MEDICAL_TRANSPORT", result: "SUCCESS", metadata: { mode } });
    await this.notifyAccount(patient.userId, requestId, "requested");
    return this.patientEnvelope(patient.id, requestId);
  }

  async listPatientRequests(principal: AuthPrincipal) {
    const patient = await this.patientForAccount(principal.accountId);
    const rows = await this.prisma.medicalTransportRequest.findMany({ where: { patientId: patient.id }, orderBy: { requestedAt: "desc" }, take: 100 });
    return Promise.all(rows.map((row) => this.presentWithProvider(row)));
  }

  async getPatientRequest(principal: AuthPrincipal, requestId: string) {
    const patient = await this.patientForAccount(principal.accountId);
    return this.patientEnvelope(patient.id, requestId);
  }

  async cancelPatientRequest(principal: AuthPrincipal, requestId: string, input: MedicalTransportCancelInput) {
    const patient = await this.patientForAccount(principal.accountId);
    const reason = input.reason?.trim().slice(0, 240) || null;
    const updated = await this.prisma.$transaction(async (tx) => {
      const current = await tx.medicalTransportRequest.findUnique({ where: { id: requestId } });
      if (!current || current.patientId !== patient.id) throw new NotFoundException("Medical transport request not found.");
      if (current.status === "CANCELLED") return current;
      if (!PATIENT_CANCEL_ALLOWED.includes(current.status)) throw new ConflictException("Medical transport can no longer be cancelled by the Patient.");
      const changed = await tx.medicalTransportRequest.updateMany({
        where: { id: current.id, patientId: patient.id, status: current.status },
        data: { status: "CANCELLED", cancellationReason: reason, cancelledAt: new Date() },
      });
      if (changed.count !== 1) throw new ConflictException("Medical transport changed concurrently. Refresh and retry.");
      await tx.medicalTransportEvent.create({ data: { transportRequestId: current.id, actorAccountId: principal.accountId, fromStatus: current.status, toStatus: "CANCELLED", providerId: current.assignedProviderId } });
      return tx.medicalTransportRequest.findUniqueOrThrow({ where: { id: current.id } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    await this.audit.write({ actorId: principal.accountId, action: "MEDICAL_TRANSPORT_CANCELLED", objectType: "MEDICAL_TRANSPORT_REQUEST", objectId: updated.id, purpose: "MEDICAL_TRANSPORT", result: "SUCCESS" });
    if (updated.assignedProviderId) await this.notifyProvider(updated.assignedProviderId, updated.id, "cancelled");
    return this.patientEnvelope(patient.id, updated.id);
  }

  async operationsQueue(rawStatus?: string, rawMode?: string) {
    const status = rawStatus?.trim();
    const mode = rawMode?.trim();
    if (status && !(MedicalTransportStatuses as readonly string[]).includes(status)) throw new BadRequestException("Unsupported medical transport status.");
    if (mode && !(MedicalTransportModes as readonly string[]).includes(mode)) throw new BadRequestException("Unsupported medical transport mode.");
    const rows = await this.prisma.medicalTransportRequest.findMany({
      where: {
        ...(status ? { status: status as MedicalTransportStatus } : {}),
        ...(mode ? { mode: mode as MedicalTransportMode } : {}),
      },
      orderBy: [{ scheduledFor: "asc" }, { requestedAt: "asc" }],
      take: 200,
    });
    return Promise.all(rows.map((row) => this.presentOperational(row)));
  }

  async assign(principal: AuthPrincipal, requestId: string, input: MedicalTransportAssignmentInput) {
    const current = await this.prisma.medicalTransportRequest.findUnique({ where: { id: requestId } });
    if (!current) throw new NotFoundException("Medical transport request not found.");
    const provider = await this.requireEligibleProviderById(input.providerId, this.familyForMode(current.mode));
    return this.assignProvider(principal, current.id, provider, this.optionalEta(input.etaMinutes), "OPERATIONS");
  }

  async providerAvailable(principal: AuthPrincipal) {
    const provider = await this.requireTransportResponder(principal.accountId);
    const rows = await this.prisma.medicalTransportRequest.findMany({
      where: { mode: provider.mode, status: "REQUESTED", assignedProviderId: null, scheduledFor: { gte: new Date() } },
      orderBy: { scheduledFor: "asc" },
      take: 100,
    });
    return Promise.all(rows.map((row) => this.presentOperational(row)));
  }

  async providerAccept(principal: AuthPrincipal, requestId: string) {
    const provider = await this.requireTransportResponder(principal.accountId);
    const current = await this.prisma.medicalTransportRequest.findUnique({ where: { id: requestId } });
    if (!current || current.mode !== provider.mode) throw new NotFoundException("Available medical transport request not found.");
    return this.assignProvider(principal, current.id, provider, undefined, "PROVIDER_ACCEPT");
  }

  async providerJobs(principal: AuthPrincipal) {
    const provider = await this.requireTransportResponder(principal.accountId);
    const rows = await this.prisma.medicalTransportRequest.findMany({ where: { assignedProviderId: provider.id }, orderBy: { scheduledFor: "desc" }, take: 100 });
    return Promise.all(rows.map((row) => this.presentOperational(row)));
  }

  async providerUpdate(principal: AuthPrincipal, requestId: string, input: MedicalTransportResponderUpdateInput) {
    const provider = await this.requireTransportResponder(principal.accountId);
    const target = input.status;
    const etaMinutes = this.optionalEta(input.etaMinutes);
    const updated = await this.prisma.$transaction(async (tx) => {
      const current = await tx.medicalTransportRequest.findUnique({ where: { id: requestId } });
      if (!current || current.assignedProviderId !== provider.id || current.mode !== provider.mode) throw new NotFoundException("Assigned medical transport job not found.");
      if (current.status === target) {
        if (etaMinutes !== undefined && etaMinutes !== current.etaMinutes) return tx.medicalTransportRequest.update({ where: { id: current.id }, data: { etaMinutes } });
        return current;
      }
      if (RESPONDER_NEXT[current.status] !== target) throw new ConflictException(`Medical transport status must progress from ${current.status} to ${RESPONDER_NEXT[current.status] ?? "a terminal state"}.`);
      const timestampData = target === "EN_ROUTE" ? { enRouteAt: new Date() }
        : target === "ARRIVED" ? { arrivedAt: new Date() }
        : target === "TRANSPORTING" ? { transportingAt: new Date() }
        : target === "COMPLETED" ? { completedAt: new Date() }
        : {};
      const changed = await tx.medicalTransportRequest.updateMany({
        where: { id: current.id, assignedProviderId: provider.id, status: current.status },
        data: { status: target, ...timestampData, ...(etaMinutes !== undefined ? { etaMinutes } : {}) },
      });
      if (changed.count !== 1) throw new ConflictException("Medical transport job changed concurrently. Refresh and retry.");
      await tx.medicalTransportEvent.create({ data: { transportRequestId: current.id, actorAccountId: principal.accountId, fromStatus: current.status, toStatus: target, providerId: provider.id, ...(etaMinutes !== undefined ? { etaMinutes } : {}) } });
      return tx.medicalTransportRequest.findUniqueOrThrow({ where: { id: current.id } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    await this.audit.write({ actorId: principal.accountId, action: `MEDICAL_TRANSPORT_${target}`, objectType: "MEDICAL_TRANSPORT_REQUEST", objectId: updated.id, purpose: "MEDICAL_TRANSPORT", result: "SUCCESS", metadata: { providerId: provider.id } });
    await this.notifyPatientById(updated.patientId, updated.id, target.toLowerCase());
    return this.operationalEnvelope(updated.id);
  }

  private async assignProvider(
    principal: AuthPrincipal,
    requestId: string,
    provider: { id: string; userId: string; mode: MedicalTransportMode },
    etaMinutes: number | undefined,
    source: string,
  ) {
    const updated = await this.prisma.$transaction(async (tx) => {
      const current = await tx.medicalTransportRequest.findUnique({ where: { id: requestId } });
      if (!current || current.mode !== provider.mode) throw new NotFoundException("Medical transport request not found for this provider domain.");
      if (current.status === "ASSIGNED" && current.assignedProviderId === provider.id) {
        if (etaMinutes !== undefined && etaMinutes !== current.etaMinutes) return tx.medicalTransportRequest.update({ where: { id: current.id }, data: { etaMinutes } });
        return current;
      }
      if (current.status !== "REQUESTED" || current.assignedProviderId !== null) throw new ConflictException("Medical transport request has already been assigned or is no longer available.");
      const changed = await tx.medicalTransportRequest.updateMany({
        where: { id: current.id, status: "REQUESTED", assignedProviderId: null },
        data: { status: "ASSIGNED", assignedProviderId: provider.id, assignedAt: new Date(), ...(etaMinutes !== undefined ? { etaMinutes } : {}) },
      });
      if (changed.count !== 1) throw new ConflictException("Medical transport was assigned concurrently to another provider.");
      await tx.medicalTransportEvent.create({ data: { transportRequestId: current.id, actorAccountId: principal.accountId, fromStatus: "REQUESTED", toStatus: "ASSIGNED", providerId: provider.id, ...(etaMinutes !== undefined ? { etaMinutes } : {}) } });
      return tx.medicalTransportRequest.findUniqueOrThrow({ where: { id: current.id } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    await this.audit.write({ actorId: principal.accountId, action: "MEDICAL_TRANSPORT_ASSIGNED", objectType: "MEDICAL_TRANSPORT_REQUEST", objectId: updated.id, purpose: "MEDICAL_TRANSPORT", result: "SUCCESS", metadata: { providerId: provider.id, source } });
    await Promise.all([
      this.notifyPatientById(updated.patientId, updated.id, "assigned"),
      this.notifyAccount(provider.userId, updated.id, "assigned"),
    ]);
    return this.operationalEnvelope(updated.id);
  }

  private async patientEnvelope(patientId: string, requestId: string) {
    const request = await this.prisma.medicalTransportRequest.findFirst({ where: { id: requestId, patientId } });
    if (!request) throw new NotFoundException("Medical transport request not found.");
    const history = await this.prisma.medicalTransportEvent.findMany({ where: { transportRequestId: request.id }, orderBy: { occurredAt: "asc" } });
    return { request: await this.presentWithProvider(request), history };
  }

  private async operationalEnvelope(requestId: string) {
    const request = await this.prisma.medicalTransportRequest.findUnique({ where: { id: requestId } });
    if (!request) throw new NotFoundException("Medical transport request not found.");
    const history = await this.prisma.medicalTransportEvent.findMany({ where: { transportRequestId: request.id }, orderBy: { occurredAt: "asc" } });
    return { ...(await this.presentOperational(request)), history };
  }

  private async presentOperational(row: any) {
    const patient = await this.prisma.patientProfile.findUnique({ where: { id: row.patientId }, select: { id: true, firstName: true, lastName: true, phone: true } });
    return { ...(await this.presentWithProvider(row)), patient };
  }

  private async presentWithProvider(row: any) {
    const provider = row.assignedProviderId ? await this.prisma.provider.findUnique({ where: { id: row.assignedProviderId }, select: { id: true, displayName: true } }) : null;
    return { ...this.present(row), assignedProvider: provider };
  }

  private present(row: any) {
    return {
      id: row.id,
      patientId: row.patientId,
      mode: row.mode,
      status: row.status,
      assistance: row.assistance,
      scheduledFor: this.iso(row.scheduledFor),
      pickupLatitude: Number(row.pickupLatitude),
      pickupLongitude: Number(row.pickupLongitude),
      pickupAddress: row.pickupAddress ?? null,
      destinationLatitude: Number(row.destinationLatitude),
      destinationLongitude: Number(row.destinationLongitude),
      destinationAddress: row.destinationAddress ?? null,
      callbackPhone: row.callbackPhone ?? null,
      assignedProviderId: row.assignedProviderId ?? null,
      etaMinutes: row.etaMinutes ?? null,
      cancellationReason: row.cancellationReason ?? null,
      requestedAt: this.iso(row.requestedAt),
      updatedAt: this.iso(row.updatedAt),
    };
  }

  private async patientForAccount(accountId: string) {
    const patient = await this.prisma.patientProfile.findUnique({ where: { userId: accountId }, select: { id: true, userId: true } });
    if (!patient) throw new NotFoundException("Patient profile not found.");
    return patient;
  }

  private async requireTransportResponder(accountId: string) {
    const provider = await this.prisma.provider.findUnique({ where: { userId: accountId }, include: { otherProviderProfile: { include: { category: true } } } });
    const family = provider?.otherProviderProfile?.category.family;
    if (!provider || provider.class !== "OTHER_PROVIDER" || provider.status !== "ACTIVE" || (family !== "MEDICAL_TRANSPORT_GROUND" && family !== "MEDICAL_TRANSPORT_AIR")) {
      throw new ForbiddenException("This Other Provider account is not authorized for scheduled medical transport.");
    }
    return { id: provider.id, userId: accountId, mode: family === "MEDICAL_TRANSPORT_AIR" ? "AIR" as const : "GROUND" as const };
  }

  private async requireEligibleProviderById(providerId: string, family: "MEDICAL_TRANSPORT_GROUND" | "MEDICAL_TRANSPORT_AIR") {
    const provider = await this.prisma.provider.findUnique({ where: { id: providerId }, include: { otherProviderProfile: { include: { category: true } } } });
    if (!provider || !provider.userId || provider.class !== "OTHER_PROVIDER" || provider.status !== "ACTIVE" || provider.otherProviderProfile?.category.family !== family) {
      throw new BadRequestException("Assigned provider is not active in the required medical transport family.");
    }
    return { id: provider.id, userId: provider.userId, mode: family === "MEDICAL_TRANSPORT_AIR" ? "AIR" as const : "GROUND" as const };
  }

  private familyForMode(mode: MedicalTransportMode): "MEDICAL_TRANSPORT_GROUND" | "MEDICAL_TRANSPORT_AIR" {
    return mode === "AIR" ? "MEDICAL_TRANSPORT_AIR" : "MEDICAL_TRANSPORT_GROUND";
  }

  private transportMode(value: unknown): MedicalTransportMode {
    if (typeof value !== "string" || !(MedicalTransportModes as readonly string[]).includes(value)) throw new BadRequestException("mode must be GROUND or AIR.");
    return value as MedicalTransportMode;
  }

  private assistance(value: unknown): "STANDARD" | "WHEELCHAIR" | "STRETCHER" {
    if (typeof value !== "string" || !(MedicalTransportAssistanceLevels as readonly string[]).includes(value)) throw new BadRequestException("Unsupported medical transport assistance level.");
    return value as "STANDARD" | "WHEELCHAIR" | "STRETCHER";
  }

  private optionalEta(value: unknown): number | undefined {
    if (value === undefined) return undefined;
    if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 1440) throw new BadRequestException("etaMinutes must be an integer between 0 and 1440.");
    return Number(value);
  }

  private requiredText(value: unknown, min: number, max: number, field: string): string {
    if (typeof value !== "string") throw new BadRequestException(`${field} must be text.`);
    const text = value.trim();
    if (text.length < min || text.length > max) throw new BadRequestException(`${field} must contain between ${min} and ${max} characters.`);
    return text;
  }

  private async notifyPatientById(patientId: string, requestId: string, phase: string) {
    const patient = await this.prisma.patientProfile.findUnique({ where: { id: patientId }, select: { userId: true } });
    if (patient) await this.notifyAccount(patient.userId, requestId, phase);
  }

  private async notifyProvider(providerId: string, requestId: string, phase: string) {
    const provider = await this.prisma.provider.findUnique({ where: { id: providerId }, select: { userId: true } });
    if (provider?.userId) await this.notifyAccount(provider.userId, requestId, phase);
  }

  private async notifyAccount(accountId: string, requestId: string, phase: string) {
    await this.notifications.notifyAccount({
      accountId,
      dedupeKey: `transport:${requestId}:${phase}`,
      type: "TRANSPORT_UPDATE",
      entityType: "MEDICAL_TRANSPORT_REQUEST",
      entityId: requestId,
      safeTitleKey: "notification.transport.title",
      safeBodyKey: "notification.transport.body",
    });
  }

  private iso(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : value;
  }

  private isUniqueConflict(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002";
  }
}

@RequirePermissions("PATIENT_TRANSPORT_REQUEST")
@Controller("medical-transport")
class PatientMedicalTransportController {
  constructor(private readonly service: MedicalTransportService) {}

  @Post()
  create(@CurrentPrincipal() principal: AuthPrincipal, @Body() input: CreateMedicalTransportRequestInput) {
    return this.service.createPatientRequest(principal, input);
  }

  @Get()
  list(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.service.listPatientRequests(principal);
  }

  @Get(":id")
  get(@CurrentPrincipal() principal: AuthPrincipal, @Param("id") id: string) {
    return this.service.getPatientRequest(principal, id);
  }

  @Post(":id/cancel")
  cancel(@CurrentPrincipal() principal: AuthPrincipal, @Param("id") id: string, @Body() input: MedicalTransportCancelInput) {
    return this.service.cancelPatientRequest(principal, id, input);
  }
}

@RequirePermissions("TRANSPORT_OPERATE")
@Controller("operations/medical-transport")
class MedicalTransportOperationsController {
  constructor(private readonly service: MedicalTransportService) {}

  @Get()
  queue(@Query("status") status?: string, @Query("mode") mode?: string) {
    return this.service.operationsQueue(status, mode);
  }

  @Post(":id/assign")
  assign(@CurrentPrincipal() principal: AuthPrincipal, @Param("id") id: string, @Body() input: MedicalTransportAssignmentInput) {
    return this.service.assign(principal, id, input);
  }
}

@RequirePermissions("TRANSPORT_RESPOND")
@Controller("provider/medical-transport")
class MedicalTransportResponderController {
  constructor(private readonly service: MedicalTransportService) {}

  @Get("available")
  available(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.service.providerAvailable(principal);
  }

  @Get()
  jobs(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.service.providerJobs(principal);
  }

  @Post(":id/accept")
  accept(@CurrentPrincipal() principal: AuthPrincipal, @Param("id") id: string) {
    return this.service.providerAccept(principal, id);
  }

  @Post(":id/status")
  status(@CurrentPrincipal() principal: AuthPrincipal, @Param("id") id: string, @Body() input: MedicalTransportResponderUpdateInput) {
    return this.service.providerUpdate(principal, id, input);
  }
}

@Module({
  imports: [CommunicationsModule],
  controllers: [PatientMedicalTransportController, MedicalTransportOperationsController, MedicalTransportResponderController],
  providers: [MedicalTransportService],
})
export class TransportModule {}
