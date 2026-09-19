import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { AuthPrincipal } from "@carepoint/identity";
import type { EncryptedEnvelope } from "@carepoint/security";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { ClinicalEnvelopeService } from "../clinical/clinical-envelope.service";
import { normalizeQuestionnaireAnswers, normalizeQuestionnaireSchema, type QuestionnaireLabels } from "../questionnaire/questionnaire.engine";
import { ProviderCategoryCapabilityService } from "../providers/provider-category-capability.service";
import {
  normalizeOptionalContextId,
  normalizeProviderFormCode,
  normalizeProviderFormContext,
  normalizeProviderFormPurpose,
  type ProviderFormContextType,
} from "./provider-category-form.engine";

type StoredProviderFormResponse = {
  schemaVersion: 1;
  formCode: string;
  formVersion: number;
  answers: Record<string, unknown>;
};

export interface CreateProviderCategoryFormInput {
  categoryId: string;
  code: string;
  labels: QuestionnaireLabels;
  purpose: string;
}

export interface CreateProviderCategoryFormVersionInput {
  schema: unknown;
}

export interface SubmitProviderCategoryFormInput {
  contextType: ProviderFormContextType;
  contextId?: string | null;
  patientId?: string | null;
  answers: unknown;
}

@Injectable()
export class ProviderCategoryFormsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly envelope: ClinicalEnvelopeService,
    private readonly capabilities: ProviderCategoryCapabilityService,
  ) {}

  adminList() {
    return this.prisma.providerCategoryFormDefinition.findMany({
      orderBy: [{ categoryId: "asc" }, { code: "asc" }],
      include: { versions: { orderBy: { version: "desc" } } },
    });
  }

  async createDefinition(_principal: AuthPrincipal, input: CreateProviderCategoryFormInput) {
    const categoryId = this.id(input?.categoryId, "categoryId");
    const category = await this.prisma.providerCategory.findUnique({
      where: { id: categoryId },
      select: { id: true, active: true },
    });
    if (!category?.active) throw new NotFoundException("Active Other Provider category not found.");
    const code = normalizeProviderFormCode(input?.code);
    const labels = this.labels(input?.labels);
    const purpose = normalizeProviderFormPurpose(input?.purpose);
    return this.prisma.providerCategoryFormDefinition.create({
      data: {
        categoryId,
        code,
        labels: labels as unknown as Prisma.InputJsonValue,
        purpose,
      },
    });
  }

  async createVersion(principal: AuthPrincipal, formId: string, input: CreateProviderCategoryFormVersionInput) {
    const definition = await this.prisma.providerCategoryFormDefinition.findUnique({
      where: { id: formId },
    });
    if (!definition?.active) throw new NotFoundException("Active provider category form not found.");
    const schema = normalizeQuestionnaireSchema(input?.schema);
    const latest = await this.prisma.providerCategoryFormVersion.findFirst({
      where: { formDefinitionId: formId },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    return this.prisma.providerCategoryFormVersion.create({
      data: {
        formDefinitionId: formId,
        version: (latest?.version ?? 0) + 1,
        status: "DRAFT",
        schema: schema as unknown as Prisma.InputJsonValue,
        createdByActorId: principal.accountId,
      },
    });
  }

  async activateVersion(principal: AuthPrincipal, formId: string, version: number) {
    if (!Number.isInteger(version) || version < 1) {
      throw new BadRequestException("version must be a positive integer.");
    }
    return this.prisma.$transaction(async (tx) => {
      const target = await tx.providerCategoryFormVersion.findUnique({
        where: { formDefinitionId_version: { formDefinitionId: formId, version } },
      });
      if (!target) throw new NotFoundException("Provider category form version not found.");
      if (target.status === "ACTIVE") return target;
      if (target.status !== "DRAFT") {
        throw new ConflictException("Only DRAFT provider category form versions can be activated.");
      }
      const now = new Date();
      await tx.providerCategoryFormVersion.updateMany({
        where: { formDefinitionId: formId, status: "ACTIVE" },
        data: { status: "RETIRED", retiredAt: now },
      });
      const active = await tx.providerCategoryFormVersion.update({
        where: { id: target.id },
        data: { status: "ACTIVE", activatedAt: now, retiredAt: null },
      });
      await this.audit.writeClinicalInTransaction(tx, {
        actorId: principal.accountId,
        action: "PROVIDER_CATEGORY_FORM_VERSION_ACTIVATED",
        objectType: "PROVIDER_CATEGORY_FORM_VERSION",
        objectId: active.id,
        purpose: "CLINICAL_CONFIGURATION",
        result: "SUCCESS",
        metadata: {
          domain: "PROVIDER_CATEGORY_FORM",
          resourceId: active.id,
          resourceVersion: active.version,
          decision: "ALLOW",
        },
      });
      return active;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async activeForProvider(principal: AuthPrincipal) {
    const context = await this.capabilities.assertWorkflowCapability(principal, "CATEGORY_FORMS");
    const definitions = await this.prisma.providerCategoryFormDefinition.findMany({
      where: { categoryId: context.categoryId, active: true },
      include: { versions: { where: { status: "ACTIVE" }, orderBy: { version: "desc" }, take: 1 } },
      orderBy: { code: "asc" },
    });
    return {
      providerId: context.providerId,
      categoryId: context.categoryId,
      items: definitions
        .filter((item) => item.versions.length > 0)
        .map((item) => ({
          id: item.id,
          code: item.code,
          labels: item.labels,
          purpose: item.purpose,
          version: item.versions[0]!.version,
          schema: item.versions[0]!.schema,
        })),
    };
  }

  async submit(principal: AuthPrincipal, code: string, input: SubmitProviderCategoryFormInput) {
    const context = await this.capabilities.assertWorkflowCapability(principal, "CATEGORY_FORMS");
    const normalizedCode = normalizeProviderFormCode(code);
    const definition = await this.prisma.providerCategoryFormDefinition.findUnique({
      where: { categoryId_code: { categoryId: context.categoryId, code: normalizedCode } },
      include: { versions: { where: { status: "ACTIVE" }, orderBy: { version: "desc" }, take: 1 } },
    });
    if (!definition?.active || definition.versions.length === 0) {
      throw new NotFoundException("Active provider category form not found.");
    }
    const version = definition.versions[0]!;
    const contextType = normalizeProviderFormContext(input?.contextType);
    const contextId = normalizeOptionalContextId(input?.contextId, contextType);
    const patientId = await this.assertOperationalContext(
      context.providerId,
      contextType,
      contextId,
      input?.patientId,
    );
    const schema = normalizeQuestionnaireSchema(version.schema);
    const answers = normalizeQuestionnaireAnswers(schema, input?.answers);
    const payload: StoredProviderFormResponse = {
      schemaVersion: 1,
      formCode: definition.code,
      formVersion: version.version,
      answers,
    };
    const encrypted = await this.envelope.encryptRecord(payload);
    const created = await this.prisma.providerCategoryFormResponse.create({
      data: {
        formDefinitionId: definition.id,
        formVersionId: version.id,
        providerId: context.providerId,
        patientId,
        contextType,
        contextId,
        ...this.envelopeData(encrypted),
      },
    });
    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "PROVIDER_CATEGORY_FORM_SUBMITTED",
      objectType: "PROVIDER_CATEGORY_FORM_RESPONSE",
      objectId: created.id,
      purpose: "SERVICE_DELIVERY",
      result: "SUCCESS",
      metadata: {
        domain: "PROVIDER_CATEGORY_FORM",
        providerId: context.providerId,
        categoryId: context.categoryId,
        ...(patientId ? { patientId } : {}),
        resourceId: created.id,
        resourceVersion: version.version,
        contextType,
        decision: "ALLOW",
      },
    });
    return {
      id: created.id,
      formCode: definition.code,
      formVersion: version.version,
      contextType,
      contextId,
      patientId,
      submittedAt: created.submittedAt,
    };
  }

  private async assertOperationalContext(
    providerId: string,
    contextType: ProviderFormContextType,
    contextId: string | null,
    requestedPatientId: unknown,
  ): Promise<string | null> {
    if (contextType === "GENERAL") {
      if (requestedPatientId !== undefined && requestedPatientId !== null && String(requestedPatientId).trim()) {
        throw new BadRequestException("GENERAL provider forms cannot bind a patient.");
      }
      return null;
    }
    if (contextType === "HOME_VISIT") {
      const appointment = await this.prisma.appointment.findFirst({
        where: { id: contextId!, providerId, modality: "HOME_VISIT", status: "CONFIRMED" },
        select: { patientId: true },
      });
      if (!appointment) throw new ForbiddenException("Assigned home-visit context is required.");
      this.assertPatientMatch(requestedPatientId, appointment.patientId);
      return appointment.patientId;
    }
    const transport = await this.prisma.medicalTransportRequest.findFirst({
      where: {
        id: contextId!,
        assignedProviderId: providerId,
        status: { in: ["ASSIGNED", "EN_ROUTE", "ARRIVED", "TRANSPORTING"] },
      },
      select: { patientId: true },
    });
    if (!transport) throw new ForbiddenException("Assigned transport context is required.");
    this.assertPatientMatch(requestedPatientId, transport.patientId);
    return transport.patientId;
  }

  private assertPatientMatch(requested: unknown, actual: string): void {
    if (requested === undefined || requested === null || requested === "") return;
    if (typeof requested !== "string" || requested.trim() !== actual) {
      throw new ForbiddenException("Patient context does not match the assigned workflow.");
    }
  }

  private id(value: unknown, field: string): string {
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(value.trim())) {
      throw new BadRequestException(field + " is invalid.");
    }
    return value.trim();
  }

  private labels(value: unknown): QuestionnaireLabels {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new BadRequestException("labels must be an object.");
    }
    const raw = value as Record<string, unknown>;
    const result: Partial<QuestionnaireLabels> = {};
    for (const locale of ["en", "ar", "fr", "es"] as const) {
      const item = raw[locale];
      if (item === undefined || item === null) continue;
      if (typeof item !== "string" || !item.trim() || item.trim().length > 300) {
        throw new BadRequestException("provider form label is invalid.");
      }
      result[locale] = item.trim();
    }
    if (!result.en) throw new BadRequestException("labels.en is required.");
    return result as QuestionnaireLabels;
  }

  private envelopeData(envelope: EncryptedEnvelope) {
    return {
      algorithm: envelope.algorithm,
      keyId: envelope.keyId,
      wrappedKey: envelope.wrappedKey,
      iv: envelope.iv,
      ciphertext: envelope.ciphertext,
    };
  }
}
