import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { decideClinicalResourceAccess, type AuthPrincipal } from "@carepoint/identity";
import type { EncryptedEnvelope } from "@carepoint/security";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { ClinicalEnvelopeService } from "../clinical/clinical-envelope.service";
import {
  diffQuestionnaireAnswers,
  evaluateQuestionnaireActivation,
  normalizeActivationRules,
  normalizeQuestionnaireAnswers,
  normalizeQuestionnaireSchema,
  type QuestionnaireActivationRules,
  type QuestionnaireAnswers,
  type QuestionnaireLabels,
  type QuestionnaireSchema,
} from "./questionnaire.engine";

const QUESTIONNAIRE_SCOPE = "QUESTIONNAIRE_READ";
const QUESTIONNAIRE_CONSENT_VERSION = "questionnaire-read-v1";
const TREATMENT_LOOKBACK_DAYS = 365;
const TREATMENT_LOOKAHEAD_DAYS = 30;

type StoredQuestionnaireResponse = {
  schemaVersion: 1;
  questionnaireCode: string;
  questionnaireVersion: number;
  healthChanged: boolean | null;
  answers: QuestionnaireAnswers;
};

export interface CreateQuestionnaireInput {
  code: string;
  labels: QuestionnaireLabels;
  descriptionLabels?: QuestionnaireLabels | null;
}

export interface CreateQuestionnaireVersionInput {
  schema: unknown;
  activationRules?: unknown;
}

export interface SubmitQuestionnaireInput {
  expectedLatestSequence: number;
  expectedQuestionnaireVersionId?: string;
  answers: unknown;
  healthChanged?: boolean | null;
}

export interface ConfirmQuestionnaireNoChangesInput {
  expectedLatestSequence: number;
  expectedQuestionnaireVersionId: string;
}

@Injectable()
export class QuestionnaireService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly envelope: ClinicalEnvelopeService,
  ) {}

  async adminList() {
    return this.prisma.questionnaireDefinition.findMany({
      orderBy: { code: "asc" },
      include: { versions: { orderBy: { version: "desc" } } },
    });
  }

  async createDefinition(principal: AuthPrincipal, input: CreateQuestionnaireInput) {
    const code = this.code(input?.code);
    const labels = this.labels(input?.labels, "labels");
    const descriptionLabels = input?.descriptionLabels == null
      ? null
      : this.labels(input.descriptionLabels, "descriptionLabels");
    return this.prisma.questionnaireDefinition.create({
      data: {
        code,
        labels: labels as unknown as Prisma.InputJsonValue,
        descriptionLabels: descriptionLabels as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async createVersion(principal: AuthPrincipal, questionnaireId: string, input: CreateQuestionnaireVersionInput) {
    const questionnaire = await this.prisma.questionnaireDefinition.findUnique({
      where: { id: questionnaireId },
      select: { id: true, active: true },
    });
    if (!questionnaire) throw new NotFoundException("Questionnaire not found.");
    if (!questionnaire.active) throw new ConflictException("Questionnaire is inactive.");

    const schema = normalizeQuestionnaireSchema(input?.schema);
    const activationRules = normalizeActivationRules(input?.activationRules);
    const latest = await this.prisma.questionnaireVersion.findFirst({
      where: { questionnaireId },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    const version = (latest?.version ?? 0) + 1;
    return this.prisma.questionnaireVersion.create({
      data: {
        questionnaireId,
        version,
        status: "DRAFT",
        schema: schema as unknown as Prisma.InputJsonValue,
        activationRules: activationRules as unknown as Prisma.InputJsonValue,
        createdByActorId: principal.accountId,
      },
    });
  }

  async activateVersion(principal: AuthPrincipal, questionnaireId: string, version: number) {
    const normalizedVersion = this.positiveInteger(version, "version");
    return this.prisma.$transaction(async (tx) => {
      const target = await tx.questionnaireVersion.findUnique({
        where: { questionnaireId_version: { questionnaireId, version: normalizedVersion } },
      });
      if (!target) throw new NotFoundException("Questionnaire version not found.");
      if (target.status === "ACTIVE") return target;
      if (target.status !== "DRAFT") throw new ConflictException("Only a DRAFT questionnaire version can be activated.");

      const now = new Date();
      await tx.questionnaireVersion.updateMany({
        where: { questionnaireId, status: "ACTIVE" },
        data: { status: "RETIRED", retiredAt: now },
      });
      const activated = await tx.questionnaireVersion.update({
        where: { id: target.id },
        data: { status: "ACTIVE", activatedAt: now, retiredAt: null },
      });
      await this.audit.writeClinicalInTransaction(tx, {
        actorId: principal.accountId,
        action: "QUESTIONNAIRE_VERSION_ACTIVATED",
        objectType: "QUESTIONNAIRE_VERSION",
        objectId: activated.id,
        purpose: "CLINICAL_CONFIGURATION",
        result: "SUCCESS",
        metadata: {
          domain: "QUESTIONNAIRE",
          resourceId: activated.id,
          resourceVersion: activated.version,
          decision: "ALLOW",
        },
      });
      return activated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async dueMine(principal: AuthPrincipal) {
    const patient = await this.requirePatient(principal);
    const versions = await this.prisma.questionnaireVersion.findMany({
      where: { status: "ACTIVE", questionnaire: { active: true } },
      include: { questionnaire: true },
      orderBy: [{ questionnaire: { code: "asc" } }, { version: "desc" }],
    });
    if (versions.length === 0) return { patientId: patient.id, items: [] };

    const questionnaireIds = [...new Set(versions.map((item) => item.questionnaireId))];
    const responses = await this.prisma.questionnaireResponse.findMany({
      where: { patientId: patient.id, questionnaireId: { in: questionnaireIds } },
      orderBy: { completedAt: "desc" },
      select: { questionnaireId: true, questionnaireVersionId: true, sequence: true, completedAt: true },
    });
    const latest = new Map<string, { questionnaireVersionId: string; sequence: number; completedAt: Date }>();
    for (const response of responses) {
      if (!latest.has(response.questionnaireId)) {
        latest.set(response.questionnaireId, {
          questionnaireVersionId: response.questionnaireVersionId,
          sequence: response.sequence,
          completedAt: response.completedAt,
        });
      }
    }

    const items = versions.map((item) => {
      const previous = latest.get(item.questionnaireId) ?? null;
      const rules = normalizeActivationRules(item.activationRules);
      const activation = evaluateQuestionnaireActivation(rules, previous?.completedAt ?? null);
      return {
        questionnaireId: item.questionnaireId,
        code: item.questionnaire.code,
        labels: item.questionnaire.labels,
        questionnaireVersionId: item.id,
        questionnaireVersion: item.version,
        schema: item.schema,
        latestSequence: previous?.sequence ?? 0,
        latestQuestionnaireVersionId: previous?.questionnaireVersionId ?? null,
        lastCompletedAt: previous?.completedAt ?? null,
        canConfirmNoChanges:
          activation.due &&
          previous !== null &&
          previous.questionnaireVersionId === item.id,
        ...activation,
      };
    });

    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "QUESTIONNAIRE_DUE_LIST_READ",
      objectType: "PATIENT",
      objectId: patient.id,
      purpose: "PATIENT_ACCESS",
      result: "SUCCESS",
      metadata: {
        domain: "QUESTIONNAIRE",
        patientId: patient.id,
        itemCount: items.length,
        decision: "ALLOW",
      },
    });

    return { patientId: patient.id, items };
  }

  async statusMine(principal: AuthPrincipal) {
    return this.dueMine(principal);
  }

  async confirmNoChangesMine(
    principal: AuthPrincipal,
    code: string,
    input: ConfirmQuestionnaireNoChangesInput,
  ) {
    const patient = await this.requirePatient(principal);
    const normalizedCode = this.code(code);
    const expectedLatestSequence = this.nonNegativeInteger(input?.expectedLatestSequence, "expectedLatestSequence");
    const expectedQuestionnaireVersionId = this.identifier(
      input?.expectedQuestionnaireVersionId,
      "expectedQuestionnaireVersionId",
    );

    const active = await this.prisma.questionnaireVersion.findFirst({
      where: {
        status: "ACTIVE",
        questionnaire: { code: normalizedCode, active: true },
      },
      include: { questionnaire: true },
      orderBy: { version: "desc" },
    });
    if (!active) throw new NotFoundException("Active questionnaire not found.");
    if (active.id !== expectedQuestionnaireVersionId) {
      throw new ConflictException("Questionnaire version changed; complete the current questionnaire.");
    }

    const previous = await this.prisma.questionnaireResponse.findFirst({
      where: { patientId: patient.id, questionnaireId: active.questionnaireId },
      orderBy: { sequence: "desc" },
    });
    if (!previous) throw new ConflictException("No previous questionnaire response can be confirmed.");
    if (previous.sequence !== expectedLatestSequence) {
      throw new ConflictException({
        message: "Questionnaire response sequence conflict.",
        currentSequence: previous.sequence,
      });
    }
    if (previous.questionnaireVersionId !== active.id) {
      throw new ConflictException("Questionnaire version changed; complete the current questionnaire.");
    }

    const activation = evaluateQuestionnaireActivation(
      normalizeActivationRules(active.activationRules),
      previous.completedAt,
    );
    if (!activation.due) throw new ConflictException("Questionnaire is not due for review.");

    const previousPayload = await this.decryptResponse(previous);
    const response = await this.submitMine(principal, normalizedCode, {
      expectedLatestSequence,
      expectedQuestionnaireVersionId: active.id,
      answers: previousPayload.answers,
      healthChanged: false,
    });

    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "QUESTIONNAIRE_NO_CHANGES_CONFIRMED",
      objectType: "QUESTIONNAIRE_RESPONSE",
      objectId: response.id,
      purpose: "PATIENT_ACCESS",
      result: "SUCCESS",
      metadata: {
        domain: "QUESTIONNAIRE",
        patientId: patient.id,
        resourceId: response.id,
        resourceVersion: response.sequence,
        questionnaireVersion: active.version,
        decision: "ALLOW",
      },
    });
    return { ...response, confirmedNoChanges: true };
  }

  async submitMine(principal: AuthPrincipal, code: string, input: SubmitQuestionnaireInput) {
    const patient = await this.requirePatient(principal);
    const expectedLatestSequence = this.nonNegativeInteger(input?.expectedLatestSequence, "expectedLatestSequence");
    const expectedQuestionnaireVersionId = input?.expectedQuestionnaireVersionId == null
      ? null
      : this.identifier(input.expectedQuestionnaireVersionId, "expectedQuestionnaireVersionId");
    const healthChanged = this.optionalBoolean(input?.healthChanged, "healthChanged");
    const normalizedCode = this.code(code);
    const active = await this.prisma.questionnaireVersion.findFirst({
      where: {
        status: "ACTIVE",
        questionnaire: { code: normalizedCode, active: true },
      },
      include: { questionnaire: true },
      orderBy: { version: "desc" },
    });
    if (!active) throw new NotFoundException("Active questionnaire not found.");
    if (expectedQuestionnaireVersionId && active.id !== expectedQuestionnaireVersionId) {
      throw new ConflictException("Questionnaire version changed; reload the current questionnaire.");
    }

    const schema = normalizeQuestionnaireSchema(active.schema);
    const answers = normalizeQuestionnaireAnswers(schema, input?.answers);
    const observed = await this.prisma.questionnaireResponse.findFirst({
      where: { patientId: patient.id, questionnaireId: active.questionnaireId },
      orderBy: { sequence: "desc" },
    });
    if ((observed?.sequence ?? 0) !== expectedLatestSequence) {
      throw new ConflictException({
        message: "Questionnaire response sequence conflict.",
        currentSequence: observed?.sequence ?? 0,
      });
    }

    const previousPayload = observed ? await this.decryptResponse(observed) : null;
    const diff = diffQuestionnaireAnswers(previousPayload?.answers ?? null, answers);
    const nextSequence = expectedLatestSequence + 1;
    const payload: StoredQuestionnaireResponse = {
      schemaVersion: 1,
      questionnaireCode: active.questionnaire.code,
      questionnaireVersion: active.version,
      healthChanged,
      answers,
    };
    const encrypted = await this.envelope.encryptRecord(payload);

    const response = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "PatientProfile" WHERE id = ${patient.id} FOR UPDATE`);
      const activeVersion = await tx.questionnaireVersion.findUnique({
        where: { id: active.id },
        select: { status: true },
      });
      if (activeVersion?.status !== "ACTIVE") {
        throw new ConflictException("Questionnaire version changed; reload the current questionnaire.");
      }
      const current = await tx.questionnaireResponse.findFirst({
        where: { patientId: patient.id, questionnaireId: active.questionnaireId },
        orderBy: { sequence: "desc" },
        select: { id: true, sequence: true },
      });
      if ((current?.sequence ?? 0) !== expectedLatestSequence) {
        throw new ConflictException({
          message: "Questionnaire response sequence conflict.",
          currentSequence: current?.sequence ?? 0,
        });
      }

      const created = await tx.questionnaireResponse.create({
        data: {
          questionnaireId: active.questionnaireId,
          questionnaireVersionId: active.id,
          patientId: patient.id,
          sequence: nextSequence,
          previousResponseId: current?.id ?? null,
          healthChanged,
          changedQuestionIds: diff.changedQuestionIds as unknown as Prisma.InputJsonValue,
          sourceType: "PATIENT",
          sourceActorId: principal.accountId,
          ...this.envelopeData(encrypted),
        },
      });

      await this.audit.writeClinicalInTransaction(tx, {
        actorId: principal.accountId,
        action: "QUESTIONNAIRE_RESPONSE_SUBMITTED",
        objectType: "QUESTIONNAIRE_RESPONSE",
        objectId: created.id,
        purpose: "PATIENT_ACCESS",
        result: "SUCCESS",
        metadata: {
          domain: "QUESTIONNAIRE",
          accessBasis: "PATIENT_SELF",
          patientId: patient.id,
          resourceId: created.id,
          resourceVersion: created.sequence,
          changedFields: diff.changedQuestionIds,
          decision: "ALLOW",
        },
      });
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return this.presentResponse(response, active.questionnaire.code, active.version, payload, diff.changedQuestionIds, "PATIENT_SELF");
  }

  async latestMine(principal: AuthPrincipal, code: string) {
    const patient = await this.requirePatient(principal);
    return this.latestForPatient(patient.id, this.code(code), "PATIENT_SELF");
  }

  async diffMine(principal: AuthPrincipal, code: string) {
    const patient = await this.requirePatient(principal);
    return this.diffForPatient(patient.id, this.code(code), "PATIENT_SELF");
  }

  async latestForDoctor(principal: AuthPrincipal, patientId: string, code: string) {
    const accessBasis = await this.requireDoctorAccess(principal, patientId);
    return this.latestForPatient(patientId, this.code(code), accessBasis);
  }

  async diffForDoctor(principal: AuthPrincipal, patientId: string, code: string) {
    const accessBasis = await this.requireDoctorAccess(principal, patientId);
    return this.diffForPatient(patientId, this.code(code), accessBasis);
  }

  private async latestForPatient(patientId: string, code: string, accessBasis: string) {
    const questionnaire = await this.prisma.questionnaireDefinition.findUnique({
      where: { code },
      select: { id: true, code: true },
    });
    if (!questionnaire) throw new NotFoundException("Questionnaire not found.");
    const row = await this.prisma.questionnaireResponse.findFirst({
      where: { patientId, questionnaireId: questionnaire.id },
      include: { questionnaireVersion: { select: { version: true } } },
      orderBy: { sequence: "desc" },
    });
    if (!row) return { patientId, code, latest: null, accessBasis };
    const payload = await this.decryptResponse(row);
    await this.audit.writeClinical({
      action: "QUESTIONNAIRE_RESPONSE_READ",
      objectType: "QUESTIONNAIRE_RESPONSE",
      objectId: row.id,
      purpose: accessBasis === "PATIENT_SELF" ? "PATIENT_ACCESS" : "TREATMENT",
      result: "SUCCESS",
      metadata: {
        domain: "QUESTIONNAIRE",
        accessBasis,
        patientId,
        resourceId: row.id,
        resourceVersion: row.sequence,
        decision: "ALLOW",
      },
    });
    return {
      patientId,
      code,
      latest: this.presentResponse(
        row,
        code,
        row.questionnaireVersion.version,
        payload,
        this.jsonStringArray(row.changedQuestionIds),
        accessBasis,
      ),
      accessBasis,
    };
  }

  private async diffForPatient(patientId: string, code: string, accessBasis: string) {
    const questionnaire = await this.prisma.questionnaireDefinition.findUnique({
      where: { code },
      select: { id: true, code: true },
    });
    if (!questionnaire) throw new NotFoundException("Questionnaire not found.");
    const rows = await this.prisma.questionnaireResponse.findMany({
      where: { patientId, questionnaireId: questionnaire.id },
      include: { questionnaireVersion: { select: { version: true } } },
      orderBy: { sequence: "desc" },
      take: 2,
    });
    if (rows.length === 0) {
      return { patientId, code, latestSequence: 0, previousSequence: null, changedQuestionIds: [], changes: [], accessBasis };
    }
    const latest = rows[0]!;
    const previous = rows[1] ?? null;
    const [latestPayload, previousPayload] = await Promise.all([
      this.decryptResponse(latest),
      previous ? this.decryptResponse(previous) : Promise.resolve(null),
    ]);
    const diff = diffQuestionnaireAnswers(previousPayload?.answers ?? null, latestPayload.answers);
    await this.audit.writeClinical({
      action: "QUESTIONNAIRE_DIFF_READ",
      objectType: "QUESTIONNAIRE_RESPONSE",
      objectId: latest.id,
      purpose: accessBasis === "PATIENT_SELF" ? "PATIENT_ACCESS" : "TREATMENT",
      result: "SUCCESS",
      metadata: {
        domain: "QUESTIONNAIRE",
        accessBasis,
        patientId,
        resourceId: latest.id,
        resourceVersion: latest.sequence,
        changedFields: diff.changedQuestionIds,
        decision: "ALLOW",
      },
    });
    return {
      patientId,
      code,
      latestSequence: latest.sequence,
      previousSequence: previous?.sequence ?? null,
      questionnaireVersion: latest.questionnaireVersion.version,
      previousQuestionnaireVersion: previous?.questionnaireVersion.version ?? null,
      healthChanged: latest.healthChanged,
      changedQuestionIds: diff.changedQuestionIds,
      changes: diff.changes,
      accessBasis,
    };
  }

  private async requireDoctorAccess(principal: AuthPrincipal, patientId: string) {
    if (principal.role !== "DOCTOR") throw new ForbiddenException("Doctor questionnaire access requires DOCTOR role.");
    const provider = await this.prisma.provider.findUnique({
      where: { userId: principal.accountId },
      select: { id: true, status: true },
    });
    if (!provider || provider.status !== "ACTIVE") throw new ForbiddenException("An active doctor provider profile is required.");
    const patient = await this.prisma.patientProfile.findUnique({
      where: { id: patientId },
      select: { id: true },
    });
    if (!patient) throw new NotFoundException("Patient not found.");

    const now = new Date();
    const from = new Date(now.getTime() - TREATMENT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const to = new Date(now.getTime() + TREATMENT_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);
    const [relationship, consent] = await Promise.all([
      this.prisma.appointment.findFirst({
        where: {
          providerId: provider.id,
          patientId,
          status: { in: ["CONFIRMED", "COMPLETED"] },
          startsAt: { gte: from, lte: to },
        },
        select: { id: true },
      }),
      this.prisma.consent.findFirst({
        where: {
          patientId,
          providerId: { in: [provider.id] },
          scope: QUESTIONNAIRE_SCOPE,
          version: QUESTIONNAIRE_CONSENT_VERSION,
          purpose: "TREATMENT",
          state: "GRANTED",
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        select: { id: true },
        orderBy: { grantedAt: "desc" },
      }),
    ]);

    const decision = decideClinicalResourceAccess({
      principal,
      action: "READ",
      providerActive: true,
      capabilityAllowed: true,
      purpose: "TREATMENT",
      allowedPurposes: ["TREATMENT"],
      withinAccessWindow: Boolean(relationship),
      sensitivityAllowed: true,
      hasTreatmentRelationship: false,
      hasPatientConsent: Boolean(consent),
    });

    if (!relationship || !consent || !decision.allowed) {
      await this.audit.writeClinical({
        actorId: principal.accountId,
        action: "QUESTIONNAIRE_RESPONSE_READ_DENIED",
        objectType: "PATIENT",
        objectId: patientId,
        purpose: "TREATMENT",
        result: "DENIED",
        metadata: {
          domain: "QUESTIONNAIRE",
          patientId,
          providerId: provider.id,
          consentVersion: QUESTIONNAIRE_CONSENT_VERSION,
          decision: "DENY",
        },
      });
      throw new ForbiddenException("Questionnaire access denied.");
    }

    return decision.basis;
  }

  private async requirePatient(principal: AuthPrincipal) {
    if (principal.role !== "PATIENT") throw new ForbiddenException("Patient questionnaire access requires PATIENT role.");
    const patient = await this.prisma.patientProfile.findUnique({
      where: { userId: principal.accountId },
      select: { id: true },
    });
    if (!patient) throw new NotFoundException("Patient profile not found.");
    return patient;
  }

  private identifier(value: unknown, field: string): string {
    if (typeof value !== "string") throw new BadRequestException(`${field} is required.`);
    const normalized = value.trim();
    if (!/^[A-Za-z0-9_.:-]{1,180}$/.test(normalized)) {
      throw new BadRequestException(`${field} is invalid.`);
    }
    return normalized;
  }

  private code(value: unknown): string {
    if (typeof value !== "string") throw new BadRequestException("questionnaire code is required.");
    const code = value.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_]{2,79}$/.test(code)) throw new BadRequestException("questionnaire code is invalid.");
    return code;
  }

  private labels(value: unknown, field: string): QuestionnaireLabels {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestException(`${field} must be an object.`);
    const raw = value as Record<string, unknown>;
    const result: Record<string, string> = {};
    for (const locale of ["en", "ar", "fr", "es"] as const) {
      if (raw[locale] === undefined || raw[locale] === null) continue;
      if (typeof raw[locale] !== "string") throw new BadRequestException(`${field}.${locale} must be text.`);
      const normalized = raw[locale].trim();
      if (!normalized || normalized.length > 300) throw new BadRequestException(`${field}.${locale} is invalid.`);
      result[locale] = normalized;
    }
    if (!result.en) throw new BadRequestException(`${field}.en is required.`);
    return result as unknown as QuestionnaireLabels;
  }

  private nonNegativeInteger(value: unknown, field: string): number {
    if (!Number.isInteger(value) || Number(value) < 0) throw new BadRequestException(`${field} must be a non-negative integer.`);
    return Number(value);
  }

  private positiveInteger(value: unknown, field: string): number {
    if (!Number.isInteger(value) || Number(value) < 1) throw new BadRequestException(`${field} must be a positive integer.`);
    return Number(value);
  }

  private optionalBoolean(value: unknown, field: string): boolean | null {
    if (value === undefined || value === null) return null;
    if (typeof value !== "boolean") throw new BadRequestException(`${field} must be boolean or null.`);
    return value;
  }

  private jsonStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === "string");
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

  private decryptResponse(row: {
    algorithm: string;
    keyId: string;
    wrappedKey: string;
    iv: string;
    ciphertext: string;
  }) {
    return this.envelope.decryptRecord<StoredQuestionnaireResponse>({
      version: 1,
      algorithm: row.algorithm as "AES-256-GCM",
      keyId: row.keyId,
      wrappedKey: row.wrappedKey,
      iv: row.iv,
      ciphertext: row.ciphertext,
    });
  }

  private presentResponse(
    row: {
      id: string;
      patientId: string;
      sequence: number;
      healthChanged: boolean | null;
      completedAt: Date;
    },
    code: string,
    questionnaireVersion: number,
    payload: StoredQuestionnaireResponse,
    changedQuestionIds: string[],
    accessBasis: string,
  ) {
    return {
      id: row.id,
      patientId: row.patientId,
      code,
      questionnaireVersion,
      sequence: row.sequence,
      healthChanged: row.healthChanged,
      answers: payload.answers,
      changedQuestionIds,
      completedAt: row.completedAt,
      accessBasis,
    };
  }
}
