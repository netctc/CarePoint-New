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
  assertCanonicalRange,
  convertMeasurement,
  normalizeGlucoseContext,
  normalizeMetricCode,
  normalizeObservedAt,
  normalizeUnitCode,
  type ConversionRule,
  type GlucoseContext,
} from "./observation.engine";

const OBSERVATION_CONSENT_VERSION = "observation-read-v1";
const TREATMENT_LOOKBACK_DAYS = 365;
const TREATMENT_LOOKAHEAD_DAYS = 30;
const MAX_HISTORY = 500;

type Labels = { en: string; ar?: string; fr?: string; es?: string };
type SourceType = "MANUAL" | "DEVICE";
type StoredObservation = {
  schemaVersion: 1;
  metricCode: string;
  metricVersion: number;
  originalValue: number;
  originalUnitCode: string;
  canonicalValue: number;
  canonicalUnitCode: string;
  glucoseContext?: GlucoseContext | null;
  verificationStatus: "PATIENT_DECLARED";
};

export interface CreateUnitInput {
  code: string;
  dimension: string;
  labels: Labels;
}

export interface CreateConversionInput {
  fromUnitCode: string;
  toUnitCode: string;
  multiplier: number;
  offset?: number;
}

export interface CreateMetricInput {
  code: string;
  category: string;
  labels: Labels;
}

export interface CreateMetricVersionInput {
  canonicalUnitCode: string;
  allowedUnitCodes: string[];
  minCanonical?: number | null;
  maxCanonical?: number | null;
  precision?: number;
}

export interface CreateObservationInput {
  code: string;
  value: number;
  unitCode: string;
  observedAt: string;
  sourceType?: SourceType;
  sourceId?: string | null;
  glucoseContext?: GlucoseContext | string | null;
}

@Injectable()
export class ObservationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly envelope: ClinicalEnvelopeService,
  ) {}

  async adminCatalog() {
    const [units, conversions, metrics] = await Promise.all([
      this.prisma.measurementUnit.findMany({ orderBy: [{ dimension: "asc" }, { code: "asc" }] }),
      this.prisma.unitConversion.findMany({ orderBy: [{ dimension: "asc" }, { fromUnitCode: "asc" }, { toUnitCode: "asc" }, { version: "desc" }] }),
      this.prisma.observationType.findMany({
        orderBy: { code: "asc" },
        include: { versions: { orderBy: { version: "desc" } } },
      }),
    ]);
    return { units, conversions, metrics };
  }

  async createUnit(_principal: AuthPrincipal, input: CreateUnitInput) {
    const code = normalizeUnitCode(input?.code);
    const dimension = this.dimension(input?.dimension);
    const labels = this.labels(input?.labels, "labels");
    return this.prisma.measurementUnit.create({
      data: {
        code,
        dimension,
        labels: labels as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async createConversion(_principal: AuthPrincipal, input: CreateConversionInput) {
    const fromUnitCode = normalizeUnitCode(input?.fromUnitCode);
    const toUnitCode = normalizeUnitCode(input?.toUnitCode);
    if (fromUnitCode === toUnitCode) throw new BadRequestException("Unit conversion must target a different unit.");
    const multiplier = this.finite(input?.multiplier, "multiplier");
    if (multiplier === 0) throw new BadRequestException("multiplier cannot be zero.");
    const offset = input?.offset === undefined ? 0 : this.finite(input.offset, "offset");

    const [fromUnit, toUnit] = await Promise.all([
      this.prisma.measurementUnit.findUnique({ where: { code: fromUnitCode } }),
      this.prisma.measurementUnit.findUnique({ where: { code: toUnitCode } }),
    ]);
    if (!fromUnit?.active || !toUnit?.active) throw new BadRequestException("Both units must exist and be active.");
    if (fromUnit.dimension !== toUnit.dimension) throw new BadRequestException("Unit conversion dimensions must match.");

    const latest = await this.prisma.unitConversion.findFirst({
      where: { fromUnitCode, toUnitCode },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    return this.prisma.unitConversion.create({
      data: {
        dimension: fromUnit.dimension,
        fromUnitCode,
        toUnitCode,
        multiplier,
        offset,
        version: (latest?.version ?? 0) + 1,
      },
    });
  }

  async createMetric(_principal: AuthPrincipal, input: CreateMetricInput) {
    const code = normalizeMetricCode(input?.code);
    const category = this.dimension(input?.category);
    const labels = this.labels(input?.labels, "labels");
    return this.prisma.observationType.create({
      data: {
        code,
        category,
        labels: labels as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async createMetricVersion(principal: AuthPrincipal, metricId: string, input: CreateMetricVersionInput) {
    const metric = await this.prisma.observationType.findUnique({
      where: { id: metricId },
      select: { id: true, active: true },
    });
    if (!metric) throw new NotFoundException("Observation type not found.");
    if (!metric.active) throw new ConflictException("Observation type is inactive.");

    const canonicalUnitCode = normalizeUnitCode(input?.canonicalUnitCode);
    if (!Array.isArray(input?.allowedUnitCodes) || input.allowedUnitCodes.length < 1 || input.allowedUnitCodes.length > 20) {
      throw new BadRequestException("allowedUnitCodes must contain between 1 and 20 units.");
    }
    const allowedUnitCodes = [...new Set(input.allowedUnitCodes.map(normalizeUnitCode))];
    if (!allowedUnitCodes.includes(canonicalUnitCode)) {
      throw new BadRequestException("allowedUnitCodes must include canonicalUnitCode.");
    }

    const units = await this.prisma.measurementUnit.findMany({
      where: { code: { in: allowedUnitCodes }, active: true },
      select: { code: true, dimension: true },
    });
    if (units.length !== allowedUnitCodes.length) throw new BadRequestException("All allowed units must exist and be active.");
    const dimensions = new Set(units.map((unit) => unit.dimension));
    if (dimensions.size !== 1) throw new BadRequestException("All allowed units must share one dimension.");

    const minCanonical = input?.minCanonical == null ? null : this.finite(input.minCanonical, "minCanonical");
    const maxCanonical = input?.maxCanonical == null ? null : this.finite(input.maxCanonical, "maxCanonical");
    if (minCanonical != null && maxCanonical != null && maxCanonical < minCanonical) {
      throw new BadRequestException("maxCanonical must be greater than or equal to minCanonical.");
    }
    const precision = input?.precision === undefined ? 2 : this.integer(input.precision, "precision");
    if (precision < 0 || precision > 6) throw new BadRequestException("precision must be between 0 and 6.");

    const latest = await this.prisma.observationTypeVersion.findFirst({
      where: { observationTypeId: metricId },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    return this.prisma.observationTypeVersion.create({
      data: {
        observationTypeId: metricId,
        version: (latest?.version ?? 0) + 1,
        status: "DRAFT",
        canonicalUnitCode,
        allowedUnitCodes: allowedUnitCodes as unknown as Prisma.InputJsonValue,
        minCanonical,
        maxCanonical,
        precision,
        createdByActorId: principal.accountId,
      },
    });
  }

  async activateMetricVersion(principal: AuthPrincipal, metricId: string, version: number) {
    const normalizedVersion = this.positiveInteger(version, "version");
    return this.prisma.$transaction(async (tx) => {
      const target = await tx.observationTypeVersion.findUnique({
        where: { observationTypeId_version: { observationTypeId: metricId, version: normalizedVersion } },
      });
      if (!target) throw new NotFoundException("Observation type version not found.");
      if (target.status === "ACTIVE") return target;
      if (target.status !== "DRAFT") throw new ConflictException("Only a DRAFT observation type version can be activated.");
      const now = new Date();
      await tx.observationTypeVersion.updateMany({
        where: { observationTypeId: metricId, status: "ACTIVE" },
        data: { status: "RETIRED", retiredAt: now },
      });
      const active = await tx.observationTypeVersion.update({
        where: { id: target.id },
        data: { status: "ACTIVE", activatedAt: now, retiredAt: null },
      });
      await this.audit.writeClinicalInTransaction(tx, {
        actorId: principal.accountId,
        action: "OBSERVATION_TYPE_VERSION_ACTIVATED",
        objectType: "OBSERVATION_TYPE_VERSION",
        objectId: active.id,
        purpose: "CLINICAL_CONFIGURATION",
        result: "SUCCESS",
        metadata: {
          domain: "OBSERVATION",
          resourceId: active.id,
          resourceVersion: active.version,
          decision: "ALLOW",
        },
      });
      return active;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async patientCatalog(principal: AuthPrincipal) {
    const patient = await this.requirePatient(principal);
    const versions = await this.prisma.observationTypeVersion.findMany({
      where: { status: "ACTIVE", observationType: { active: true } },
      include: { observationType: true },
      orderBy: { observationType: { code: "asc" } },
    });
    return {
      patientId: patient.id,
      items: versions.map((item) => ({
        id: item.observationType.id,
        code: item.observationType.code,
        labels: item.observationType.labels,
        category: item.observationType.category,
        version: item.version,
        canonicalUnitCode: item.canonicalUnitCode,
        allowedUnitCodes: this.jsonStringArray(item.allowedUnitCodes),
        minCanonical: item.minCanonical,
        maxCanonical: item.maxCanonical,
        precision: item.precision,
        shareScope: `OBSERVATION_READ:${item.observationType.code}`,
      })),
    };
  }

  async recordMine(principal: AuthPrincipal, input: CreateObservationInput) {
    const patient = await this.requirePatient(principal);
    const code = normalizeMetricCode(input?.code);
    const glucoseContext = normalizeGlucoseContext(code, input?.glucoseContext);
    const observedAt = normalizeObservedAt(input?.observedAt);
    const sourceType = this.sourceType(input?.sourceType);
    const sourceId = this.sourceId(input?.sourceId, sourceType);

    const version = await this.prisma.observationTypeVersion.findFirst({
      where: { status: "ACTIVE", observationType: { code, active: true } },
      include: { observationType: true },
      orderBy: { version: "desc" },
    });
    if (!version) throw new NotFoundException("Active observation type not found.");

    const originalUnitCode = normalizeUnitCode(input?.unitCode);
    const allowed = this.jsonStringArray(version.allowedUnitCodes);
    if (!allowed.includes(originalUnitCode)) throw new BadRequestException("unitCode is not allowed for this observation type.");

    const conversions = await this.conversions(originalUnitCode, version.canonicalUnitCode);
    const normalized = convertMeasurement(
      input?.value,
      originalUnitCode,
      version.canonicalUnitCode,
      version.precision,
      conversions,
    );
    assertCanonicalRange(normalized.canonicalValue, version.minCanonical, version.maxCanonical);

    const payload: StoredObservation = {
      schemaVersion: 1,
      metricCode: version.observationType.code,
      metricVersion: version.version,
      originalValue: normalized.originalValue,
      originalUnitCode: normalized.originalUnitCode,
      canonicalValue: normalized.canonicalValue,
      canonicalUnitCode: normalized.canonicalUnitCode,
      glucoseContext,
      verificationStatus: "PATIENT_DECLARED",
    };
    const encrypted = await this.envelope.encryptRecord(payload);
    const row = await this.prisma.observation.create({
      data: {
        patientId: patient.id,
        observationTypeId: version.observationTypeId,
        observationTypeVersionId: version.id,
        observedAt,
        sourceType,
        sourceId,
        createdByActorId: principal.accountId,
        ...this.envelopeData(encrypted),
      },
    });

    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "OBSERVATION_RECORDED",
      objectType: "OBSERVATION",
      objectId: row.id,
      purpose: "PATIENT_ACCESS",
      result: "SUCCESS",
      metadata: {
        domain: "OBSERVATION",
        accessBasis: "PATIENT_SELF",
        patientId: patient.id,
        resourceId: row.id,
        resourceVersion: version.version,
        sourceType,
        decision: "ALLOW",
      },
    });

    return this.present(row, payload, version.observationType.labels, "PATIENT_SELF");
  }

  async historyMine(
    principal: AuthPrincipal,
    code: string,
    from?: string,
    to?: string,
    limit?: number,
  ) {
    const patient = await this.requirePatient(principal);
    return this.history(patient.id, normalizeMetricCode(code), "PATIENT_SELF", from, to, limit);
  }

  async historyForDoctor(
    principal: AuthPrincipal,
    patientId: string,
    code: string,
    from?: string,
    to?: string,
    limit?: number,
  ) {
    const normalizedCode = normalizeMetricCode(code);
    const accessBasis = await this.requireDoctorAccess(principal, patientId, normalizedCode);
    return this.history(patientId, normalizedCode, accessBasis, from, to, limit);
  }

  private async history(
    patientId: string,
    code: string,
    accessBasis: string,
    from?: string,
    to?: string,
    limit?: number,
  ) {
    const type = await this.prisma.observationType.findUnique({ where: { code } });
    if (!type) throw new NotFoundException("Observation type not found.");
    const range = this.range(from, to);
    const take = limit === undefined ? 100 : Math.max(1, Math.min(this.integer(limit, "limit"), MAX_HISTORY));
    const rows = await this.prisma.observation.findMany({
      where: {
        patientId,
        observationTypeId: type.id,
        ...(range ? { observedAt: range } : {}),
      },
      include: {
        observationTypeVersion: { select: { version: true } },
      },
      orderBy: { observedAt: "desc" },
      take,
    });

    const items = [];
    for (const row of rows) {
      const payload = await this.decrypt(row);
      items.push(this.present(row, payload, type.labels, accessBasis));
    }

    await this.audit.writeClinical({
      action: "OBSERVATION_HISTORY_READ",
      objectType: "PATIENT",
      objectId: patientId,
      purpose: accessBasis === "PATIENT_SELF" ? "PATIENT_ACCESS" : "TREATMENT",
      result: "SUCCESS",
      metadata: {
        domain: "OBSERVATION",
        accessBasis,
        patientId,
        itemCount: items.length,
        decision: "ALLOW",
      },
    });

    return {
      patientId,
      code,
      accessBasis,
      items: items.reverse(),
    };
  }

  private async requireDoctorAccess(principal: AuthPrincipal, patientId: string, code: string) {
    if (principal.role !== "DOCTOR") throw new ForbiddenException("Doctor observation access requires DOCTOR role.");
    const provider = await this.prisma.provider.findUnique({
      where: { userId: principal.accountId },
      select: { id: true, status: true },
    });
    if (!provider || provider.status !== "ACTIVE") throw new ForbiddenException("An active doctor provider profile is required.");
    const patient = await this.prisma.patientProfile.findUnique({ where: { id: patientId }, select: { id: true } });
    if (!patient) throw new NotFoundException("Patient not found.");

    const now = new Date();
    const from = new Date(now.getTime() - TREATMENT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const to = new Date(now.getTime() + TREATMENT_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);
    const specificScope = `OBSERVATION_READ:${code}`;
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
          scope: { in: [specificScope, "OBSERVATION_READ"] },
          version: OBSERVATION_CONSENT_VERSION,
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
      hasTreatmentRelationship: false,
      hasPatientConsent: Boolean(consent),
    });

    if (!relationship || !consent || !decision.allowed) {
      await this.audit.writeClinical({
        actorId: principal.accountId,
        action: "OBSERVATION_HISTORY_READ_DENIED",
        objectType: "PATIENT",
        objectId: patientId,
        purpose: "TREATMENT",
        result: "DENIED",
        metadata: {
          domain: "OBSERVATION",
          patientId,
          providerId: provider.id,
          consentVersion: OBSERVATION_CONSENT_VERSION,
          decision: "DENY",
        },
      });
      throw new ForbiddenException("Observation access denied.");
    }
    return decision.basis;
  }

  private async conversions(fromUnitCode: string, toUnitCode: string): Promise<ConversionRule[]> {
    if (fromUnitCode === toUnitCode) return [];
    const rows = await this.prisma.unitConversion.findMany({
      where: {
        active: true,
        OR: [
          { fromUnitCode, toUnitCode },
          { fromUnitCode: toUnitCode, toUnitCode: fromUnitCode },
        ],
      },
      orderBy: { version: "desc" },
    });
    const latest = new Map<string, ConversionRule>();
    for (const row of rows) {
      const key = `${row.fromUnitCode}->${row.toUnitCode}`;
      if (!latest.has(key)) latest.set(key, row);
    }
    return [...latest.values()];
  }

  private async requirePatient(principal: AuthPrincipal) {
    if (principal.role !== "PATIENT") throw new ForbiddenException("Patient observation access requires PATIENT role.");
    const patient = await this.prisma.patientProfile.findUnique({
      where: { userId: principal.accountId },
      select: { id: true },
    });
    if (!patient) throw new NotFoundException("Patient profile not found.");
    return patient;
  }

  private labels(input: unknown, field: string): Labels {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new BadRequestException(`${field} must be an object.`);
    const raw = input as Record<string, unknown>;
    const result: Record<string, string> = {};
    for (const locale of ["en", "ar", "fr", "es"] as const) {
      const item = raw[locale];
      if (item === undefined || item === null) continue;
      if (typeof item !== "string") throw new BadRequestException(`${field}.${locale} must be text.`);
      const value = item.trim();
      if (!value || value.length > 300) throw new BadRequestException(`${field}.${locale} is invalid.`);
      result[locale] = value;
    }
    if (!result.en) throw new BadRequestException(`${field}.en is required.`);
    return result as unknown as Labels;
  }

  private dimension(input: unknown): string {
    if (typeof input !== "string") throw new BadRequestException("dimension/category is required.");
    const value = input.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(value)) throw new BadRequestException("dimension/category is invalid.");
    return value;
  }

  private sourceType(value: unknown): SourceType {
    if (value === undefined || value === null || value === "") return "MANUAL";
    if (typeof value !== "string") throw new BadRequestException("sourceType is invalid.");
    const normalized = value.trim().toUpperCase();
    if (normalized !== "MANUAL" && normalized !== "DEVICE") throw new BadRequestException("sourceType must be MANUAL or DEVICE.");
    return normalized;
  }

  private sourceId(value: unknown, sourceType: SourceType): string | null {
    if (value === undefined || value === null || value === "") {
      if (sourceType === "DEVICE") throw new BadRequestException("sourceId is required for DEVICE observations.");
      return null;
    }
    if (typeof value !== "string") throw new BadRequestException("sourceId is invalid.");
    const normalized = value.trim();
    if (!/^[A-Za-z0-9_.:-]{1,160}$/.test(normalized)) throw new BadRequestException("sourceId is invalid.");
    return normalized;
  }

  private finite(value: unknown, field: string): number {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new BadRequestException(`${field} must be a finite number.`);
    return value;
  }

  private integer(value: unknown, field: string): number {
    if (!Number.isInteger(value)) throw new BadRequestException(`${field} must be an integer.`);
    return Number(value);
  }

  private positiveInteger(value: unknown, field: string): number {
    const number = this.integer(value, field);
    if (number < 1) throw new BadRequestException(`${field} must be positive.`);
    return number;
  }

  private jsonStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === "string");
  }

  private range(from?: string, to?: string) {
    if (!from && !to) return null;
    const gte = from ? normalizeObservedAt(from, new Date("9999-12-31T23:59:59.999Z")) : undefined;
    const lte = to ? normalizeObservedAt(to, new Date("9999-12-31T23:59:59.999Z")) : undefined;
    if (gte && lte && gte.getTime() > lte.getTime()) throw new BadRequestException("from must be before to.");
    return { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) };
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
    return this.envelope.decryptRecord<StoredObservation>({
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
      observedAt: Date;
      sourceType: string;
      sourceId: string | null;
      createdAt: Date;
    },
    payload: StoredObservation,
    labels: unknown,
    accessBasis: string,
  ) {
    return {
      id: row.id,
      patientId: row.patientId,
      code: payload.metricCode,
      labels,
      metricVersion: payload.metricVersion,
      value: payload.originalValue,
      unitCode: payload.originalUnitCode,
      canonicalValue: payload.canonicalValue,
      canonicalUnitCode: payload.canonicalUnitCode,
      glucoseContext: payload.glucoseContext ?? null,
      verificationStatus: payload.verificationStatus,
      observedAt: row.observedAt,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      recordedAt: row.createdAt,
      accessBasis,
    };
  }
}
