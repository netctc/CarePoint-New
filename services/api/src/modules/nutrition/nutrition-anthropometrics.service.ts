import { createHash } from "node:crypto";
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
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { ClinicalEnvelopeService } from "../clinical/clinical-envelope.service";
import {
  assertCanonicalRange,
  convertMeasurement,
  normalizeMetricCode,
  normalizeObservedAt,
  normalizeUnitCode,
  type ConversionRule,
} from "../observation/observation.engine";
import { ProviderCategoryCapabilityService } from "../providers/provider-category-capability.service";

const ID_TOKEN = /^[A-Za-z0-9_.:-]{1,180}$/;
const IDEMPOTENCY = /^[A-Za-z0-9_.:-]{1,120}$/;
const MAX_MEASUREMENTS = 20;
const MAX_HISTORY = 500;
const LOOKBACK_DAYS = 365;
const LOOKAHEAD_DAYS = 30;
const OBSERVATION_READ_VERSION = "observation-read-v1";

type MeasurementInput = { code?: unknown; value?: unknown; unitCode?: unknown };
type BatchInput = {
  appointmentId?: unknown;
  idempotencyKey?: unknown;
  observedAt?: unknown;
  measurements?: unknown;
};

type PreparedMeasurement = {
  position: number;
  code: string;
  labels: unknown;
  observationTypeId: string;
  observationTypeVersionId: string;
  metricVersion: number;
  originalValue: number;
  originalUnitCode: string;
  canonicalValue: number;
  canonicalUnitCode: string;
  envelope: EncryptedEnvelope;
};

type StoredAnthropometryObservation = {
  schemaVersion: 1;
  metricCode: string;
  metricVersion: number;
  originalValue: number;
  originalUnitCode: string;
  canonicalValue: number;
  canonicalUnitCode: string;
  verificationStatus: "PROVIDER_VERIFIED";
  providerId: string;
  appointmentId: string;
  sourceDomain: "NUTRITION_ANTHROPOMETRY";
  automatedDiagnosis: false;
};

@Injectable()
export class NutritionAnthropometricsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly envelope: ClinicalEnvelopeService,
    private readonly capabilities: ProviderCategoryCapabilityService,
  ) {}

  async record(principal: AuthPrincipal, input: BatchInput) {
    const context = await this.requireNutritionCapability(principal);
    const appointmentId = this.requiredId(input?.appointmentId, "appointmentId");
    const appointment = await this.requireAppointment(context.providerId, appointmentId);
    const idempotencyKey = this.idempotencyKey(input?.idempotencyKey);
    const observedAt = normalizeObservedAt(input?.observedAt);
    const rawMeasurements = this.measurementArray(input?.measurements);
    const seen = new Set<string>();
    const prepared: PreparedMeasurement[] = [];

    for (let position = 0; position < rawMeasurements.length; position += 1) {
      const raw = rawMeasurements[position]!;
      const code = normalizeMetricCode(raw.code);
      if (seen.has(code)) throw new BadRequestException(`Duplicate anthropometric metric '${code}' in one batch.`);
      seen.add(code);
      if (!context.observationCodes.has(code)) {
        throw new ForbiddenException(`Other Provider category is not authorized for anthropometric metric ${code}.`);
      }

      const version = await this.prisma.observationTypeVersion.findFirst({
        where: { status: "ACTIVE", observationType: { code, active: true } },
        include: { observationType: true },
        orderBy: { version: "desc" },
      });
      if (!version) throw new NotFoundException(`Active observation type '${code}' not found.`);

      const originalUnitCode = normalizeUnitCode(raw.unitCode);
      const allowedUnits = this.jsonStringArray(version.allowedUnitCodes);
      if (!allowedUnits.includes(originalUnitCode)) {
        throw new BadRequestException(`unitCode '${originalUnitCode}' is not allowed for metric ${code}.`);
      }
      const conversions = await this.conversions(originalUnitCode, version.canonicalUnitCode);
      const normalized = convertMeasurement(
        raw.value,
        originalUnitCode,
        version.canonicalUnitCode,
        version.precision,
        conversions,
      );
      assertCanonicalRange(normalized.canonicalValue, version.minCanonical, version.maxCanonical);
      const payload: StoredAnthropometryObservation = {
        schemaVersion: 1,
        metricCode: code,
        metricVersion: version.version,
        originalValue: normalized.originalValue,
        originalUnitCode: normalized.originalUnitCode,
        canonicalValue: normalized.canonicalValue,
        canonicalUnitCode: normalized.canonicalUnitCode,
        verificationStatus: "PROVIDER_VERIFIED",
        providerId: context.providerId,
        appointmentId: appointment.id,
        sourceDomain: "NUTRITION_ANTHROPOMETRY",
        automatedDiagnosis: false,
      };
      prepared.push({
        position,
        code,
        labels: version.observationType.labels,
        observationTypeId: version.observationTypeId,
        observationTypeVersionId: version.id,
        metricVersion: version.version,
        originalValue: normalized.originalValue,
        originalUnitCode: normalized.originalUnitCode,
        canonicalValue: normalized.canonicalValue,
        canonicalUnitCode: normalized.canonicalUnitCode,
        envelope: await this.envelope.encryptRecord(payload),
      });
    }

    const digestMaterial = {
      appointmentId: appointment.id,
      observedAt: observedAt.toISOString(),
      measurements: prepared.map((item) => ({
        code: item.code,
        metricVersion: item.metricVersion,
        originalValue: item.originalValue,
        originalUnitCode: item.originalUnitCode,
        canonicalValue: item.canonicalValue,
        canonicalUnitCode: item.canonicalUnitCode,
      })),
    };
    const requestDigest = createHash("sha256").update(JSON.stringify(digestMaterial)).digest("hex");

    const existing = await this.prisma.anthropometricMeasurement.findMany({
      where: { idempotencyKey },
      orderBy: { position: "asc" },
    });
    if (existing.length > 0) {
      if (
        existing.some((row) => row.providerId !== context.providerId || row.patientId !== appointment.patientId || row.requestDigest !== requestDigest)
      ) {
        throw new ConflictException("idempotencyKey was already used for a different anthropometric batch.");
      }
      return this.presentExistingBatch(existing, "IDEMPOTENT_REPLAY");
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const rows: Array<{ linkId: string; observationId: string; position: number }> = [];
      for (const item of prepared) {
        const observation = await tx.observation.create({
          data: {
            patientId: appointment.patientId,
            observationTypeId: item.observationTypeId,
            observationTypeVersionId: item.observationTypeVersionId,
            observedAt,
            sourceType: "PROVIDER",
            sourceId: context.providerId,
            createdByActorId: principal.accountId,
            ...this.envelopeData(item.envelope),
          },
        });
        const link = await tx.anthropometricMeasurement.create({
          data: {
            idempotencyKey,
            requestDigest,
            position: item.position,
            patientId: appointment.patientId,
            providerId: context.providerId,
            appointmentId: appointment.id,
            observationId: observation.id,
            metricCode: item.code,
            observedAt,
            sourceType: "PROVIDER",
          },
        });
        rows.push({ linkId: link.id, observationId: observation.id, position: item.position });
      }
      await this.audit.writeClinicalInTransaction(tx, {
        actorId: principal.accountId,
        action: "NUTRITION_ANTHROPOMETRY_RECORDED",
        objectType: "PATIENT",
        objectId: appointment.patientId,
        purpose: "TREATMENT",
        result: "SUCCESS",
        metadata: {
          domain: "NUTRITION_ANTHROPOMETRY",
          providerId: context.providerId,
          patientId: appointment.patientId,
          appointmentId: appointment.id,
          metricCodes: prepared.map((item) => item.code),
          itemCount: prepared.length,
          decision: "ALLOW",
        },
      });
      return rows;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return {
      patientId: appointment.patientId,
      providerId: context.providerId,
      appointmentId: appointment.id,
      observedAt,
      sourceType: "PROVIDER",
      sourceId: context.providerId,
      normalizedUnits: true,
      encryptedAtRest: true,
      automatedClinicalInference: false,
      items: created.map((row) => {
        const item = prepared[row.position]!;
        return {
          id: row.linkId,
          observationId: row.observationId,
          code: item.code,
          labels: item.labels,
          metricVersion: item.metricVersion,
          value: item.originalValue,
          unitCode: item.originalUnitCode,
          canonicalValue: item.canonicalValue,
          canonicalUnitCode: item.canonicalUnitCode,
          observedAt,
          sourceType: "PROVIDER",
          sourceId: context.providerId,
        };
      }),
    };
  }

  async history(principal: AuthPrincipal, patientId: string, rawCode?: string) {
    const context = await this.requireNutritionCapability(principal);
    const patient = this.requiredId(patientId, "patientId");
    await this.requireTreatmentRelationship(context.providerId, patient);
    const code = rawCode?.trim() ? normalizeMetricCode(rawCode) : null;
    if (code && !context.observationCodes.has(code)) {
      throw new ForbiddenException(`Other Provider category is not authorized for anthropometric metric ${code}.`);
    }
    const allowedCodes = await this.consentedReadCodes(context.providerId, patient, context.observationCodes);
    if (code && !allowedCodes.has(code)) throw new ForbiddenException(`Patient consent is required to read observation ${code}.`);
    if (!code && allowedCodes.size === 0) throw new ForbiddenException("Patient observation consent is required.");

    const rows = await this.prisma.anthropometricMeasurement.findMany({
      where: {
        providerId: context.providerId,
        patientId: patient,
        ...(code ? { metricCode: code } : { metricCode: { in: [...allowedCodes] } }),
      },
      orderBy: [{ observedAt: "asc" }, { position: "asc" }],
      take: MAX_HISTORY,
    });
    const items = [];
    for (const row of rows) {
      const observation = await this.prisma.observation.findUnique({
        where: { id: row.observationId },
        include: { observationType: true, observationTypeVersion: true },
      });
      if (!observation) continue;
      const payload = await this.envelope.decryptRecord<StoredAnthropometryObservation>({
        version: 1,
        algorithm: observation.algorithm as "AES-256-GCM",
        keyId: observation.keyId,
        wrappedKey: observation.wrappedKey,
        iv: observation.iv,
        ciphertext: observation.ciphertext,
      });
      items.push({
        id: row.id,
        observationId: observation.id,
        code: payload.metricCode,
        labels: observation.observationType.labels,
        metricVersion: payload.metricVersion,
        value: payload.originalValue,
        unitCode: payload.originalUnitCode,
        canonicalValue: payload.canonicalValue,
        canonicalUnitCode: payload.canonicalUnitCode,
        observedAt: row.observedAt,
        sourceType: row.sourceType,
        sourceId: observation.sourceId,
        appointmentId: row.appointmentId,
        automatedDiagnosis: false,
      });
    }
    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "NUTRITION_ANTHROPOMETRY_HISTORY_READ",
      objectType: "PATIENT",
      objectId: patient,
      purpose: "TREATMENT",
      result: "SUCCESS",
      metadata: {
        domain: "NUTRITION_ANTHROPOMETRY",
        providerId: context.providerId,
        patientId: patient,
        metricCode: code,
        itemCount: items.length,
        decision: "ALLOW",
      },
    });
    return {
      patientId: patient,
      metricCode: code,
      normalizedUnits: true,
      sourceAndDatePreserved: true,
      automatedClinicalInference: false,
      items,
    };
  }

  private async presentExistingBatch(
    rows: Array<{ id: string; observationId: string; patientId: string; providerId: string; appointmentId: string; metricCode: string; observedAt: Date; sourceType: string }>,
    accessBasis: string,
  ) {
    const items = [];
    for (const row of rows) {
      const observation = await this.prisma.observation.findUnique({
        where: { id: row.observationId },
        include: { observationType: true },
      });
      if (!observation) throw new ConflictException("Anthropometric observation link is incomplete.");
      const payload = await this.envelope.decryptRecord<StoredAnthropometryObservation>({
        version: 1,
        algorithm: observation.algorithm as "AES-256-GCM",
        keyId: observation.keyId,
        wrappedKey: observation.wrappedKey,
        iv: observation.iv,
        ciphertext: observation.ciphertext,
      });
      items.push({
        id: row.id,
        observationId: row.observationId,
        code: payload.metricCode,
        labels: observation.observationType.labels,
        metricVersion: payload.metricVersion,
        value: payload.originalValue,
        unitCode: payload.originalUnitCode,
        canonicalValue: payload.canonicalValue,
        canonicalUnitCode: payload.canonicalUnitCode,
        observedAt: row.observedAt,
        sourceType: row.sourceType,
        sourceId: observation.sourceId,
      });
    }
    const first = rows[0]!;
    return {
      patientId: first.patientId,
      providerId: first.providerId,
      appointmentId: first.appointmentId,
      observedAt: first.observedAt,
      sourceType: "PROVIDER",
      sourceId: first.providerId,
      normalizedUnits: true,
      encryptedAtRest: true,
      automatedClinicalInference: false,
      accessBasis,
      items,
    };
  }

  private async requireNutritionCapability(principal: AuthPrincipal) {
    const context = await this.capabilities.workspaceContext(principal);
    if (!context.clinicalOrderCapabilities.has("NUTRITION")) {
      throw new ForbiddenException("Other Provider category is not authorized for NUTRITION.");
    }
    if (context.observationCodes.size === 0) {
      throw new ForbiddenException("Nutrition category has no configured anthropometric observation codes.");
    }
    return context;
  }

  private async requireAppointment(providerId: string, appointmentId: string) {
    const appointment = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, providerId, status: { in: ["CONFIRMED", "COMPLETED"] } },
      select: { id: true, patientId: true, status: true, startsAt: true },
    });
    if (!appointment) throw new ForbiddenException("Authorized nutrition appointment context is required.");
    return appointment;
  }

  private async requireTreatmentRelationship(providerId: string, patientId: string) {
    const now = new Date();
    const from = new Date(now.getTime() - LOOKBACK_DAYS * 86400000);
    const to = new Date(now.getTime() + LOOKAHEAD_DAYS * 86400000);
    const relationship = await this.prisma.appointment.findFirst({
      where: {
        providerId,
        patientId,
        status: { in: ["CONFIRMED", "COMPLETED"] },
        startsAt: { gte: from, lte: to },
      },
      select: { id: true },
    });
    if (!relationship) throw new ForbiddenException("Current nutrition treatment relationship is required.");
  }

  private async consentedReadCodes(providerId: string, patientId: string, configuredCodes: Set<string>) {
    const now = new Date();
    const consents = await this.prisma.consent.findMany({
      where: {
        patientId,
        version: OBSERVATION_READ_VERSION,
        purpose: "TREATMENT",
        state: "GRANTED",
        AND: [
          { OR: [{ providerId }, { providerId: null }] },
          { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        ],
      },
      select: { scope: true },
    });
    if (consents.some((item) => item.scope === "OBSERVATION_READ")) return new Set(configuredCodes);
    const allowed = new Set<string>();
    for (const consent of consents) {
      if (!consent.scope.startsWith("OBSERVATION_READ:")) continue;
      const code = consent.scope.slice("OBSERVATION_READ:".length);
      if (configuredCodes.has(code)) allowed.add(code);
    }
    return allowed;
  }

  private measurementArray(value: unknown): MeasurementInput[] {
    if (!Array.isArray(value) || value.length < 1 || value.length > MAX_MEASUREMENTS) {
      throw new BadRequestException(`measurements must contain between 1 and ${MAX_MEASUREMENTS} items.`);
    }
    return value.map((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new BadRequestException(`measurements[${index}] must be an object.`);
      }
      return item as MeasurementInput;
    });
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

  private requiredId(value: unknown, field: string): string {
    if (typeof value !== "string" || !ID_TOKEN.test(value.trim())) throw new BadRequestException(`${field} is invalid.`);
    return value.trim();
  }

  private idempotencyKey(value: unknown): string {
    if (typeof value !== "string" || !IDEMPOTENCY.test(value.trim())) throw new BadRequestException("idempotencyKey is invalid.");
    return value.trim();
  }

  private jsonStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
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
