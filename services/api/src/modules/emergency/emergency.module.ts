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
  EmergencyAmbulanceStatuses,
  assertValidEmergencyLocation,
  type CreateEmergencyAmbulanceRequestInput,
  type EmergencyCancelInput,
  type EmergencyDispatchAssignmentInput,
  type EmergencyResponderUpdateInput,
} from "@carepoint/contracts";
import type { AuthPrincipal } from "@carepoint/identity";
import { Prisma, type EmergencyAmbulanceStatus } from "@prisma/client";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { CommunicationsModule } from "../communications/communications.module";
import { NotificationsService } from "../communications/notifications.service";

const PATIENT_CANCEL_ALLOWED: readonly EmergencyAmbulanceStatus[] = ["REQUESTED", "DISPATCHING", "ASSIGNED"];
const RESPONDER_NEXT: Partial<Record<EmergencyAmbulanceStatus, EmergencyAmbulanceStatus>> = {
  ASSIGNED: "EN_ROUTE",
  EN_ROUTE: "ARRIVED",
  ARRIVED: "TRANSPORTING",
  TRANSPORTING: "COMPLETED",
};

@Injectable()
class EmergencyAmbulanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async createPatientRequest(principal: AuthPrincipal, input: CreateEmergencyAmbulanceRequestInput) {
    const patient = await this.patientForAccount(principal.accountId);
    const clientRequestId = this.requiredText(input.clientRequestId, 8, 180, "clientRequestId");
    assertValidEmergencyLocation(input.latitude, input.longitude);

    const existing = await this.prisma.emergencyRequestIdempotency.findUnique({
      where: { patientId_clientRequestId: { patientId: patient.id, clientRequestId } },
    });
    if (existing) return this.patientEnvelope(patient.id, existing.emergencyRequestId);

    let requestId: string;
    try {
      requestId = await this.prisma.$transaction(async (tx) => {
        const request = await tx.emergencyAmbulanceRequest.create({
          data: {
            patientId: patient.id,
            latitude: input.latitude,
            longitude: input.longitude,
            ...(input.pickupAddress?.trim() ? { pickupAddress: input.pickupAddress.trim().slice(0, 500) } : {}),
            ...(input.callbackPhone?.trim() ? { callbackPhone: input.callbackPhone.trim().slice(0, 80) } : {}),
            ...(input.note?.trim() ? { note: input.note.trim().slice(0, 500) } : {}),
          },
        });
        await tx.emergencyRequestIdempotency.create({ data: { patientId: patient.id, clientRequestId, emergencyRequestId: request.id } });
        await tx.emergencyDispatchEvent.create({
          data: { emergencyRequestId: request.id, actorAccountId: principal.accountId, toStatus: "REQUESTED" },
        });
        return request.id;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!this.isUniqueConflict(error)) throw error;
      const raced = await this.prisma.emergencyRequestIdempotency.findUnique({
        where: { patientId_clientRequestId: { patientId: patient.id, clientRequestId } },
      });
      if (!raced) throw error;
      requestId = raced.emergencyRequestId;
    }

    await this.audit.write({
      actorId: principal.accountId,
      action: "EMERGENCY_AMBULANCE_REQUESTED",
      objectType: "EMERGENCY_AMBULANCE_REQUEST",
      objectId: requestId,
      purpose: "EMERGENCY_CARE",
      result: "SUCCESS",
    });
    await this.notifyPatient(patient.userId, requestId, "requested");
    return this.patientEnvelope(patient.id, requestId);
  }

  async listPatientRequests(principal: AuthPrincipal) {
    const patient = await this.patientForAccount(principal.accountId);
    const rows = await this.prisma.emergencyAmbulanceRequest.findMany({
      where: { patientId: patient.id },
      include: { assignedProvider: { select: { id: true, displayName: true } } },
      orderBy: { requestedAt: "desc" },
      take: 50,
    });
    return rows.map((row) => this.present(row));
  }

  async getPatientRequest(principal: AuthPrincipal, requestId: string) {
    const patient = await this.patientForAccount(principal.accountId);
    return this.patientEnvelope(patient.id, requestId);
  }

  async cancelPatientRequest(principal: AuthPrincipal, requestId: string, input: EmergencyCancelInput) {
    const patient = await this.patientForAccount(principal.accountId);
    const reason = input.reason?.trim().slice(0, 240) || null;
    const updated = await this.prisma.$transaction(async (tx) => {
      const current = await tx.emergencyAmbulanceRequest.findUnique({ where: { id: requestId } });
      if (!current || current.patientId !== patient.id) throw new NotFoundException("Emergency ambulance request not found.");
      if (current.status === "CANCELLED") return current;
      if (!PATIENT_CANCEL_ALLOWED.includes(current.status)) throw new ConflictException("Emergency dispatch can no longer be cancelled by the Patient.");
      const changed = await tx.emergencyAmbulanceRequest.updateMany({
        where: { id: current.id, patientId: patient.id, status: current.status },
        data: { status: "CANCELLED", note: reason ? `${current.note ? `${current.note}\n` : ""}Cancellation: ${reason}`.slice(0, 500) : current.note },
      });
      if (changed.count !== 1) throw new ConflictException("Emergency dispatch changed concurrently. Refresh and retry.");
      await tx.emergencyDispatchEvent.create({
        data: { emergencyRequestId: current.id, actorAccountId: principal.accountId, fromStatus: current.status, toStatus: "CANCELLED", providerId: current.assignedProviderId },
      });
      return tx.emergencyAmbulanceRequest.findUniqueOrThrow({ where: { id: current.id } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    await this.audit.write({ actorId: principal.accountId, action: "EMERGENCY_AMBULANCE_CANCELLED", objectType: "EMERGENCY_AMBULANCE_REQUEST", objectId: updated.id, purpose: "EMERGENCY_CARE", result: "SUCCESS" });
    if (updated.assignedProviderId) await this.notifyProvider(updated.assignedProviderId, updated.id, "cancelled");
    return this.patientEnvelope(patient.id, updated.id);
  }

  async operationsQueue(rawStatus?: string) {
    const status = rawStatus?.trim();
    if (status && !(EmergencyAmbulanceStatuses as readonly string[]).includes(status)) throw new BadRequestException("Unsupported emergency ambulance status.");
    const rows = await this.prisma.emergencyAmbulanceRequest.findMany({
      where: status ? { status: status as EmergencyAmbulanceStatus } : {},
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, phone: true } },
        assignedProvider: { select: { id: true, displayName: true } },
      },
      orderBy: [{ requestedAt: "asc" }],
      take: 200,
    });
    return rows.map((row) => ({ ...this.present(row), patient: row.patient }));
  }

  async markDispatching(principal: AuthPrincipal, requestId: string) {
    const updated = await this.transitionOperations(principal, requestId, ["REQUESTED"], "DISPATCHING");
    await this.notifyPatientById(updated.patientId, updated.id, "dispatching");
    return this.detail(updated.id);
  }

  async assign(principal: AuthPrincipal, requestId: string, input: EmergencyDispatchAssignmentInput) {
    const provider = await this.requireEligibleProviderById(input.providerId, "EMERGENCY_AMBULANCE");
    const etaMinutes = this.optionalEta(input.etaMinutes);
    const updated = await this.prisma.$transaction(async (tx) => {
      const current = await tx.emergencyAmbulanceRequest.findUnique({ where: { id: requestId } });
      if (!current) throw new NotFoundException("Emergency ambulance request not found.");
      if (current.status === "ASSIGNED" && current.assignedProviderId === provider.id) {
        if (etaMinutes !== undefined && etaMinutes !== current.etaMinutes) {
          return tx.emergencyAmbulanceRequest.update({ where: { id: current.id }, data: { etaMinutes } });
        }
        return current;
      }
      if (current.status !== "REQUESTED" && current.status !== "DISPATCHING") throw new ConflictException("Emergency request cannot be assigned from its current state.");
      const changed = await tx.emergencyAmbulanceRequest.updateMany({
        where: { id: current.id, status: current.status, assignedProviderId: current.assignedProviderId },
        data: { status: "ASSIGNED", assignedProviderId: provider.id, ...(etaMinutes !== undefined ? { etaMinutes } : {}) },
      });
      if (changed.count !== 1) throw new ConflictException("Emergency dispatch changed concurrently. Refresh and retry.");
      await tx.emergencyDispatchEvent.create({
        data: { emergencyRequestId: current.id, actorAccountId: principal.accountId, fromStatus: current.status, toStatus: "ASSIGNED", providerId: provider.id, ...(etaMinutes !== undefined ? { etaMinutes } : {}) },
      });
      return tx.emergencyAmbulanceRequest.findUniqueOrThrow({ where: { id: current.id } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    await this.audit.write({ actorId: principal.accountId, action: "EMERGENCY_AMBULANCE_ASSIGNED", objectType: "EMERGENCY_AMBULANCE_REQUEST", objectId: updated.id, purpose: "EMERGENCY_DISPATCH", result: "SUCCESS", metadata: { providerId: provider.id } });
    await Promise.all([
      this.notifyPatientById(updated.patientId, updated.id, "assigned"),
      this.notifyAccount(provider.userId, updated.id, "assigned"),
    ]);
    return this.detail(updated.id);
  }

  async providerJobs(principal: AuthPrincipal) {
    const provider = await this.requireResponder(principal.accountId, "EMERGENCY_AMBULANCE");
    const rows = await this.prisma.emergencyAmbulanceRequest.findMany({
      where: { assignedProviderId: provider.id },
      include: { patient: { select: { id: true, firstName: true, lastName: true, phone: true } } },
      orderBy: [{ requestedAt: "desc" }],
      take: 100,
    });
    return rows.map((row) => ({ ...this.present(row), patient: row.patient }));
  }

  async providerUpdate(principal: AuthPrincipal, requestId: string, input: EmergencyResponderUpdateInput) {
    const provider = await this.requireResponder(principal.accountId, "EMERGENCY_AMBULANCE");
    const etaMinutes = this.optionalEta(input.etaMinutes);
    const target = input.status;
    const updated = await this.prisma.$transaction(async (tx) => {
      const current = await tx.emergencyAmbulanceRequest.findUnique({ where: { id: requestId } });
      if (!current || current.assignedProviderId !== provider.id) throw new NotFoundException("Assigned emergency job not found.");
      if (current.status === target) {
        if (etaMinutes !== undefined && etaMinutes !== current.etaMinutes) return tx.emergencyAmbulanceRequest.update({ where: { id: current.id }, data: { etaMinutes } });
        return current;
      }
      if (RESPONDER_NEXT[current.status] !== target) throw new ConflictException(`Emergency status must progress from ${current.status} to ${RESPONDER_NEXT[current.status] ?? "a terminal state"}.`);
      const changed = await tx.emergencyAmbulanceRequest.updateMany({
        where: { id: current.id, assignedProviderId: provider.id, status: current.status },
        data: { status: target, ...(etaMinutes !== undefined ? { etaMinutes } : {}) },
      });
      if (changed.count !== 1) throw new ConflictException("Emergency job changed concurrently. Refresh and retry.");
      await tx.emergencyDispatchEvent.create({
        data: { emergencyRequestId: current.id, actorAccountId: principal.accountId, fromStatus: current.status, toStatus: target, providerId: provider.id, ...(etaMinutes !== undefined ? { etaMinutes } : {}) },
      });
      return tx.emergencyAmbulanceRequest.findUniqueOrThrow({ where: { id: current.id } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    await this.audit.write({ actorId: principal.accountId, action: `EMERGENCY_AMBULANCE_${target}`, objectType: "EMERGENCY_AMBULANCE_REQUEST", objectId: updated.id, purpose: "EMERGENCY_RESPONSE", result: "SUCCESS", metadata: { providerId: provider.id } });
    await this.notifyPatientById(updated.patientId, updated.id, target.toLowerCase());
    return this.detail(updated.id);
  }

  private async transitionOperations(principal: AuthPrincipal, requestId: string, allowed: readonly EmergencyAmbulanceStatus[], target: EmergencyAmbulanceStatus) {
    const updated = await this.prisma.$transaction(async (tx) => {
      const current = await tx.emergencyAmbulanceRequest.findUnique({ where: { id: requestId } });
      if (!current) throw new NotFoundException("Emergency ambulance request not found.");
      if (current.status === target) return current;
      if (!allowed.includes(current.status)) throw new ConflictException("Emergency request cannot transition from its current state.");
      const changed = await tx.emergencyAmbulanceRequest.updateMany({ where: { id: current.id, status: current.status }, data: { status: target } });
      if (changed.count !== 1) throw new ConflictException("Emergency dispatch changed concurrently. Refresh and retry.");
      await tx.emergencyDispatchEvent.create({ data: { emergencyRequestId: current.id, actorAccountId: principal.accountId, fromStatus: current.status, toStatus: target, providerId: current.assignedProviderId } });
      return tx.emergencyAmbulanceRequest.findUniqueOrThrow({ where: { id: current.id } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    await this.audit.write({ actorId: principal.accountId, action: `EMERGENCY_AMBULANCE_${target}`, objectType: "EMERGENCY_AMBULANCE_REQUEST", objectId: updated.id, purpose: "EMERGENCY_DISPATCH", result: "SUCCESS" });
    return updated;
  }

  private async patientEnvelope(patientId: string, requestId: string) {
    const request = await this.prisma.emergencyAmbulanceRequest.findFirst({
      where: { id: requestId, patientId },
      include: { assignedProvider: { select: { id: true, displayName: true } } },
    });
    if (!request) throw new NotFoundException("Emergency ambulance request not found.");
    const history = await this.prisma.emergencyDispatchEvent.findMany({ where: { emergencyRequestId: request.id }, orderBy: { occurredAt: "asc" } });
    return { emergencyFlow: true, bypassesProviderSearch: true, bypassesOrdinaryBooking: true, request: this.present(request), history };
  }

  private async detail(requestId: string) {
    const request = await this.prisma.emergencyAmbulanceRequest.findUnique({
      where: { id: requestId },
      include: { assignedProvider: { select: { id: true, displayName: true } }, patient: { select: { id: true, firstName: true, lastName: true, phone: true } } },
    });
    if (!request) throw new NotFoundException("Emergency ambulance request not found.");
    const history = await this.prisma.emergencyDispatchEvent.findMany({ where: { emergencyRequestId: request.id }, orderBy: { occurredAt: "asc" } });
    return { ...this.present(request), patient: request.patient, history };
  }

  private present(row: any) {
    return {
      id: row.id,
      patientId: row.patientId,
      status: row.status,
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      pickupAddress: row.pickupAddress ?? null,
      callbackPhone: row.callbackPhone ?? null,
      note: row.note ?? null,
      assignedProviderId: row.assignedProviderId ?? null,
      assignedProvider: row.assignedProvider ?? null,
      etaMinutes: row.etaMinutes ?? null,
      requestedAt: row.requestedAt instanceof Date ? row.requestedAt.toISOString() : row.requestedAt,
      updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
    };
  }

  private async patientForAccount(accountId: string) {
    const patient = await this.prisma.patientProfile.findUnique({ where: { userId: accountId }, select: { id: true, userId: true } });
    if (!patient) throw new NotFoundException("Patient profile not found.");
    return patient;
  }

  private async requireResponder(accountId: string, family: string) {
    const provider = await this.prisma.provider.findUnique({
      where: { userId: accountId },
      include: { otherProviderProfile: { include: { category: true } } },
    });
    if (!provider || provider.class !== "OTHER_PROVIDER" || provider.status !== "ACTIVE" || provider.otherProviderProfile?.category.family !== family) {
      throw new ForbiddenException("This Other Provider account is not authorized for the requested transport response domain.");
    }
    return { id: provider.id, userId: accountId, family };
  }

  private async requireEligibleProviderById(providerId: string, family: string) {
    const provider = await this.prisma.provider.findUnique({
      where: { id: providerId },
      include: { otherProviderProfile: { include: { category: true } } },
    });
    if (!provider || !provider.userId || provider.class !== "OTHER_PROVIDER" || provider.status !== "ACTIVE" || provider.otherProviderProfile?.category.family !== family) {
      throw new BadRequestException("Assigned provider is not an active eligible transport provider.");
    }
    return { id: provider.id, userId: provider.userId, displayName: provider.displayName };
  }

  private async notifyPatientById(patientId: string, requestId: string, phase: string) {
    const patient = await this.prisma.patientProfile.findUnique({ where: { id: patientId }, select: { userId: true } });
    if (patient) await this.notifyPatient(patient.userId, requestId, phase);
  }

  private async notifyPatient(accountId: string, requestId: string, phase: string) {
    await this.notifyAccount(accountId, requestId, phase);
  }

  private async notifyProvider(providerId: string, requestId: string, phase: string) {
    const provider = await this.prisma.provider.findUnique({ where: { id: providerId }, select: { userId: true } });
    if (provider?.userId) await this.notifyAccount(provider.userId, requestId, phase);
  }

  private async notifyAccount(accountId: string, requestId: string, phase: string) {
    await this.notifications.notifyAccount({
      accountId,
      dedupeKey: `emergency:${requestId}:${phase}`,
      type: "EMERGENCY_UPDATE",
      entityType: "EMERGENCY_AMBULANCE_REQUEST",
      entityId: requestId,
      safeTitleKey: "notification.emergency.title",
      safeBodyKey: "notification.emergency.body",
    });
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

  private isUniqueConflict(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002";
  }
}

@RequirePermissions("EMERGENCY_REQUEST")
@Controller("emergency/ambulance")
class PatientEmergencyAmbulanceController {
  constructor(private readonly service: EmergencyAmbulanceService) {}

  @Post()
  request(@CurrentPrincipal() principal: AuthPrincipal, @Body() input: CreateEmergencyAmbulanceRequestInput) {
    return this.service.createPatientRequest(principal, input);
  }

  @Get()
  list(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.service.listPatientRequests(principal);
  }

  @Get(":id")
  status(@CurrentPrincipal() principal: AuthPrincipal, @Param("id") id: string) {
    return this.service.getPatientRequest(principal, id);
  }

  @Post(":id/cancel")
  cancel(@CurrentPrincipal() principal: AuthPrincipal, @Param("id") id: string, @Body() input: EmergencyCancelInput) {
    return this.service.cancelPatientRequest(principal, id, input);
  }
}

@RequirePermissions("EMERGENCY_DISPATCH_OPERATE")
@Controller("operations/emergency/ambulance")
class EmergencyOperationsController {
  constructor(private readonly service: EmergencyAmbulanceService) {}

  @Get()
  queue(@Query("status") status?: string) {
    return this.service.operationsQueue(status);
  }

  @Post(":id/dispatch")
  dispatch(@CurrentPrincipal() principal: AuthPrincipal, @Param("id") id: string) {
    return this.service.markDispatching(principal, id);
  }

  @Post(":id/assign")
  assign(@CurrentPrincipal() principal: AuthPrincipal, @Param("id") id: string, @Body() input: EmergencyDispatchAssignmentInput) {
    return this.service.assign(principal, id, input);
  }
}

@RequirePermissions("EMERGENCY_RESPOND")
@Controller("provider/emergency/ambulance")
class EmergencyResponderController {
  constructor(private readonly service: EmergencyAmbulanceService) {}

  @Get()
  jobs(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.service.providerJobs(principal);
  }

  @Post(":id/status")
  status(@CurrentPrincipal() principal: AuthPrincipal, @Param("id") id: string, @Body() input: EmergencyResponderUpdateInput) {
    return this.service.providerUpdate(principal, id, input);
  }
}

@Module({
  imports: [CommunicationsModule],
  controllers: [PatientEmergencyAmbulanceController, EmergencyOperationsController, EmergencyResponderController],
  providers: [EmergencyAmbulanceService],
})
export class EmergencyModule {}
