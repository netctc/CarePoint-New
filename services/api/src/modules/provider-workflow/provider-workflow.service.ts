import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { AuthPrincipal } from "@carepoint/identity";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { ProviderCategoryCapabilityService } from "../providers/provider-category-capability.service";
import {
  normalizeTransportEquipmentConfirmation,
  normalizeWorkflowReasonCode,
} from "./provider-workflow.engine";

export interface CompleteHomeVisitInput {
  formResponseId: string;
}

export interface RejectTransportInput {
  reasonCode: string;
}

export interface ConfirmTransportEquipmentInput {
  equipment: string[];
}

@Injectable()
export class ProviderWorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly capabilities: ProviderCategoryCapabilityService,
  ) {}

  async arriveHomeVisit(principal: AuthPrincipal, appointmentId: string) {
    const provider = await this.capabilities.assertWorkflowCapability(
      principal,
      "HOME_VISIT_ARRIVAL",
    );
    const appointment = await this.prisma.appointment.findFirst({
      where: {
        id: this.requiredId(appointmentId, "appointmentId"),
        providerId: provider.providerId,
        modality: "HOME_VISIT",
        status: "CONFIRMED",
      },
      select: { id: true, patientId: true, status: true },
    });
    if (!appointment) throw new NotFoundException("Assigned confirmed home visit not found.");

    const event = await this.recordOnce({
      providerId: provider.providerId,
      patientId: appointment.patientId,
      contextType: "APPOINTMENT",
      contextId: appointment.id,
      eventType: "HOME_VISIT_ARRIVED",
      evidence: { appointmentStatus: appointment.status },
      actorId: principal.accountId,
      idempotencyKey: `home-visit-arrival:${provider.providerId}:${appointment.id}`,
    });
    await this.auditWorkflow(principal, provider.providerId, appointment.patientId, event, "HOME_VISIT_ARRIVED");
    return this.present(event);
  }

  async completeHomeVisit(
    principal: AuthPrincipal,
    appointmentId: string,
    input: CompleteHomeVisitInput,
  ) {
    const provider = await this.capabilities.assertWorkflowCapability(
      principal,
      "SERVICE_COMPLETION_CHECKLIST",
    );
    const appointment = await this.prisma.appointment.findFirst({
      where: {
        id: this.requiredId(appointmentId, "appointmentId"),
        providerId: provider.providerId,
        modality: "HOME_VISIT",
        status: { in: ["CONFIRMED", "COMPLETED"] },
      },
      select: { id: true, patientId: true, status: true },
    });
    if (!appointment) throw new NotFoundException("Assigned home visit not found.");

    const formResponseId = this.requiredId(input?.formResponseId, "formResponseId");
    const response = await this.prisma.providerCategoryFormResponse.findFirst({
      where: {
        id: formResponseId,
        providerId: provider.providerId,
        patientId: appointment.patientId,
        contextType: "APPOINTMENT",
        contextId: appointment.id,
        form: {
          categoryId: provider.categoryId,
          purpose: "SERVICE_COMPLETION",
        },
      },
      select: { id: true, sequence: true },
    });
    if (!response) {
      throw new BadRequestException("A matching SERVICE_COMPLETION form response is required.");
    }

    const event = await this.recordOnce({
      providerId: provider.providerId,
      patientId: appointment.patientId,
      contextType: "APPOINTMENT",
      contextId: appointment.id,
      eventType: "SERVICE_COMPLETION_CHECKLIST_CONFIRMED",
      evidence: {
        formResponseId: response.id,
        formResponseSequence: response.sequence,
        appointmentStatus: appointment.status,
      },
      actorId: principal.accountId,
      idempotencyKey: `service-completion:${provider.providerId}:${appointment.id}`,
    });
    await this.auditWorkflow(
      principal,
      provider.providerId,
      appointment.patientId,
      event,
      "SERVICE_COMPLETION_CHECKLIST_CONFIRMED",
      { formResponseId: response.id },
    );
    return this.present(event);
  }

  async acceptAssignedTransport(
    principal: AuthPrincipal,
    requestId: string,
  ) {
    const provider = await this.capabilities.assertWorkflowCapability(
      principal,
      "TRANSPORT_ACCEPT",
    );
    const id = this.requiredId(requestId, "requestId");
    const request = await this.prisma.medicalTransportRequest.findFirst({
      where: {
        id,
        assignedProviderId: provider.providerId,
        status: "ASSIGNED",
      },
      select: { id: true, patientId: true, status: true },
    });
    if (!request) {
      throw new NotFoundException("Assigned medical transport request not found.");
    }

    const event = await this.recordOnce({
      providerId: provider.providerId,
      patientId: request.patientId,
      contextType: "MEDICAL_TRANSPORT",
      contextId: request.id,
      eventType: "TRANSPORT_ASSIGNMENT_ACCEPTED",
      evidence: { transportStatus: request.status },
      actorId: principal.accountId,
      idempotencyKey: `transport-accept:${provider.providerId}:${request.id}`,
    });
    await this.auditWorkflow(
      principal,
      provider.providerId,
      request.patientId,
      event,
      "TRANSPORT_ASSIGNMENT_ACCEPTED",
    );
    return {
      requestId: request.id,
      status: request.status,
      assignmentAccepted: true,
      workflowEvent: this.present(event),
    };
  }

  async rejectAssignedTransport(
    principal: AuthPrincipal,
    requestId: string,
    input: RejectTransportInput,
  ) {
    const provider = await this.capabilities.assertWorkflowCapability(
      principal,
      "TRANSPORT_REJECT",
    );
    const id = this.requiredId(requestId, "requestId");
    const reasonCode = normalizeWorkflowReasonCode(input?.reasonCode);

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "MedicalTransportRequest" WHERE id = ${id} FOR UPDATE`);
      const request = await tx.medicalTransportRequest.findUnique({ where: { id } });
      if (!request || request.assignedProviderId !== provider.providerId) {
        throw new NotFoundException("Assigned medical transport request not found.");
      }
      if (request.status !== "ASSIGNED") {
        throw new ConflictException("Only an ASSIGNED transport can be rejected by the assigned provider.");
      }
      const changed = await tx.medicalTransportRequest.updateMany({
        where: {
          id,
          assignedProviderId: provider.providerId,
          status: "ASSIGNED",
        },
        data: {
          status: "REQUESTED",
          assignedProviderId: null,
          assignedAt: null,
          etaMinutes: null,
        },
      });
      if (changed.count !== 1) throw new ConflictException("Medical transport changed concurrently.");
      await tx.medicalTransportEvent.create({
        data: {
          transportRequestId: id,
          actorAccountId: principal.accountId,
          fromStatus: "ASSIGNED",
          toStatus: "REQUESTED",
          providerId: provider.providerId,
        },
      });
      const event = await tx.providerWorkflowEvent.create({
        data: {
          providerId: provider.providerId,
          patientId: request.patientId,
          contextType: "MEDICAL_TRANSPORT",
          contextId: id,
          eventType: "TRANSPORT_REJECTED",
          evidence: { reasonCode } as unknown as Prisma.InputJsonValue,
          actorId: principal.accountId,
        },
      });
      await this.audit.writeClinicalInTransaction(tx, {
        actorId: principal.accountId,
        action: "OTHER_PROVIDER_TRANSPORT_REJECTED",
        objectType: "MEDICAL_TRANSPORT_REQUEST",
        objectId: id,
        purpose: "MEDICAL_TRANSPORT",
        result: "SUCCESS",
        metadata: {
          domain: "OTHER_PROVIDER_WORKFLOW",
          providerId: provider.providerId,
          patientId: request.patientId,
          contextType: "MEDICAL_TRANSPORT",
          contextId: id,
          workflowEventType: "TRANSPORT_REJECTED",
          reasonCode,
          decision: "ALLOW",
        },
      });
      return { event, requestId: id };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return {
      requestId: result.requestId,
      status: "REQUESTED",
      assignmentReleased: true,
      workflowEvent: this.present(result.event),
    };
  }

  async confirmTransportEquipment(
    principal: AuthPrincipal,
    requestId: string,
    input: ConfirmTransportEquipmentInput,
  ) {
    const provider = await this.capabilities.assertWorkflowCapability(
      principal,
      "TRANSPORT_EQUIPMENT_CHECKLIST",
    );
    const id = this.requiredId(requestId, "requestId");
    const request = await this.prisma.medicalTransportRequest.findFirst({
      where: {
        id,
        assignedProviderId: provider.providerId,
        status: { in: ["ASSIGNED", "EN_ROUTE", "ARRIVED", "TRANSPORTING"] },
      },
      select: { id: true, patientId: true, equipment: true, status: true },
    });
    if (!request) throw new NotFoundException("Assigned active medical transport request not found.");

    const equipment = normalizeTransportEquipmentConfirmation(
      request.equipment,
      input?.equipment,
    );
    const event = await this.recordOnce({
      providerId: provider.providerId,
      patientId: request.patientId,
      contextType: "MEDICAL_TRANSPORT",
      contextId: request.id,
      eventType: "TRANSPORT_EQUIPMENT_CONFIRMED",
      evidence: {
        equipment,
        transportStatus: request.status,
      },
      actorId: principal.accountId,
      idempotencyKey: `transport-equipment:${provider.providerId}:${request.id}`,
    });
    await this.auditWorkflow(
      principal,
      provider.providerId,
      request.patientId,
      event,
      "TRANSPORT_EQUIPMENT_CONFIRMED",
      { equipmentCount: equipment.length },
    );
    return {
      ...this.present(event),
      equipment,
    };
  }

  private async recordOnce(input: {
    providerId: string;
    patientId: string;
    contextType: string;
    contextId: string;
    eventType: string;
    evidence: Record<string, unknown>;
    actorId: string;
    idempotencyKey: string;
  }) {
    const existing = await this.prisma.providerWorkflowEvent.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) return existing;
    try {
      return await this.prisma.providerWorkflowEvent.create({
        data: {
          providerId: input.providerId,
          patientId: input.patientId,
          contextType: input.contextType,
          contextId: input.contextId,
          eventType: input.eventType,
          evidence: input.evidence as unknown as Prisma.InputJsonValue,
          actorId: input.actorId,
          idempotencyKey: input.idempotencyKey,
        },
      });
    } catch (error) {
      if (!this.isUniqueConflict(error)) throw error;
      const raced = await this.prisma.providerWorkflowEvent.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (!raced) throw error;
      return raced;
    }
  }

  private async auditWorkflow(
    principal: AuthPrincipal,
    providerId: string,
    patientId: string,
    event: { id: string; contextType: string; contextId: string },
    eventType: string,
    extra: Record<string, unknown> = {},
  ) {
    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "OTHER_PROVIDER_WORKFLOW_EVENT",
      objectType: "PROVIDER_WORKFLOW_EVENT",
      objectId: event.id,
      purpose: "TREATMENT",
      result: "SUCCESS",
      metadata: {
        domain: "OTHER_PROVIDER_WORKFLOW",
        providerId,
        patientId,
        resourceId: event.id,
        contextType: event.contextType,
        contextId: event.contextId,
        workflowEventType: eventType,
        decision: "ALLOW",
        ...extra,
      },
    });
  }

  private present(event: {
    id: string;
    providerId: string;
    patientId: string;
    contextType: string;
    contextId: string;
    eventType: string;
    evidence: unknown;
    occurredAt: Date;
  }) {
    return {
      id: event.id,
      providerId: event.providerId,
      patientId: event.patientId,
      contextType: event.contextType,
      contextId: event.contextId,
      eventType: event.eventType,
      evidence: event.evidence,
      occurredAt: event.occurredAt,
    };
  }

  private requiredId(value: unknown, field: string): string {
    if (typeof value !== "string") throw new BadRequestException(`${field} is required.`);
    const normalized = value.trim();
    if (!/^[A-Za-z0-9_.:-]{1,180}$/.test(normalized)) {
      throw new BadRequestException(`${field} is invalid.`);
    }
    return normalized;
  }

  private isUniqueConflict(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error &&
      (error as { code?: string }).code === "P2002";
  }
}
