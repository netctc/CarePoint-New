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

type ClinicalSex = "FEMALE" | "MALE" | "INTERSEX" | "UNKNOWN" | "UNSPECIFIED";
type BloodType = "A" | "B" | "AB" | "O" | "UNKNOWN";
type RhesusFactor = "POSITIVE" | "NEGATIVE" | "UNKNOWN";

export interface HealthProfileBasics {
  dateOfBirth?: string | null;
  clinicalSex?: ClinicalSex | null;
  heightCm?: number | null;
  baselineWeightKg?: number | null;
  bloodType?: BloodType | null;
  rhesusFactor?: RhesusFactor | null;
  relevantNeeds?: string[];
}

export interface PatchHealthProfileInput {
  expectedVersion: number;
  basics?: HealthProfileBasics;
}

type StoredHealthProfile = {
  schemaVersion: 1;
  basics: HealthProfileBasics;
};

const CLINICAL_SEX = new Set<ClinicalSex>(["FEMALE", "MALE", "INTERSEX", "UNKNOWN", "UNSPECIFIED"]);
const BLOOD_TYPE = new Set<BloodType>(["A", "B", "AB", "O", "UNKNOWN"]);
const RHESUS = new Set<RhesusFactor>(["POSITIVE", "NEGATIVE", "UNKNOWN"]);
const MAX_NEEDS = 20;
const MAX_NEED_LENGTH = 120;
const HEALTH_PROFILE_SCOPE = "HEALTH_PROFILE_READ";
const HEALTH_PROFILE_CONSENT_VERSION = "health-profile-v1";
const TREATMENT_LOOKBACK_DAYS = 365;
const TREATMENT_LOOKAHEAD_DAYS = 30;

@Injectable()
export class HealthProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly envelope: ClinicalEnvelopeService,
  ) {}

  async mine(principal: AuthPrincipal) {
    const patient = await this.requirePatient(principal);
    const row = await this.prisma.patientHealthProfile.findUnique({
      where: { patientId: patient.id },
      include: { revisions: { orderBy: { version: "desc" }, take: 1 } },
    });

    if (!row) {
      await this.audit.writeClinical({
        actorId: principal.accountId,
        action: "HEALTH_PROFILE_READ",
        objectType: "PATIENT",
        objectId: patient.id,
        purpose: "PATIENT_ACCESS",
        result: "SUCCESS",
        metadata: {
          domain: "HEALTH_PROFILE",
          accessBasis: "PATIENT_SELF",
          patientId: patient.id,
          resourceVersion: 0,
          decision: "ALLOW",
        },
      });
      return {
        patientId: patient.id,
        version: 0,
        schemaVersion: 1,
        basics: {},
        updatedAt: null,
        provenance: null,
      };
    }

    const payload = await this.decrypt(row);
    const latestRevision = row.revisions[0] ?? null;
    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "HEALTH_PROFILE_READ",
      objectType: "PATIENT_HEALTH_PROFILE",
      objectId: row.id,
      purpose: "PATIENT_ACCESS",
      result: "SUCCESS",
      metadata: {
        domain: "HEALTH_PROFILE",
        accessBasis: "PATIENT_SELF",
        patientId: patient.id,
        resourceId: row.id,
        resourceVersion: row.version,
        decision: "ALLOW",
      },
    });
    return this.present(row, payload, latestRevision);
  }


  async providerView(principal: AuthPrincipal, patientId: string) {
    if (principal.role !== "DOCTOR" && principal.role !== "OTHER_PROVIDER") {
      throw new ForbiddenException("A healthcare provider account is required.");
    }
    const provider = await this.prisma.provider.findUnique({
      where: { userId: principal.accountId },
      select: { id: true, status: true },
    });
    if (!provider || provider.status !== "ACTIVE") {
      throw new ForbiddenException("An active healthcare provider is required.");
    }

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
          patientId: patient.id,
          status: { in: ["CONFIRMED", "COMPLETED"] },
          startsAt: { gte: from, lte: to },
        },
        select: { id: true },
      }),
      this.prisma.consent.findFirst({
        where: {
          patientId: patient.id,
          scope: HEALTH_PROFILE_SCOPE,
          version: HEALTH_PROFILE_CONSENT_VERSION,
          purpose: "TREATMENT",
          state: "GRANTED",
          AND: [
            { OR: [{ providerId: provider.id }, { providerId: null }] },
            { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
          ],
        },
        select: { id: true, version: true },
        orderBy: { grantedAt: "desc" },
      }),
    ]);

    const capabilityAllowed = principal.role === "DOCTOR";
    const access = decideClinicalResourceAccess({
      principal,
      action: "READ",
      providerActive: true,
      capabilityAllowed,
      purpose: "TREATMENT",
      allowedPurposes: ["TREATMENT"],
      withinAccessWindow: Boolean(relationship),
      sensitivityAllowed: true,
      // A current care relationship is enforced above as a time/context gate.
      // Access to the longitudinal profile itself still requires explicit consent,
      // so the policy basis remains PATIENT_CONSENT rather than relationship-only.
      hasTreatmentRelationship: false,
      hasPatientConsent: Boolean(consent),
    });

    if (!relationship || !consent || !access.allowed) {
      const denyReason = !capabilityAllowed
        ? "CAPABILITY_NOT_GRANTED"
        : !relationship
          ? "OUTSIDE_ACCESS_WINDOW"
          : !consent
            ? "NO_ACCESS_BASIS"
            : access.allowed
              ? "NO_ACCESS_BASIS"
              : access.reason;
      await this.audit.writeClinical({
        actorId: principal.accountId,
        action: "HEALTH_PROFILE_READ_DENIED",
        objectType: "PATIENT",
        objectId: patient.id,
        purpose: "TREATMENT",
        result: "DENIED",
        metadata: {
          domain: "HEALTH_PROFILE",
          patientId: patient.id,
          providerId: provider.id,
          denyReason,
          decision: "DENY",
          consentVersion: HEALTH_PROFILE_CONSENT_VERSION,
        },
      });
      throw new ForbiddenException("Health profile access denied.");
    }

    const row = await this.prisma.patientHealthProfile.findUnique({
      where: { patientId: patient.id },
      include: { revisions: { orderBy: { version: "desc" }, take: 1 } },
    });
    if (!row) {
      await this.audit.writeClinical({
        actorId: principal.accountId,
        action: "HEALTH_PROFILE_READ",
        objectType: "PATIENT",
        objectId: patient.id,
        purpose: "TREATMENT",
        result: "SUCCESS",
        metadata: {
          domain: "HEALTH_PROFILE",
          accessBasis: access.basis,
          consentVersion: HEALTH_PROFILE_CONSENT_VERSION,
          patientId: patient.id,
          providerId: provider.id,
          resourceVersion: 0,
          decision: "ALLOW",
        },
      });
      return {
        patientId: patient.id,
        version: 0,
        schemaVersion: 1,
        basics: {},
        updatedAt: null,
        provenance: null,
        accessBasis: access.basis,
      };
    }

    const payload = await this.decrypt(row);
    const latestRevision = row.revisions[0] ?? null;
    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "HEALTH_PROFILE_READ",
      objectType: "PATIENT_HEALTH_PROFILE",
      objectId: row.id,
      purpose: "TREATMENT",
      result: "SUCCESS",
      metadata: {
        domain: "HEALTH_PROFILE",
        accessBasis: access.basis,
        consentVersion: HEALTH_PROFILE_CONSENT_VERSION,
        patientId: patient.id,
        providerId: provider.id,
        resourceId: row.id,
        resourceVersion: row.version,
        decision: "ALLOW",
      },
    });
    return {
      ...this.present(row, payload, latestRevision),
      accessBasis: access.basis,
    };
  }

  async patchMine(principal: AuthPrincipal, input: PatchHealthProfileInput) {
    const patient = await this.requirePatient(principal);
    const expectedVersion = this.expectedVersion(input?.expectedVersion);
    const patch = this.validateBasics(input?.basics);

    const observed = await this.prisma.patientHealthProfile.findUnique({ where: { patientId: patient.id } });
    const observedVersion = observed?.version ?? 0;
    if (observedVersion !== expectedVersion) {
      throw new ConflictException({
        message: "Health profile version conflict.",
        currentVersion: observedVersion,
      });
    }

    const currentPayload: StoredHealthProfile = observed
      ? await this.decrypt(observed)
      : { schemaVersion: 1, basics: {} };
    const nextPayload: StoredHealthProfile = {
      schemaVersion: 1,
      basics: { ...currentPayload.basics, ...patch },
    };
    const changedFields = Object.keys(patch).sort();
    if (changedFields.length === 0) throw new BadRequestException("At least one supported health-profile field is required.");

    const encrypted = await this.envelope.encryptRecord(nextPayload);
    const nextVersion = expectedVersion + 1;

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "PatientProfile" WHERE id = ${patient.id} FOR UPDATE`);
      const current = await tx.patientHealthProfile.findUnique({ where: { patientId: patient.id } });
      const currentVersion = current?.version ?? 0;
      if (currentVersion !== expectedVersion) {
        throw new ConflictException({
          message: "Health profile version conflict.",
          currentVersion,
        });
      }

      const profile = current
        ? await tx.patientHealthProfile.update({
            where: { id: current.id },
            data: { version: nextVersion, ...this.envelopeData(encrypted) },
          })
        : await tx.patientHealthProfile.create({
            data: {
              patientId: patient.id,
              version: nextVersion,
              ...this.envelopeData(encrypted),
            },
          });

      const revision = await tx.profileRevision.create({
        data: {
          profileId: profile.id,
          version: nextVersion,
          sourceType: "PATIENT",
          sourceActorId: principal.accountId,
          changedFields: changedFields as unknown as Prisma.InputJsonValue,
          ...this.envelopeData(encrypted),
        },
      });

      await this.audit.writeClinicalInTransaction(tx, {
        actorId: principal.accountId,
        action: "HEALTH_PROFILE_UPDATED",
        objectType: "PATIENT_HEALTH_PROFILE",
        objectId: profile.id,
        purpose: "PATIENT_ACCESS",
        result: "SUCCESS",
        metadata: {
          domain: "HEALTH_PROFILE",
          accessBasis: "PATIENT_SELF",
          patientId: patient.id,
          resourceId: profile.id,
          resourceVersion: nextVersion,
          changedFields,
          decision: "ALLOW",
        },
      });

      return { profile, revision };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return this.present(result.profile, nextPayload, result.revision);
  }

  private async requirePatient(principal: AuthPrincipal) {
    if (principal.role !== "PATIENT") throw new ForbiddenException("Patient health-profile access requires a patient account.");
    const patient = await this.prisma.patientProfile.findUnique({
      where: { userId: principal.accountId },
      select: { id: true },
    });
    if (!patient) throw new NotFoundException("Patient profile not found.");
    return patient;
  }

  private expectedVersion(value: unknown): number {
    if (!Number.isInteger(value) || Number(value) < 0) {
      throw new BadRequestException("expectedVersion must be a non-negative integer.");
    }
    return Number(value);
  }

  private validateBasics(input: HealthProfileBasics | undefined): HealthProfileBasics {
    if (!input || typeof input !== "object" || Array.isArray(input)) return {};
    const allowed = new Set([
      "dateOfBirth",
      "clinicalSex",
      "heightCm",
      "baselineWeightKg",
      "bloodType",
      "rhesusFactor",
      "relevantNeeds",
    ]);
    for (const key of Object.keys(input)) {
      if (!allowed.has(key)) throw new BadRequestException(`Unsupported health-profile field '${key}'.`);
    }

    const output: HealthProfileBasics = {};
    if ("dateOfBirth" in input) output.dateOfBirth = this.dateOfBirth(input.dateOfBirth);
    if ("clinicalSex" in input) output.clinicalSex = this.enumOrNull(input.clinicalSex, CLINICAL_SEX, "clinicalSex");
    if ("heightCm" in input) output.heightCm = this.numberOrNull(input.heightCm, 30, 300, "heightCm");
    if ("baselineWeightKg" in input) output.baselineWeightKg = this.numberOrNull(input.baselineWeightKg, 1, 500, "baselineWeightKg");
    if ("bloodType" in input) output.bloodType = this.enumOrNull(input.bloodType, BLOOD_TYPE, "bloodType");
    if ("rhesusFactor" in input) output.rhesusFactor = this.enumOrNull(input.rhesusFactor, RHESUS, "rhesusFactor");
    if ("relevantNeeds" in input) {
      if (!Array.isArray(input.relevantNeeds) || input.relevantNeeds.length > MAX_NEEDS) {
        throw new BadRequestException(`relevantNeeds must contain at most ${MAX_NEEDS} items.`);
      }
      output.relevantNeeds = input.relevantNeeds.map((item) => {
        if (typeof item !== "string") throw new BadRequestException("relevantNeeds items must be strings.");
        const value = item.trim();
        if (!value || value.length > MAX_NEED_LENGTH) throw new BadRequestException("relevantNeeds item length is invalid.");
        return value;
      });
    }
    return output;
  }

  private dateOfBirth(value: unknown): string | null {
    if (value == null) return null;
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new BadRequestException("dateOfBirth must use YYYY-MM-DD.");
    }
    const date = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value || date.getTime() > Date.now()) {
      throw new BadRequestException("dateOfBirth is invalid.");
    }
    return value;
  }

  private enumOrNull<T extends string>(value: unknown, allowed: Set<T>, label: string): T | null {
    if (value == null) return null;
    if (typeof value !== "string") throw new BadRequestException(`${label} is invalid.`);
    const normalized = value.trim().toUpperCase() as T;
    if (!allowed.has(normalized)) throw new BadRequestException(`${label} is invalid.`);
    return normalized;
  }

  private numberOrNull(value: unknown, min: number, max: number, label: string): number | null {
    if (value == null) return null;
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
      throw new BadRequestException(`${label} must be between ${min} and ${max}.`);
    }
    return Math.round(value * 100) / 100;
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

  private async decrypt(row: {
    algorithm: string;
    keyId: string;
    wrappedKey: string;
    iv: string;
    ciphertext: string;
  }): Promise<StoredHealthProfile> {
    return this.envelope.decryptRecord<StoredHealthProfile>({
      version: 1,
      algorithm: row.algorithm as "AES-256-GCM",
      keyId: row.keyId,
      wrappedKey: row.wrappedKey,
      iv: row.iv,
      ciphertext: row.ciphertext,
    });
  }

  private present(
    row: { id: string; patientId: string; version: number; updatedAt: Date },
    payload: StoredHealthProfile,
    revision: { sourceType: string; sourceActorId: string | null; createdAt: Date } | null,
  ) {
    return {
      id: row.id,
      patientId: row.patientId,
      version: row.version,
      schemaVersion: payload.schemaVersion,
      basics: payload.basics,
      updatedAt: row.updatedAt,
      provenance: revision
        ? {
            sourceType: revision.sourceType,
            sourceActorId: revision.sourceActorId,
            recordedAt: revision.createdAt,
          }
        : null,
    };
  }
}
