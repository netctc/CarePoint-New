import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { AuthPrincipal } from "@carepoint/identity";
import type { EncryptedEnvelope } from "@carepoint/security";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { ClinicalEnvelopeService } from "../clinical/clinical-envelope.service";
import { ProviderCategoryCapabilityService } from "../providers/provider-category-capability.service";
import {
  assertProviderFormPurposeContext,
  normalizeProviderFormAnswers,
  normalizeProviderFormContextType,
  normalizeProviderFormPurpose,
  normalizeProviderFormSchema,
  type ProviderFormContextType,
  type ProviderFormPurpose,
} from "./provider-form.engine";
import type { QuestionnaireAnswers, QuestionnaireLabels, QuestionnaireSchema } from "../questionnaire/questionnaire.engine";

type StoredProviderFormResponse = {
  schemaVersion: 1;
  formCode: string;
  formVersion: number;
  purpose: ProviderFormPurpose;
  answers: QuestionnaireAnswers;
};

export interface CreateProviderCategoryFormInput {
  categoryId: string;
  code: string;
  purpose: ProviderFormPurpose;
  labels: QuestionnaireLabels;
}

export interface CreateProviderCategoryFormVersionInput {
  schema: unknown;
}

export interface SubmitProviderCategoryFormInput {
  contextType: ProviderFormContextType;
  contextId: string;
  expectedLatestSequence: number;
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

  async adminList(categoryId?: string) {
    return this.prisma.providerCategoryForm.findMany({
      where: categoryId?.trim() ? { categoryId: categoryId.trim() } : undefined,
      include: { versions: { orderBy: { version: "desc" } } },
      orderBy: [{ categoryId: "asc" }, { code: "asc" }],
    });
  }

  async createDefinition(principal: AuthPrincipal, input: CreateProviderCategoryFormInput) {
    const categoryId = this.requiredId(input?.categoryId, "categoryId");
    const category = await this.prisma.providerCategory.findUnique({
      where: { id: categoryId },
      select: { id: true, active: true },
    });
    if (!category?.active) throw new BadRequestException("Active Other Provider category is required.");
    const code = this.code(input?.code);
    const purpose = normalizeProviderFormPurpose(input?.purpose);
    const labels = this.labels(input?.labels);
    const form = await this.prisma.providerCategoryForm.create({
      data: {
        categoryId,
        code,
        purpose,
        labels: labels as unknown as Prisma.InputJsonValue,
      },
    });
    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "PROVIDER_CATEGORY_FORM_CREATED",
      objectType: "PROVIDER_CATEGORY_FORM",
      objectId: form.id,
      purpose: "CLINICAL_CONFIGURATION",
      result: "SUCCESS",
      metadata: {
        domain: "PROVIDER_CATEGORY_FORM",
        resourceId: form.id,
        formCode: form.code,
        formPurpose: form.purpose,
        decision: "ALLOW",
      },
    });
    return form;
  }

  async createVersion(
    principal: AuthPrincipal,
    formId: string,
    input: CreateProviderCategoryFormVersionInput,
  ) {
    const id = this.requiredId(formId, "formId");
    const schema = normalizeProviderFormSchema(input?.schema);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "ProviderCategoryForm" WHERE id = ${id} FOR UPDATE`);
      const form = await tx.providerCategoryForm.findUnique({ where: { id } });
      if (!form) throw new NotFoundException("Provider category form not found.");
      if (!form.active) throw new ConflictException("Provider category form is inactive.");
      const latest = await tx.providerCategoryFormVersion.findFirst({
        where: { formId: id },
        orderBy: { version: "desc" },
        select: { version: true },
      });
      const created = await tx.providerCategoryFormVersion.create({
        data: {
          formId: id,
          version: (latest?.version ?? 0) + 1,
          status: "DRAFT",
          schema: schema as unknown as Prisma.InputJsonValue,
          createdByActorId: principal.accountId,
        },
      });
      await this.audit.writeClinicalInTransaction(tx, {
        actorId: principal.accountId,
        action: "PROVIDER_CATEGORY_FORM_VERSION_CREATED",
        objectType: "PROVIDER_CATEGORY_FORM_VERSION",
        objectId: created.id,
        purpose: "CLINICAL_CONFIGURATION",
        result: "SUCCESS",
        metadata: {
          domain: "PROVIDER_CATEGORY_FORM",
          resourceId: created.id,
          resourceVersion: created.version,
          formCode: form.code,
          formPurpose: form.purpose,
          decision: "ALLOW",
        },
      });
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async activateVersion(principal: AuthPrincipal, formId: string, version: number) {
    const id = this.requiredId(formId, "formId");
    const normalizedVersion = this.positiveInteger(version, "version");
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "ProviderCategoryForm" WHERE id = ${id} FOR UPDATE`);
      const form = await tx.providerCategoryForm.findUnique({ where: { id } });
      if (!form) throw new NotFoundException("Provider category form not found.");
      const target = await tx.providerCategoryFormVersion.findUnique({
        where: { formId_version: { formId: id, version: normalizedVersion } },
      });
      if (!target) throw new NotFoundException("Provider category form version not found.");
      if (target.status === "ACTIVE") return target;
      if (target.status !== "DRAFT") throw new ConflictException("Only a DRAFT form version can be activated.");
      const now = new Date();
      await tx.providerCategoryFormVersion.updateMany({
        where: { formId: id, status: "ACTIVE" },
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
          formCode: form.code,
          formPurpose: form.purpose,
          decision: "ALLOW",
        },
      });
      return active;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async listForProvider(principal: AuthPrincipal) {
    const context = await this.capabilities.assertWorkflowCapability(principal, "CATEGORY_FORMS");
    const forms = await this.prisma.providerCategoryForm.findMany({
      where: { categoryId: context.categoryId, active: true },
      include: {
        versions: {
          where: { status: "ACTIVE" },
          orderBy: { version: "desc" },
          take: 1,
        },
      },
      orderBy: { code: "asc" },
    });
    return {
      providerId: context.providerId,
      categoryId: context.categoryId,
      items: forms
        .filter((form) => form.versions.length > 0)
        .map((form) => ({
          id: form.id,
          code: form.code,
          purpose: form.purpose,
          labels: form.labels,
          version: form.versions[0]!.version,
          schema: form.versions[0]!.schema,
        })),
    };
  }

  async submit(
    principal: AuthPrincipal,
    formCode: string,
    input: SubmitProviderCategoryFormInput,
  ) {
    const provider = await this.capabilities.assertWorkflowCapability(principal, "CATEGORY_FORMS");
    const code = this.code(formCode);
    const contextType = normalizeProviderFormContextType(input?.contextType);
    const contextId = this.requiredId(input?.contextId, "contextId");
    const expectedLatestSequence = this.nonNegativeInteger(
      input?.expectedLatestSequence,
      "expectedLatestSequence",
    );
    const patientContext = await this.resolveContext(
      provider.providerId,
      contextType,
      contextId,
    );
    const form = await this.prisma.providerCategoryForm.findFirst({
      where: { categoryId: provider.categoryId, code, active: true },
      include: {
        versions: {
          where: { status: "ACTIVE" },
          orderBy: { version: "desc" },
          take: 1,
        },
      },
    });
    if (!form || form.versions.length === 0) {
      throw new NotFoundException("Active provider category form not found.");
    }
    const active = form.versions[0]!;
    const purpose = normalizeProviderFormPurpose(form.purpose);
    assertProviderFormPurposeContext(
      purpose,
      contextType,
      patientContext.appointmentModality,
    );
    const schema = normalizeProviderFormSchema(active.schema);
    const answers = normalizeProviderFormAnswers(schema, input?.answers);
    const encrypted = await this.envelope.encryptRecord({
      schemaVersion: 1,
      formCode: form.code,
      formVersion: active.version,
      purpose,
      answers,
    } satisfies StoredProviderFormResponse);

    const response = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "Provider" WHERE id = ${provider.providerId} FOR UPDATE`);
      const latest = await tx.providerCategoryFormResponse.findFirst({
        where: {
          formId: form.id,
          providerId: provider.providerId,
          contextType,
          contextId,
        },
        orderBy: { sequence: "desc" },
        select: { sequence: true },
      });
      const currentSequence = latest?.sequence ?? 0;
      if (currentSequence !== expectedLatestSequence) {
        throw new ConflictException({
          message: "Provider form response sequence conflict.",
          currentSequence,
        });
      }
      const created = await tx.providerCategoryFormResponse.create({
        data: {
          formId: form.id,
          formVersionId: active.id,
          providerId: provider.providerId,
          patientId: patientContext.patientId,
          contextType,
          contextId,
          sequence: currentSequence + 1,
          sourceActorId: principal.accountId,
          ...this.envelopeData(encrypted),
        },
      });
      await this.audit.writeClinicalInTransaction(tx, {
        actorId: principal.accountId,
        action: "PROVIDER_CATEGORY_FORM_SUBMITTED",
        objectType: "PROVIDER_CATEGORY_FORM_RESPONSE",
        objectId: created.id,
        purpose: "TREATMENT",
        result: "SUCCESS",
        metadata: {
          domain: "PROVIDER_CATEGORY_FORM",
          providerId: provider.providerId,
          patientId: patientContext.patientId,
          resourceId: created.id,
          resourceVersion: created.sequence,
          formCode: form.code,
          formPurpose: purpose,
          contextType,
          contextId,
          decision: "ALLOW",
        },
      });
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return {
      id: response.id,
      formId: form.id,
      code: form.code,
      purpose,
      formVersion: active.version,
      sequence: response.sequence,
      patientId: response.patientId,
      contextType: response.contextType,
      contextId: response.contextId,
      submittedAt: response.submittedAt,
      encryptedAtRest: true,
    };
  }

  private async resolveContext(
    providerId: string,
    contextType: ProviderFormContextType,
    contextId: string,
  ) {
    if (contextType === "APPOINTMENT") {
      const appointment = await this.prisma.appointment.findFirst({
        where: {
          id: contextId,
          providerId,
          status: { in: ["CONFIRMED", "COMPLETED"] },
        },
        select: { patientId: true, modality: true, status: true },
      });
      if (!appointment) throw new ForbiddenException("Authorized appointment context is required.");
      return {
        patientId: appointment.patientId,
        appointmentModality: appointment.modality,
        status: appointment.status,
      };
    }
    if (contextType === "MEDICAL_TRANSPORT") {
      const request = await this.prisma.medicalTransportRequest.findFirst({
        where: {
          id: contextId,
          assignedProviderId: providerId,
          status: { in: ["ASSIGNED", "EN_ROUTE", "ARRIVED", "TRANSPORTING", "COMPLETED"] },
        },
        select: { patientId: true, status: true },
      });
      if (!request) throw new ForbiddenException("Authorized medical transport context is required.");
      return {
        patientId: request.patientId,
        appointmentModality: null,
        status: request.status,
      };
    }
    const request = await this.prisma.emergencyAmbulanceRequest.findFirst({
      where: {
        id: contextId,
        assignedProviderId: providerId,
        status: { in: ["ASSIGNED", "EN_ROUTE", "ARRIVED", "TRANSPORTING", "COMPLETED"] },
      },
      select: { patientId: true, status: true },
    });
    if (!request) throw new ForbiddenException("Authorized emergency ambulance context is required.");
    return {
      patientId: request.patientId,
      appointmentModality: null,
      status: request.status,
    };
  }

  private labels(value: unknown): QuestionnaireLabels {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new BadRequestException("labels must be an object.");
    }
    const raw = value as Record<string, unknown>;
    const output: Record<string, string> = {};
    for (const locale of ["en", "ar", "fr", "es"] as const) {
      const item = raw[locale];
      if (item == null) continue;
      if (typeof item !== "string") throw new BadRequestException(`labels.${locale} must be text.`);
      const normalized = item.trim();
      if (!normalized || normalized.length > 300) throw new BadRequestException(`labels.${locale} is invalid.`);
      output[locale] = normalized;
    }
    if (!output.en) throw new BadRequestException("labels.en is required.");
    return output as unknown as QuestionnaireLabels;
  }

  private code(value: unknown): string {
    if (typeof value !== "string") throw new BadRequestException("form code is required.");
    const normalized = value.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_]{2,79}$/.test(normalized)) {
      throw new BadRequestException("form code is invalid.");
    }
    return normalized;
  }

  private requiredId(value: unknown, field: string): string {
    if (typeof value !== "string") throw new BadRequestException(`${field} is required.`);
    const normalized = value.trim();
    if (!/^[A-Za-z0-9_.:-]{1,180}$/.test(normalized)) throw new BadRequestException(`${field} is invalid.`);
    return normalized;
  }

  private nonNegativeInteger(value: unknown, field: string): number {
    if (!Number.isInteger(value) || Number(value) < 0) throw new BadRequestException(`${field} must be a non-negative integer.`);
    return Number(value);
  }

  private positiveInteger(value: unknown, field: string): number {
    if (!Number.isInteger(value) || Number(value) < 1) throw new BadRequestException(`${field} must be a positive integer.`);
    return Number(value);
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
