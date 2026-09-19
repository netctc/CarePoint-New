import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import type { EncryptedEnvelope } from "@carepoint/security";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { ClinicalEnvelopeService } from "../clinical/clinical-envelope.service";
import { ProviderCategoryCapabilityService } from "../providers/provider-category-capability.service";

const LOOKBACK_DAYS = 365;
const LOOKAHEAD_DAYS = 30;

export interface CompleteHomeVisitInput {
  checklist: {
    patientIdentityConfirmed: boolean;
    serviceCompleted: boolean;
    followUpCommunicated: boolean;
  };
  formResponseId?: string | null;
}

@Injectable()
export class ProviderCapabilityWorkspaceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly envelope: ClinicalEnvelopeService,
    private readonly capabilities: ProviderCategoryCapabilityService,
  ) {}

  async workspace(principal: AuthPrincipal) {
    const context = await this.capabilities.workspaceContext(principal);
    const now = new Date();
    const [homeVisits, transports] = await Promise.all([
      context.workflowCapabilities.includes("HOME_VISIT")
        ? this.prisma.appointment.findMany({
            where: {
              providerId: context.providerId,
              modality: "HOME_VISIT",
              status: "CONFIRMED",
              endsAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
            },
            select: {
              id: true,
              patientId: true,
              startsAt: true,
              endsAt: true,
              status: true,
              patient: { select: { firstName: true, lastName: true } },
            },
            orderBy: { startsAt: "asc" },
            take: 100,
          })
        : Promise.resolve([]),
      context.workflowCapabilities.includes("TRANSPORT")
        ? this.prisma.medicalTransportRequest.findMany({
            where: {
              assignedProviderId: context.providerId,
              status: { in: ["ASSIGNED", "EN_ROUTE", "ARRIVED", "TRANSPORTING"] },
            },
            select: {
              id: true,
              patientId: true,
              mode: true,
              status: true,
              assistance: true,
              equipment: true,
              scheduledFor: true,
              etaMinutes: true,
            },
            orderBy: { scheduledFor: "asc" },
            take: 100,
          })
        : Promise.resolve([]),
    ]);

    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "PROVIDER_CAPABILITY_WORKSPACE_READ",
      objectType: "PROVIDER",
      objectId: context.providerId,
      purpose: "SERVICE_DELIVERY",
      result: "SUCCESS",
      metadata: {
        domain: "PROVIDER_WORKSPACE",
        providerId: context.providerId,
        categoryId: context.categoryId,
        itemCount: homeVisits.length + transports.length,
        decision: "ALLOW",
      },
    });

    return {
      providerId: context.providerId,
      category: {
        id: context.categoryId,
        slug: context.categorySlug,
        family: context.categoryFamily,
      },
      capabilities: {
        enabledModalities: context.enabledModalities,
        clinicalOrderCapabilities: context.clinicalOrderCapabilities,
        clinicalReadCapabilities: context.clinicalReadCapabilities,
        workflowCapabilities: context.workflowCapabilities,
      },
      queues: { homeVisits, transports },
      security: {
        capabilityDriven: true,
        clinicalConsentRequired: true,
        automatedClinicalInference: false,
      },
    };
  }

  async patientSummary(principal: AuthPrincipal, patientId: string) {
    const context = await this.capabilities.workspaceContext(principal);
    const patient = await this.prisma.patientProfile.findUnique({
      where: { id: patientId },
      select: { id: true, firstName: true, lastName: true },
    });
    if (!patient) throw new NotFoundException("Patient not found.");
    await this.assertTreatmentRelationship(context.providerId, patient.id);

    const [facts, observations] = await Promise.all([
      context.clinicalReadCapabilities.includes("CLINICAL_FACTS")
        ? this.factSection(context.providerId, patient.id)
        : Promise.resolve({ state: "RESTRICTED" as const, items: [] as unknown[] }),
      context.clinicalReadCapabilities.includes("OBSERVATIONS")
        ? this.observationSection(context.providerId, patient.id)
        : Promise.resolve({ state: "RESTRICTED" as const, items: [] as unknown[] }),
    ]);

    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "PROVIDER_SCOPED_CLINICAL_SUMMARY_READ",
      objectType: "PATIENT",
      objectId: patient.id,
      purpose: "TREATMENT",
      result: "SUCCESS",
      metadata: {
        domain: "PROVIDER_WORKSPACE",
        providerId: context.providerId,
        categoryId: context.categoryId,
        patientId: patient.id,
        itemCount: facts.items.length + observations.items.length,
        decision: "ALLOW",
      },
    });

    return {
      patient,
      providerId: context.providerId,
      categoryId: context.categoryId,
      sections: { clinicalFacts: facts, observations },
      security: {
        capabilityDriven: true,
        treatmentRelationshipRequired: true,
        explicitConsentRequired: true,
        automatedClinicalInference: false,
      },
    };
  }


  async arriveHomeVisit(principal: AuthPrincipal, appointmentId: string) {
    const context = await this.capabilities.assertWorkflowCapability(principal, "HOME_VISIT");
    const appointment = await this.prisma.appointment.findFirst({
      where: {
        id: appointmentId,
        providerId: context.providerId,
        modality: "HOME_VISIT",
        status: "CONFIRMED",
      },
      select: { id: true, patientId: true },
    });
    if (!appointment) throw new NotFoundException("Assigned home visit not found.");

    const current = await this.prisma.homeVisitExecution.findUnique({
      where: { appointmentId: appointment.id },
    });
    if (current?.status === "COMPLETED") {
      throw new ConflictException("Completed home visit cannot be checked in again.");
    }

    const arrivedAt = current?.arrivedAt ?? new Date();
    const execution = await this.prisma.homeVisitExecution.upsert({
      where: { appointmentId: appointment.id },
      create: {
        appointmentId: appointment.id,
        providerId: context.providerId,
        patientId: appointment.patientId,
        status: "ARRIVED",
        arrivedAt,
      },
      update: {
        status: "ARRIVED",
        arrivedAt,
      },
    });

    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "HOME_VISIT_ARRIVED",
      objectType: "HOME_VISIT_EXECUTION",
      objectId: execution.id,
      purpose: "SERVICE_DELIVERY",
      result: "SUCCESS",
      metadata: {
        domain: "PROVIDER_WORKSPACE",
        providerId: context.providerId,
        categoryId: context.categoryId,
        patientId: appointment.patientId,
        appointmentId: appointment.id,
        resourceId: execution.id,
        decision: "ALLOW",
      },
    });
    return execution;
  }

  async completeHomeVisit(
    principal: AuthPrincipal,
    appointmentId: string,
    input: CompleteHomeVisitInput,
  ) {
    const context = await this.capabilities.assertWorkflowCapability(principal, "HOME_VISIT");
    const appointment = await this.prisma.appointment.findFirst({
      where: {
        id: appointmentId,
        providerId: context.providerId,
        modality: "HOME_VISIT",
        status: "CONFIRMED",
      },
      select: { id: true, patientId: true },
    });
    if (!appointment) throw new NotFoundException("Assigned home visit not found.");

    const checklist = this.completionChecklist(input?.checklist);
    const execution = await this.prisma.homeVisitExecution.findUnique({
      where: { appointmentId: appointment.id },
    });
    if (!execution || execution.providerId !== context.providerId || execution.status !== "ARRIVED") {
      throw new ConflictException("Home visit must be checked in before completion.");
    }

    const requiredForm = await this.prisma.providerCategoryFormDefinition.findFirst({
      where: {
        categoryId: context.categoryId,
        active: true,
        purpose: "HOME_VISIT_COMPLETION",
        versions: { some: { status: "ACTIVE" } },
      },
      select: { id: true },
    });

    let formResponseId: string | null = null;
    if (requiredForm) {
      if (!input?.formResponseId?.trim()) {
        throw new ConflictException("Active home-visit completion form must be submitted first.");
      }
      const response = await this.prisma.providerCategoryFormResponse.findFirst({
        where: {
          id: input.formResponseId.trim(),
          formDefinitionId: requiredForm.id,
          providerId: context.providerId,
          patientId: appointment.patientId,
          contextType: "HOME_VISIT",
          contextId: appointment.id,
        },
        select: { id: true },
      });
      if (!response) throw new ConflictException("Valid home-visit completion form response is required.");
      formResponseId = response.id;
    }

    const changed = await this.prisma.homeVisitExecution.updateMany({
      where: {
        id: execution.id,
        providerId: context.providerId,
        status: "ARRIVED",
      },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        completionChecklist: checklist,
        completionFormResponseId: formResponseId,
      },
    });
    if (changed.count !== 1) {
      throw new ConflictException("Home visit changed concurrently. Refresh and retry.");
    }
    const completed = await this.prisma.homeVisitExecution.findUniqueOrThrow({
      where: { id: execution.id },
    });

    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "HOME_VISIT_COMPLETED",
      objectType: "HOME_VISIT_EXECUTION",
      objectId: completed.id,
      purpose: "SERVICE_DELIVERY",
      result: "SUCCESS",
      metadata: {
        domain: "PROVIDER_WORKSPACE",
        providerId: context.providerId,
        categoryId: context.categoryId,
        patientId: appointment.patientId,
        appointmentId: appointment.id,
        resourceId: completed.id,
        decision: "ALLOW",
      },
    });
    return completed;
  }

  private async factSection(providerId: string, patientId: string) {
    const consent = await this.currentConsent(
      patientId,
      providerId,
      "CLINICAL_FACT_READ",
      "clinical-fact-v1",
    );
    if (!consent) return { state: "CONSENT_REQUIRED" as const, items: [] };

    const rows = await this.prisma.patientClinicalFact.findMany({
      where: { patientId, status: "ACTIVE" },
      orderBy: [{ kind: "asc" }, { updatedAt: "desc" }],
      take: 100,
    });
    const items = [];
    for (const row of rows) {
      const payload = await this.decrypt<{
        schemaVersion: 1;
        kind: string;
        data: Record<string, unknown>;
      }>(row);
      items.push({
        id: row.id,
        kind: row.kind,
        data: payload.data,
        version: row.version,
        verificationStatus: row.verificationStatus,
        reconciliationStatus: row.reconciliationStatus,
        sourceType: row.sourceType,
        updatedAt: row.updatedAt,
      });
    }
    return { state: "AVAILABLE" as const, accessBasis: "PATIENT_CONSENT", items };
  }

  private async observationSection(providerId: string, patientId: string) {
    const consent = await this.currentConsent(
      patientId,
      providerId,
      "OBSERVATION_READ",
      "observation-read-v1",
    );
    if (!consent) return { state: "CONSENT_REQUIRED" as const, items: [] };

    const rows = await this.prisma.observation.findMany({
      where: { patientId },
      include: {
        observationType: { select: { code: true, labels: true, category: true } },
        observationTypeVersion: { select: { version: true } },
      },
      orderBy: { observedAt: "desc" },
      take: 200,
    });
    const latest = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      if (!latest.has(row.observationType.code)) latest.set(row.observationType.code, row);
    }
    const items = [];
    for (const row of latest.values()) {
      const payload = await this.decrypt<{
        schemaVersion: 1;
        metricCode: string;
        metricVersion: number;
        canonicalValue: number;
        canonicalUnitCode: string;
        verificationStatus: string;
      }>(row);
      items.push({
        id: row.id,
        code: row.observationType.code,
        labels: row.observationType.labels,
        category: row.observationType.category,
        metricVersion: row.observationTypeVersion.version,
        value: payload.canonicalValue,
        unitCode: payload.canonicalUnitCode,
        verificationStatus: payload.verificationStatus,
        sourceType: row.sourceType,
        sourceId: row.sourceId,
        observedAt: row.observedAt,
      });
    }
    return { state: "AVAILABLE" as const, accessBasis: "PATIENT_CONSENT", items };
  }

  private async assertTreatmentRelationship(providerId: string, patientId: string) {
    const now = new Date();
    const from = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const to = new Date(now.getTime() + LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);
    const relationship = await this.prisma.appointment.findFirst({
      where: {
        providerId,
        patientId,
        status: { in: ["CONFIRMED", "COMPLETED"] },
        startsAt: { gte: from, lte: to },
      },
      select: { id: true },
    });
    if (!relationship) throw new ForbiddenException("Current treatment relationship is required.");
  }

  private currentConsent(patientId: string, providerId: string, scope: string, version: string) {
    const now = new Date();
    return this.prisma.consent.findFirst({
      where: {
        patientId,
        scope,
        version,
        purpose: "TREATMENT",
        state: "GRANTED",
        AND: [
          { OR: [{ providerId }, { providerId: null }] },
          { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        ],
      },
      select: { id: true },
      orderBy: { grantedAt: "desc" },
    });
  }


  private completionChecklist(value: CompleteHomeVisitInput["checklist"]) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new BadRequestException("completion checklist is required.");
    }
    const checklist = {
      patientIdentityConfirmed: value.patientIdentityConfirmed === true,
      serviceCompleted: value.serviceCompleted === true,
      followUpCommunicated: value.followUpCommunicated === true,
    };
    if (!checklist.patientIdentityConfirmed || !checklist.serviceCompleted || !checklist.followUpCommunicated) {
      throw new BadRequestException("All home-visit completion checklist items must be confirmed.");
    }
    return checklist;
  }

  private decrypt<T>(row: {
    algorithm: string;
    keyId: string;
    wrappedKey: string;
    iv: string;
    ciphertext: string;
  }) {
    return this.envelope.decryptRecord<T>({
      version: 1,
      algorithm: row.algorithm as EncryptedEnvelope["algorithm"],
      keyId: row.keyId,
      wrappedKey: row.wrappedKey,
      iv: row.iv,
      ciphertext: row.ciphertext,
    });
  }
}
