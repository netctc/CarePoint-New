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
  normalizeUnitCode,
  type ConversionRule,
} from "./observation.engine";

type StoredObservation = {
  schemaVersion: 1;
  metricCode: string;
  metricVersion: number;
  originalValue: number;
  originalUnitCode: string;
  canonicalValue: number;
  canonicalUnitCode: string;
  verificationStatus: "PATIENT_DECLARED";
};

export type StoredObservationCorrection = {
  schemaVersion: 1;
  value: number;
  unitCode: string;
  canonicalValue: number;
  canonicalUnitCode: string;
  reason: string;
};

export interface CorrectObservationInput {
  expectedSequence: number;
  value: number;
  unitCode: string;
  reason: string;
}

@Injectable()
export class ObservationCorrectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly envelope: ClinicalEnvelopeService,
  ) {}

  async readMine(principal: AuthPrincipal, observationIdRaw: string) {
    const observation = await this.requireOwnedManualObservation(principal, observationIdRaw);
    const original = await this.decryptObservation(observation);
    const rows = await this.prisma.observationCorrectionRevision.findMany({
      where: { observationId: observation.id },
      orderBy: { sequence: "asc" },
      take: 100,
    });
    const revisions = [];
    for (const row of rows) revisions.push(await this.present(row));
    const latest = revisions.at(-1) ?? null;

    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "OBSERVATION_CORRECTIONS_READ",
      objectType: "OBSERVATION",
      objectId: observation.id,
      purpose: "PATIENT_ACCESS",
      result: "SUCCESS",
      metadata: {
        domain: "OBSERVATION",
        patientId: observation.patientId,
        observationId: observation.id,
        correctionSequence: latest?.sequence ?? 0,
        originalPreserved: true,
        sourceType: "MANUAL",
        decision: "ALLOW",
      },
    });

    return {
      observationId: observation.id,
      patientId: observation.patientId,
      sourceType: observation.sourceType,
      observedAt: observation.observedAt,
      original: {
        value: original.originalValue,
        unitCode: original.originalUnitCode,
        canonicalValue: original.canonicalValue,
        canonicalUnitCode: original.canonicalUnitCode,
      },
      currentSequence: latest?.sequence ?? 0,
      effective: latest == null
        ? {
            value: original.originalValue,
            unitCode: original.originalUnitCode,
            canonicalValue: original.canonicalValue,
            canonicalUnitCode: original.canonicalUnitCode,
          }
        : {
            value: latest.value,
            unitCode: latest.unitCode,
            canonicalValue: latest.canonicalValue,
            canonicalUnitCode: latest.canonicalUnitCode,
          },
      revisions,
      originalPreserved: true,
    };
  }

  async correctMine(
    principal: AuthPrincipal,
    observationIdRaw: string,
    input: CorrectObservationInput,
  ) {
    const patient = await this.requirePatient(principal);
    const observationId = this.identifier(observationIdRaw, "observationId");
    const expectedSequence = this.nonNegativeInteger(input?.expectedSequence, "expectedSequence");
    const reason = this.reason(input?.reason);
    const value = this.finite(input?.value, "value");
    const unitCode = normalizeUnitCode(input?.unitCode);

    const observed = await this.prisma.observation.findFirst({
      where: { id: observationId, patientId: patient.id },
      include: { observationTypeVersion: true },
    });
    if (!observed) throw new NotFoundException("Observation not found.");
    if (observed.sourceType !== "MANUAL") {
      throw new ForbiddenException("Only MANUAL observations can be corrected by the patient.");
    }

    const allowedUnits = this.jsonStringArray(observed.observationTypeVersion.allowedUnitCodes);
    if (!allowedUnits.includes(unitCode)) {
      throw new BadRequestException("unitCode is not allowed for this observation type.");
    }
    const conversions = await this.conversions(unitCode, observed.observationTypeVersion.canonicalUnitCode);
    const normalized = convertMeasurement(
      value,
      unitCode,
      observed.observationTypeVersion.canonicalUnitCode,
      observed.observationTypeVersion.precision,
      conversions,
    );
    assertCanonicalRange(
      normalized.canonicalValue,
      observed.observationTypeVersion.minCanonical,
      observed.observationTypeVersion.maxCanonical,
    );

    const encrypted = await this.envelope.encryptRecord({
      schemaVersion: 1,
      value: normalized.originalValue,
      unitCode: normalized.originalUnitCode,
      canonicalValue: normalized.canonicalValue,
      canonicalUnitCode: normalized.canonicalUnitCode,
      reason,
    } satisfies StoredObservationCorrection);

    const created = await this.prisma.$transaction(async (tx) => {
      await this.audit.reserveIntegrityChainForSerializableTransaction(tx);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "Observation" WHERE id = ${observationId} FOR UPDATE`);
      const locked = await tx.observation.findFirst({
        where: { id: observationId, patientId: patient.id },
        select: { id: true, patientId: true, sourceType: true },
      });
      if (!locked) throw new NotFoundException("Observation not found.");
      if (locked.sourceType !== "MANUAL") {
        throw new ForbiddenException("Only MANUAL observations can be corrected by the patient.");
      }

      const current = await tx.observationCorrectionRevision.findFirst({
        where: { observationId },
        orderBy: { sequence: "desc" },
        select: { sequence: true },
      });
      const currentSequence = current?.sequence ?? 0;
      if (expectedSequence !== currentSequence) {
        throw new ConflictException("Observation correction changed. Refresh and retry.");
      }

      const row = await tx.observationCorrectionRevision.create({
        data: {
          observationId,
          sequence: currentSequence + 1,
          createdByActorId: principal.accountId,
          ...this.envelopeData(encrypted),
        },
      });
      await this.audit.writeClinicalInTransaction(tx, {
        actorId: principal.accountId,
        action: "OBSERVATION_CORRECTED",
        objectType: "OBSERVATION",
        objectId: observationId,
        purpose: "PATIENT_ACCESS",
        result: "SUCCESS",
        metadata: {
          domain: "OBSERVATION",
          patientId: patient.id,
          observationId,
          correctionSequence: row.sequence,
          reasonPresent: true,
          originalPreserved: true,
          sourceType: "MANUAL",
          decision: "ALLOW",
        },
      });
      return row;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return {
      observationId,
      patientId: patient.id,
      currentSequence: created.sequence,
      effective: await this.present(created),
      originalPreserved: true,
      sourceType: "MANUAL",
    };
  }

  private async requireOwnedManualObservation(principal: AuthPrincipal, observationIdRaw: string) {
    const patient = await this.requirePatient(principal);
    const observationId = this.identifier(observationIdRaw, "observationId");
    const observation = await this.prisma.observation.findFirst({
      where: { id: observationId, patientId: patient.id },
    });
    if (!observation) throw new NotFoundException("Observation not found.");
    if (observation.sourceType !== "MANUAL") {
      throw new ForbiddenException("Only MANUAL observations can be corrected by the patient.");
    }
    return observation;
  }

  private async requirePatient(principal: AuthPrincipal) {
    if (principal.role !== "PATIENT") throw new ForbiddenException("Observation correction requires PATIENT role.");
    const patient = await this.prisma.patientProfile.findUnique({
      where: { userId: principal.accountId },
      select: { id: true },
    });
    if (!patient) throw new NotFoundException("Patient profile not found.");
    return patient;
  }

  private async present(row: {
    id: string;
    observationId: string;
    sequence: number;
    algorithm: string;
    keyId: string;
    wrappedKey: string;
    iv: string;
    ciphertext: string;
    createdByActorId: string;
    createdAt: Date;
  }) {
    const payload = await this.envelope.decryptRecord<StoredObservationCorrection>({
      version: 1,
      algorithm: row.algorithm as "AES-256-GCM",
      keyId: row.keyId,
      wrappedKey: row.wrappedKey,
      iv: row.iv,
      ciphertext: row.ciphertext,
    });
    return {
      id: row.id,
      observationId: row.observationId,
      sequence: row.sequence,
      value: payload.value,
      unitCode: payload.unitCode,
      canonicalValue: payload.canonicalValue,
      canonicalUnitCode: payload.canonicalUnitCode,
      reason: payload.reason,
      createdByActorId: row.createdByActorId,
      createdAt: row.createdAt,
    };
  }

  private decryptObservation(row: {
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

  private envelopeData(envelope: EncryptedEnvelope) {
    return {
      algorithm: envelope.algorithm,
      keyId: envelope.keyId,
      wrappedKey: envelope.wrappedKey,
      iv: envelope.iv,
      ciphertext: envelope.ciphertext,
    };
  }

  private jsonStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === "string");
  }

  private finite(value: unknown, field: string) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new BadRequestException(`${field} must be a finite number.`);
    }
    return value;
  }

  private nonNegativeInteger(value: unknown, field: string) {
    if (!Number.isInteger(value) || Number(value) < 0) {
      throw new BadRequestException(`${field} must be a non-negative integer.`);
    }
    return Number(value);
  }

  private reason(value: unknown) {
    if (typeof value !== "string") throw new BadRequestException("reason is required.");
    const normalized = value.trim();
    if (normalized.length < 3 || normalized.length > 1000 || normalized.includes("\u0000")) {
      throw new BadRequestException("reason must contain between 3 and 1000 characters.");
    }
    return normalized;
  }

  private identifier(value: unknown, field: string) {
    if (typeof value !== "string") throw new BadRequestException(`${field} is required.`);
    const normalized = value.trim();
    if (!/^[A-Za-z0-9_.:-]{1,180}$/.test(normalized)) {
      throw new BadRequestException(`${field} is invalid.`);
    }
    return normalized;
  }
}
