import { createHash } from "node:crypto";
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
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { ClinicalEnvelopeService } from "../clinical/clinical-envelope.service";

const PROFILE_READ_SCOPE = "CLINICAL_PROFILE_READ";
const PROFILE_CONSENT_VERSION = "clinical-profile-v1";
const TREATMENT_LOOKBACK_DAYS = 365;
const TREATMENT_LOOKAHEAD_DAYS = 30;
const MAX_LIST_LIMIT = 100;

const DURATION_FACTORS = {
  MINUTES: 1,
  HOURS: 60,
  DAYS: 1440,
  WEEKS: 10080,
} as const;

type DurationUnit = keyof typeof DURATION_FACTORS;

type SymptomPayload = {
  schemaVersion: 1;
  symptom: string;
  codeSystem?: string | undefined;
  code?: string | undefined;
  severity: number;
  duration: {
    value: number;
    unit: DurationUnit;
    minutes: number;
  };
  context: string;
  notes?: string | undefined;
  source: {
    type: "PATIENT_REPORTED";
  };
};

export interface CreateSymptomReportInput {
  idempotencyKey: string;
  symptom: string;
  codeSystem?: string;
  code?: string;
  severity: number;
  duration: {
    value: number;
    unit: string;
  };
  context: string;
  notes?: string;
  occurredAt?: string;
  appointmentId?: string;
  carePlanId?: string;
}

export interface ListSymptomReportQuery {
  from?: string;
  to?: string;
  limit?: string | number;
}

@Injectable()
export class SymptomReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly envelope: ClinicalEnvelopeService,
  ) {}

  async createMine(principal: AuthPrincipal, input: CreateSymptomReportInput) {
    const patient = await this.requirePatient(principal);
    const normalized = this.normalizeInput(input);
    const links = await this.validateLinks(patient.id, normalized.appointmentId, normalized.carePlanId);
    const digest = this.digest({
      payload: normalized.payload,
      occurredAt: normalized.occurredAt?.toISOString() ?? null,
      appointmentId: links.appointmentId ?? null,
      carePlanId: links.carePlanId ?? null,
    });

    const replay = await this.prisma.symptomReport.findFirst({
      where: { patientId: patient.id, idempotencyKey: normalized.idempotencyKey },
    });
    if (replay) return this.replayOrConflict(replay, digest, "PATIENT_SELF");

    const encrypted = await this.envelope.encryptRecord(normalized.payload);
    try {
      const row = await this.prisma.symptomReport.create({
        data: {
          patientId: patient.id,
          idempotencyKey: normalized.idempotencyKey,
          requestDigest: digest,
          sourceType: "PATIENT_REPORTED",
          sourceActorId: principal.accountId,
          ...(normalized.occurredAt ? { occurredAt: normalized.occurredAt } : {}),
          ...(links.appointmentId ? { appointmentId: links.appointmentId } : {}),
          ...(links.carePlanId ? { carePlanId: links.carePlanId } : {}),
          ...this.envelopeData(encrypted),
        },
      });

      await this.audit.writeClinical({
        actorId: principal.accountId,
        action: "SYMPTOM_REPORT_CREATED",
        objectType: "SYMPTOM_REPORT",
        objectId: row.id,
        purpose: "PATIENT_ACCESS",
        result: "SUCCESS",
        metadata: {
          domain: "SYMPTOM_REPORT",
          patientId: patient.id,
          resourceId: row.id,
          sourceType: "PATIENT_REPORTED",
          appointmentLinked: Boolean(row.appointmentId),
          carePlanLinked: Boolean(row.carePlanId),
          decision: "ALLOW",
        },
      });
      return this.present(row, normalized.payload, "PATIENT_SELF");
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const existing = await this.prisma.symptomReport.findFirst({
          where: { patientId: patient.id, idempotencyKey: normalized.idempotencyKey },
        });
        if (existing) return this.replayOrConflict(existing, digest, "PATIENT_SELF");
      }
      throw error;
    }
  }

  async listMine(principal: AuthPrincipal, query: ListSymptomReportQuery = {}) {
    const patient = await this.requirePatient(principal);
    return this.listForPatient(principal, patient.id, query, "PATIENT_SELF");
  }

  async listForDoctor(principal: AuthPrincipal, patientId: string, query: ListSymptomReportQuery = {}) {
    const access = await this.requireDoctorReadAccess(principal, patientId);
    return this.listForPatient(principal, patientId, query, access.basis);
  }

  private async listForPatient(
    principal: AuthPrincipal,
    patientId: string,
    query: ListSymptomReportQuery,
    accessBasis: string,
  ) {
    const { from, to, limit } = this.normalizeListQuery(query);
    const reportedAt = from || to
      ? {
          ...(from ? { gte: from } : {}),
          ...(to ? { lte: to } : {}),
        }
      : undefined;
    const rows = await this.prisma.symptomReport.findMany({
      where: {
        patientId,
        ...(reportedAt ? { reportedAt } : {}),
      },
      orderBy: [
        { occurredAt: { sort: "desc", nulls: "last" } },
        { reportedAt: "desc" },
      ],
      take: limit,
    });
    const items = [];
    for (const row of rows) {
      const payload = await this.decrypt(row);
      items.push(this.present(row, payload, accessBasis));
    }
    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "SYMPTOM_REPORT_LIST_READ",
      objectType: "PATIENT",
      objectId: patientId,
      purpose: accessBasis === "PATIENT_SELF" ? "PATIENT_ACCESS" : "TREATMENT",
      result: "SUCCESS",
      metadata: {
        domain: "SYMPTOM_REPORT",
        patientId,
        accessBasis,
        itemCount: items.length,
        decision: "ALLOW",
      },
    });
    return { patientId, accessBasis, items };
  }

  private normalizeInput(input: CreateSymptomReportInput) {
    if (!input || typeof input !== "object") throw new BadRequestException("Symptom report payload is required.");
    const idempotencyKey = this.identifier(input.idempotencyKey, "idempotencyKey");
    const symptom = this.text(input.symptom, "symptom", 160);
    const codeSystem = this.optionalText(input.codeSystem, "codeSystem", 120);
    const code = this.optionalText(input.code, "code", 120);
    if ((codeSystem && !code) || (code && !codeSystem)) {
      throw new BadRequestException("codeSystem and code must be supplied together.");
    }
    if (!Number.isInteger(input.severity) || input.severity < 0 || input.severity > 10) {
      throw new BadRequestException("severity must be an integer from 0 to 10.");
    }
    const duration = this.normalizeDuration(input.duration);
    const context = this.text(input.context, "context", 2000);
    const notes = this.optionalText(input.notes, "notes", 4000);
    const occurredAt = input.occurredAt ? this.dateTime(input.occurredAt, "occurredAt") : undefined;
    if (occurredAt && occurredAt.getTime() > Date.now() + 5 * 60 * 1000) {
      throw new BadRequestException("occurredAt cannot be in the future.");
    }
    const appointmentId = input.appointmentId ? this.identifier(input.appointmentId, "appointmentId") : undefined;
    const carePlanId = input.carePlanId ? this.identifier(input.carePlanId, "carePlanId") : undefined;
    const payload: SymptomPayload = {
      schemaVersion: 1,
      symptom,
      ...(codeSystem ? { codeSystem } : {}),
      ...(code ? { code } : {}),
      severity: input.severity,
      duration,
      context,
      ...(notes ? { notes } : {}),
      source: { type: "PATIENT_REPORTED" },
    };
    return { idempotencyKey, payload, occurredAt, appointmentId, carePlanId };
  }

  private normalizeDuration(value: CreateSymptomReportInput["duration"]): SymptomPayload["duration"] {
    if (!value || typeof value !== "object") throw new BadRequestException("duration is required.");
    const unit = String(value.unit ?? "").trim().toUpperCase() as DurationUnit;
    if (!(unit in DURATION_FACTORS)) {
      throw new BadRequestException("duration.unit must be MINUTES, HOURS, DAYS or WEEKS.");
    }
    const durationValue = Number(value.value);
    if (!Number.isFinite(durationValue) || durationValue <= 0 || durationValue > 100000) {
      throw new BadRequestException("duration.value must be a positive finite number.");
    }
    const minutes = Math.round(durationValue * DURATION_FACTORS[unit]);
    if (minutes < 1 || minutes > 5_256_000) {
      throw new BadRequestException("duration exceeds the supported range.");
    }
    return { value: durationValue, unit, minutes };
  }

  private async validateLinks(patientId: string, appointmentId?: string, carePlanId?: string) {
    const [appointment, carePlan] = await Promise.all([
      appointmentId
        ? this.prisma.appointment.findUnique({ where: { id: appointmentId }, select: { id: true, patientId: true } })
        : Promise.resolve(null),
      carePlanId
        ? this.prisma.carePlan.findUnique({ where: { id: carePlanId }, select: { id: true, patientId: true } })
        : Promise.resolve(null),
    ]);
    if (appointmentId && (!appointment || appointment.patientId !== patientId)) {
      throw new BadRequestException("appointmentId must reference this patient's appointment.");
    }
    if (carePlanId && (!carePlan || carePlan.patientId !== patientId)) {
      throw new BadRequestException("carePlanId must reference this patient's care plan.");
    }
    return {
      ...(appointment ? { appointmentId: appointment.id } : {}),
      ...(carePlan ? { carePlanId: carePlan.id } : {}),
    };
  }

  private async replayOrConflict(
    row: {
      id: string;
      patientId: string;
      appointmentId: string | null;
      carePlanId: string | null;
      idempotencyKey: string;
      requestDigest: string;
      sourceType: string;
      sourceActorId: string;
      occurredAt: Date | null;
      reportedAt: Date;
      algorithm: string;
      keyId: string;
      wrappedKey: string;
      iv: string;
      ciphertext: string;
      createdAt: Date;
    },
    digest: string,
    accessBasis: string,
  ) {
    if (row.requestDigest !== digest) {
      throw new ConflictException("idempotencyKey has already been used for a different symptom report.");
    }
    return this.present(row, await this.decrypt(row), accessBasis);
  }

  private async requireDoctorReadAccess(principal: AuthPrincipal, patientId: string) {
    if (principal.role !== "DOCTOR") throw new ForbiddenException("Symptom report provider access requires DOCTOR role.");
    const provider = await this.providerForPrincipal(principal);
    const patient = await this.prisma.patientProfile.findUnique({ where: { id: patientId }, select: { id: true } });
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
          scope: PROFILE_READ_SCOPE,
          version: PROFILE_CONSENT_VERSION,
          purpose: "TREATMENT",
          state: "GRANTED",
          AND: [
            { OR: [{ providerId: provider.id }, { providerId: null }] },
            { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
          ],
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
      isAssignedProvider: false,
      hasTreatmentRelationship: false,
      hasPatientConsent: Boolean(consent),
    });
    if (!relationship || !consent || !decision.allowed) {
      await this.audit.writeClinical({
        actorId: principal.accountId,
        action: "SYMPTOM_REPORT_READ_DENIED",
        objectType: "PATIENT",
        objectId: patientId,
        purpose: "TREATMENT",
        result: "DENIED",
        metadata: {
          domain: "SYMPTOM_REPORT",
          patientId,
          providerId: provider.id,
          consentVersion: PROFILE_CONSENT_VERSION,
          decision: "DENY",
        },
      });
      throw new ForbiddenException("Symptom report access denied.");
    }
    return { basis: decision.basis, providerId: provider.id };
  }

  private async providerForPrincipal(principal: AuthPrincipal) {
    const provider = await this.prisma.provider.findUnique({
      where: { userId: principal.accountId },
      select: { id: true, status: true },
    });
    if (!provider || provider.status !== "ACTIVE") {
      throw new ForbiddenException("An active doctor provider profile is required.");
    }
    return provider;
  }

  private async requirePatient(principal: AuthPrincipal) {
    if (principal.role !== "PATIENT") throw new ForbiddenException("Symptom reporting requires PATIENT role.");
    const patient = await this.prisma.patientProfile.findUnique({
      where: { userId: principal.accountId },
      select: { id: true },
    });
    if (!patient) throw new NotFoundException("Patient profile not found.");
    return patient;
  }

  private normalizeListQuery(query: ListSymptomReportQuery) {
    const from = query.from ? this.dateTime(query.from, "from") : undefined;
    const to = query.to ? this.dateTime(query.to, "to") : undefined;
    if (from && to && from > to) throw new BadRequestException("from cannot be after to.");
    const rawLimit = query.limit === undefined ? 50 : Number(query.limit);
    if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > MAX_LIST_LIMIT) {
      throw new BadRequestException(`limit must be an integer from 1 to ${MAX_LIST_LIMIT}.`);
    }
    return { from, to, limit: rawLimit };
  }

  private text(value: unknown, field: string, max: number) {
    if (typeof value !== "string") throw new BadRequestException(`${field} is required.`);
    const normalized = value.trim();
    if (!normalized || normalized.length > max) throw new BadRequestException(`${field} is invalid.`);
    return normalized;
  }

  private optionalText(value: unknown, field: string, max: number) {
    if (value === undefined || value === null || value === "") return undefined;
    return this.text(value, field, max);
  }

  private identifier(value: unknown, field: string) {
    if (typeof value !== "string") throw new BadRequestException(`${field} is required.`);
    const normalized = value.trim();
    if (!/^[A-Za-z0-9_.:-]{1,180}$/.test(normalized)) throw new BadRequestException(`${field} is invalid.`);
    return normalized;
  }

  private dateTime(value: string, field: string) {
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) throw new BadRequestException(`${field} must be a valid date-time.`);
    return new Date(timestamp);
  }

  private digest(value: unknown) {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
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

  private decrypt(row: {
    algorithm: string;
    keyId: string;
    wrappedKey: string;
    iv: string;
    ciphertext: string;
  }) {
    return this.envelope.decryptRecord<SymptomPayload>({
      version: 1,
      algorithm: row.algorithm as "AES-256-GCM",
      keyId: row.keyId,
      wrappedKey: row.wrappedKey,
      iv: row.iv,
      ciphertext: row.ciphertext,
    });
  }

  private present(
    row: {
      id: string;
      patientId: string;
      appointmentId: string | null;
      carePlanId: string | null;
      sourceType: string;
      sourceActorId: string;
      occurredAt: Date | null;
      reportedAt: Date;
      createdAt: Date;
    },
    payload: SymptomPayload,
    accessBasis: string,
  ) {
    return {
      id: row.id,
      patientId: row.patientId,
      symptom: payload.symptom,
      codeSystem: payload.codeSystem,
      code: payload.code,
      severity: payload.severity,
      duration: payload.duration,
      context: payload.context,
      notes: payload.notes,
      occurredAt: row.occurredAt,
      reportedAt: row.reportedAt,
      effectiveAt: row.occurredAt ?? row.reportedAt,
      appointmentId: row.appointmentId,
      carePlanId: row.carePlanId,
      provenance: {
        sourceType: row.sourceType,
        sourceActorId: row.sourceActorId,
        recordedAt: row.createdAt,
      },
      accessBasis,
      diagnosisCreated: false,
      orderCreated: false,
    };
  }
}
