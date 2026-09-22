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
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import {
  parseProviderCategoryCapabilities,
  type OtherProviderWorkflowCapability,
} from "../providers/provider-category-capabilities";

const JOB_KINDS = ["HOME_VISIT", "MEDICAL_TRANSPORT"] as const;
type FieldJobKind = (typeof JOB_KINDS)[number];
type FieldJobAction =
  | "ARRIVE"
  | "COMPLETE_WITH_CHECKLIST"
  | "ACCEPT_ASSIGNMENT"
  | "REJECT_ASSIGNMENT"
  | "CONFIRM_EQUIPMENT";

type ProviderContext = {
  providerId: string;
  capabilities: Set<OtherProviderWorkflowCapability>;
};

@Injectable()
class ProviderFieldJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
  ) {}

  async detail(principal: AuthPrincipal, kindInput: string, jobIdInput: string) {
    const provider = await this.providerContext(principal);
    const kind = this.jobKind(kindInput);
    const jobId = this.identifier(jobIdInput, "jobId");
    const result = kind === "HOME_VISIT"
      ? await this.homeVisitDetail(provider, jobId)
      : await this.transportDetail(provider, jobId);

    await this.auditRead(principal, provider.providerId, kind, jobId, "OTHER_PROVIDER_FIELD_JOB_READ", {
      status: result.status,
      allowedActionCount: result.allowedActions.length,
    });
    return result;
  }

  async events(principal: AuthPrincipal, kindInput: string, jobIdInput: string) {
    const provider = await this.providerContext(principal);
    const kind = this.jobKind(kindInput);
    const jobId = this.identifier(jobIdInput, "jobId");
    await this.assertAssigned(provider.providerId, kind, jobId);

    const workflowEvents = await this.prisma.providerWorkflowEvent.findMany({
      where: {
        providerId: provider.providerId,
        contextType: kind === "HOME_VISIT" ? "APPOINTMENT" : "MEDICAL_TRANSPORT",
        contextId: jobId,
      },
      select: { id: true, eventType: true, occurredAt: true },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      take: 500,
    });

    const items: Array<{
      id: string;
      source: "PROVIDER_WORKFLOW" | "TRANSPORT_LIFECYCLE";
      eventType: string;
      occurredAt: string;
      fromStatus?: string | null;
      toStatus?: string;
    }> = workflowEvents.map((event) => ({
      id: event.id,
      source: "PROVIDER_WORKFLOW",
      eventType: event.eventType,
      occurredAt: event.occurredAt.toISOString(),
    }));

    if (kind === "MEDICAL_TRANSPORT") {
      const lifecycle = await this.prisma.medicalTransportEvent.findMany({
        where: { transportRequestId: jobId, providerId: provider.providerId },
        select: { id: true, fromStatus: true, toStatus: true, occurredAt: true },
        orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
        take: 500,
      });
      items.push(...lifecycle.map((event) => ({
        id: event.id,
        source: "TRANSPORT_LIFECYCLE" as const,
        eventType: "TRANSPORT_STATUS_CHANGED",
        fromStatus: event.fromStatus,
        toStatus: event.toStatus,
        occurredAt: event.occurredAt.toISOString(),
      })));
    }

    items.sort((left, right) =>
      Date.parse(left.occurredAt) - Date.parse(right.occurredAt) || left.id.localeCompare(right.id),
    );

    await this.auditRead(principal, provider.providerId, kind, jobId, "OTHER_PROVIDER_FIELD_JOB_EVENTS_READ", {
      eventCount: items.length,
      evidencePayloadExposed: false,
    });

    return {
      jobId,
      kind,
      items,
      evidencePayloadExposed: false,
      autonomousClinicalDecision: false,
    };
  }

  private async homeVisitDetail(provider: ProviderContext, jobId: string) {
    const appointment = await this.prisma.appointment.findFirst({
      where: { id: jobId, providerId: provider.providerId, modality: "HOME_VISIT" },
      select: {
        id: true,
        patientId: true,
        serviceId: true,
        status: true,
        startsAt: true,
        endsAt: true,
      },
    });
    if (!appointment) throw new NotFoundException("Assigned home-visit job not found.");

    const workflowEvents = await this.prisma.providerWorkflowEvent.findMany({
      where: { providerId: provider.providerId, contextType: "APPOINTMENT", contextId: appointment.id },
      select: { eventType: true },
      take: 500,
    });
    const eventTypes = new Set(workflowEvents.map((event) => event.eventType));
    const allowedActions: FieldJobAction[] = [];
    if (
      appointment.status === "CONFIRMED"
      && provider.capabilities.has("HOME_VISIT_ARRIVAL")
      && !eventTypes.has("HOME_VISIT_ARRIVED")
    ) {
      allowedActions.push("ARRIVE");
    }
    if (
      (appointment.status === "CONFIRMED" || appointment.status === "COMPLETED")
      && provider.capabilities.has("SERVICE_COMPLETION_CHECKLIST")
      && !eventTypes.has("SERVICE_COMPLETION_CHECKLIST_CONFIRMED")
    ) {
      allowedActions.push("COMPLETE_WITH_CHECKLIST");
    }

    return {
      id: `HOME_VISIT:${appointment.id}`,
      jobId: appointment.id,
      kind: "HOME_VISIT" as const,
      status: appointment.status,
      patientId: appointment.patientId,
      serviceId: appointment.serviceId,
      scheduledAt: appointment.startsAt.toISOString(),
      scheduledEndAt: appointment.endsAt.toISOString(),
      allowedActions,
      actionHref: {
        ARRIVE: `/api/v1/provider/workflows/home-visits/${appointment.id}/arrive`,
        COMPLETE_WITH_CHECKLIST: `/api/v1/provider/workflows/home-visits/${appointment.id}/complete`,
      },
      stateSource: "APPOINTMENT",
      eventSource: "PROVIDER_WORKFLOW_EVENT",
      autonomousClinicalDecision: false,
    };
  }

  private async transportDetail(provider: ProviderContext, jobId: string) {
    const request = await this.prisma.medicalTransportRequest.findFirst({
      where: { id: jobId, assignedProviderId: provider.providerId },
      select: {
        id: true,
        patientId: true,
        status: true,
        mode: true,
        assistance: true,
        equipment: true,
        scheduledFor: true,
        etaMinutes: true,
        assignedAt: true,
        enRouteAt: true,
        arrivedAt: true,
        transportingAt: true,
        completedAt: true,
      },
    });
    if (!request) throw new NotFoundException("Assigned medical-transport job not found.");

    const accepted = await this.prisma.providerWorkflowEvent.findFirst({
      where: {
        providerId: provider.providerId,
        contextType: "MEDICAL_TRANSPORT",
        contextId: request.id,
        eventType: "TRANSPORT_ASSIGNMENT_ACCEPTED",
      },
      select: { id: true },
    });
    const allowedActions: FieldJobAction[] = [];
    if (request.status === "ASSIGNED" && provider.capabilities.has("TRANSPORT_ACCEPT") && !accepted) {
      allowedActions.push("ACCEPT_ASSIGNMENT");
    }
    if (request.status === "ASSIGNED" && provider.capabilities.has("TRANSPORT_REJECT")) {
      allowedActions.push("REJECT_ASSIGNMENT");
    }
    if (
      ["ASSIGNED", "EN_ROUTE", "ARRIVED", "TRANSPORTING"].includes(request.status)
      && provider.capabilities.has("TRANSPORT_EQUIPMENT_CHECKLIST")
    ) {
      allowedActions.push("CONFIRM_EQUIPMENT");
    }

    return {
      id: `MEDICAL_TRANSPORT:${request.id}`,
      jobId: request.id,
      kind: "MEDICAL_TRANSPORT" as const,
      status: request.status,
      patientId: request.patientId,
      mode: request.mode,
      assistance: request.assistance,
      equipment: request.equipment,
      scheduledAt: request.scheduledFor.toISOString(),
      etaMinutes: request.etaMinutes,
      milestones: {
        assignedAt: request.assignedAt?.toISOString() ?? null,
        enRouteAt: request.enRouteAt?.toISOString() ?? null,
        arrivedAt: request.arrivedAt?.toISOString() ?? null,
        transportingAt: request.transportingAt?.toISOString() ?? null,
        completedAt: request.completedAt?.toISOString() ?? null,
      },
      allowedActions,
      actionHref: {
        ACCEPT_ASSIGNMENT: `/api/v1/provider/workflows/medical-transport/${request.id}/accept-assignment`,
        REJECT_ASSIGNMENT: `/api/v1/provider/workflows/medical-transport/${request.id}/reject`,
        CONFIRM_EQUIPMENT: `/api/v1/provider/workflows/medical-transport/${request.id}/equipment-confirm`,
      },
      stateSource: "MEDICAL_TRANSPORT_REQUEST",
      eventSource: "PROVIDER_WORKFLOW_EVENT+MEDICAL_TRANSPORT_EVENT",
      autonomousClinicalDecision: false,
    };
  }

  private async assertAssigned(providerId: string, kind: FieldJobKind, jobId: string) {
    if (kind === "HOME_VISIT") {
      const row = await this.prisma.appointment.findFirst({
        where: { id: jobId, providerId, modality: "HOME_VISIT" },
        select: { id: true },
      });
      if (!row) throw new NotFoundException("Assigned home-visit job not found.");
      return;
    }
    const row = await this.prisma.medicalTransportRequest.findFirst({
      where: { id: jobId, assignedProviderId: providerId },
      select: { id: true },
    });
    if (!row) throw new NotFoundException("Assigned medical-transport job not found.");
  }

  private async providerContext(principal: AuthPrincipal): Promise<ProviderContext> {
    const provider = await this.prisma.provider.findUnique({
      where: { userId: principal.accountId },
      include: { otherProviderProfile: { include: { category: true } } },
    });
    const category = provider?.otherProviderProfile?.category;
    if (
      !provider
      || provider.class !== "OTHER_PROVIDER"
      || provider.status !== "ACTIVE"
      || !category?.active
    ) {
      throw new ForbiddenException("An active Other Provider account is required for field jobs.");
    }
    const parsed = parseProviderCategoryCapabilities(category.capabilities);
    return { providerId: provider.id, capabilities: new Set(parsed.workflowCapabilities) };
  }

  private async auditRead(
    principal: AuthPrincipal,
    providerId: string,
    kind: FieldJobKind,
    jobId: string,
    action: string,
    metadata: Record<string, unknown>,
  ) {
    await this.audit.write({
      actorId: principal.accountId,
      action,
      objectType: kind === "HOME_VISIT" ? "APPOINTMENT" : "MEDICAL_TRANSPORT_REQUEST",
      objectId: jobId,
      purpose: "CARE_DELIVERY_OPERATIONS",
      result: "SUCCESS",
      metadata: { providerId, kind, ...metadata },
    });
  }

  private jobKind(value: string): FieldJobKind {
    const normalized = value?.trim().toUpperCase();
    if (!JOB_KINDS.includes(normalized as FieldJobKind)) {
      throw new BadRequestException(`kind must be one of ${JOB_KINDS.join(", ")}.`);
    }
    return normalized as FieldJobKind;
  }

  private identifier(value: string, field: string): string {
    const normalized = value?.trim();
    if (!normalized || !/^[A-Za-z0-9_.:-]{1,180}$/.test(normalized)) {
      throw new BadRequestException(`${field} is invalid.`);
    }
    return normalized;
  }
}

@Controller("provider/jobs")
class ProviderFieldJobsController {
  constructor(private readonly jobs: ProviderFieldJobsService) {}

  @RequirePermissions("OTHER_PROVIDER_WORKFLOW_EXECUTE")
  @Get(":kind/:jobId/events")
  @Header("Cache-Control", "no-store")
  events(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("kind") kind: string,
    @Param("jobId") jobId: string,
  ) {
    return this.jobs.events(principal, kind, jobId);
  }

  @RequirePermissions("OTHER_PROVIDER_WORKFLOW_EXECUTE")
  @Get(":kind/:jobId")
  @Header("Cache-Control", "no-store")
  detail(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("kind") kind: string,
    @Param("jobId") jobId: string,
  ) {
    return this.jobs.detail(principal, kind, jobId);
  }
}

@Module({
  controllers: [ProviderFieldJobsController],
  providers: [ProviderFieldJobsService],
})
export class ProviderFieldJobsModule {}
