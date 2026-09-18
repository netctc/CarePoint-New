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
  changedClinicalProfileFields,
  normalizeClinicalProfileKind,
  normalizeClinicalProfilePayload,
  normalizeClinicalProfileStatus,
  type ClinicalProfileEntryKind,
  type ClinicalProfilePayload,
} from "./clinical-profile.engine";

const PROFILE_READ_SCOPE = "CLINICAL_PROFILE_READ";
const PROFILE_WRITE_SCOPE = "CLINICAL_PROFILE_WRITE";
const PROFILE_CONSENT_VERSION = "clinical-profile-v1";
const TREATMENT_LOOKBACK_DAYS = 365;
const TREATMENT_LOOKAHEAD_DAYS = 30;

type StoredEntry = {
  schemaVersion: 1;
  payload: ClinicalProfilePayload;
};

export interface CreateClinicalProfileEntryInput {
  kind: ClinicalProfileEntryKind | string;
  status?: string;
  data: unknown;
}

export interface UpdateClinicalProfileEntryInput {
  expectedVersion: number;
  status?: string;
  data: unknown;
}

export interface VerifyClinicalProfileEntryInput {
  expectedVersion: number;
  decision: "VERIFIED" | "REJECTED";
}

export interface ReconcileMedicationInput {
  entryIds: string[];
}

@Injectable()
export class ClinicalProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly envelope: ClinicalEnvelopeService,
  ) {}

  async listMine(principal: AuthPrincipal, kind?: string) {
    const patient = await this.requirePatient(principal);
    return this.listForPatient(patient.id, kind, "PATIENT_SELF");
  }

  async createMine(principal: AuthPrincipal, input: CreateClinicalProfileEntryInput) {
    const patient = await this.requirePatient(principal);
    return this.createEntry(principal, patient.id, input, "PATIENT", "PATIENT_SELF");
  }

  async updateMine(principal: AuthPrincipal, entryId: string, input: UpdateClinicalProfileEntryInput) {
    const patient = await this.requirePatient(principal);
    return this.updateEntry(principal, patient.id, entryId, input, "PATIENT", "PATIENT_SELF");
  }

  async listForDoctor(principal: AuthPrincipal, patientId: string, kind?: string) {
    const access = await this.requireDoctorAccess(principal, patientId, "READ");
    return this.listForPatient(patientId, kind, access.basis);
  }

  async createForDoctor(principal: AuthPrincipal, patientId: string, input: CreateClinicalProfileEntryInput) {
    const access = await this.requireDoctorAccess(principal, patientId, "WRITE");
    return this.createEntry(principal, patientId, input, "PROVIDER", access.basis);
  }

  async updateForDoctor(
    principal: AuthPrincipal,
    patientId: string,
    entryId: string,
    input: UpdateClinicalProfileEntryInput,
  ) {
    const access = await this.requireDoctorAccess(principal, patientId, "WRITE");
    return this.updateEntry(principal, patientId, entryId, input, "PROVIDER", access.basis);
  }

  async verifyForDoctor(
    principal: AuthPrincipal,
    patientId: string,
    entryId: string,
    input: VerifyClinicalProfileEntryInput,
  ) {
    const access = await this.requireDoctorAccess(principal, patientId, "WRITE");
    const expectedVersion = this.nonNegativeInteger(input?.expectedVersion, "expectedVersion");
    const decision = input?.decision;
    if (decision !== "VERIFIED" && decision !== "REJECTED") {
      throw new BadRequestException("decision must be VERIFIED or REJECTED.");
    }
    const observed = await this.prisma.clinicalProfileEntry.findUnique({ where: { id: entryId } });
    if (!observed || observed.patientId !== patientId) throw new NotFoundException("Clinical profile entry not found.");
    if (observed.version !== expectedVersion) {
      throw new ConflictException({ message: "Clinical profile entry version conflict.", currentVersion: observed.version });
    }
    const payload = await this.decrypt(observed);
    const encrypted = await this.envelope.encryptRecord(payload);
    const nextVersion = observed.version + 1;
    const verificationStatus = decision === "VERIFIED" ? "PROVIDER_VERIFIED" : "PROVIDER_REJECTED";

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "ClinicalProfileEntry" WHERE id = ${entryId} FOR UPDATE`);
      const current = await tx.clinicalProfileEntry.findUnique({ where: { id: entryId } });
      if (!current || current.patientId !== patientId) throw new NotFoundException("Clinical profile entry not found.");
      if (current.version !== expectedVersion) {
        throw new ConflictException({ message: "Clinical profile entry version conflict.", currentVersion: current.version });
      }
      const updated = await tx.clinicalProfileEntry.update({
        where: { id: entryId },
        data: {
          version: nextVersion,
          verificationStatus,
          verifiedByActorId: principal.accountId,
          verifiedAt: new Date(),
          sourceType: "PROVIDER",
          sourceActorId: principal.accountId,
          ...this.envelopeData(encrypted),
        },
      });
      await tx.clinicalProfileEntryRevision.create({
        data: {
          entryId,
          version: nextVersion,
          changedFields: ["verificationStatus"] as unknown as Prisma.InputJsonValue,
          verificationStatus,
          sourceType: "PROVIDER",
          sourceActorId: principal.accountId,
          ...this.envelopeData(encrypted),
        },
      });
      await this.audit.writeClinicalInTransaction(tx, {
        actorId: principal.accountId,
        action: "CLINICAL_PROFILE_ENTRY_VERIFIED",
        objectType: "CLINICAL_PROFILE_ENTRY",
        objectId: entryId,
        purpose: "TREATMENT",
        result: "SUCCESS",
        metadata: {
          domain: "CLINICAL_PROFILE",
          accessBasis: access.basis,
          patientId,
          resourceId: entryId,
          resourceVersion: nextVersion,
          changedFields: ["verificationStatus"],
          verificationStatus,
          decision: "ALLOW",
        },
      });
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return this.present(result, payload.payload, access.basis);
  }

  async reconcileMedications(principal: AuthPrincipal, patientId: string, input: ReconcileMedicationInput) {
    const access = await this.requireDoctorAccess(principal, patientId, "WRITE");
    if (!Array.isArray(input?.entryIds) || input.entryIds.length < 1 || input.entryIds.length > 100) {
      throw new BadRequestException("entryIds must contain between 1 and 100 medication entry IDs.");
    }
    const entryIds = [...new Set(input.entryIds.map((item) => this.identifier(item, "entryId")))];
    const entries = await this.prisma.clinicalProfileEntry.findMany({
      where: { id: { in: entryIds }, patientId, kind: "MEDICATION" },
      select: { id: true },
    });
    if (entries.length !== entryIds.length) throw new BadRequestException("All reconciliation entries must be patient medication entries.");
    const provider = await this.providerForPrincipal(principal);
    const row = await this.prisma.medicationReconciliation.create({
      data: {
        patientId,
        providerId: provider.id,
        entryIds: entryIds as unknown as Prisma.InputJsonValue,
        createdByActorId: principal.accountId,
      },
    });
    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "MEDICATION_RECONCILIATION_COMPLETED",
      objectType: "MEDICATION_RECONCILIATION",
      objectId: row.id,
      purpose: "TREATMENT",
      result: "SUCCESS",
      metadata: {
        domain: "CLINICAL_PROFILE",
        accessBasis: access.basis,
        patientId,
        providerId: provider.id,
        resourceId: row.id,
        itemCount: entryIds.length,
        decision: "ALLOW",
      },
    });
    return { id: row.id, patientId, providerId: provider.id, status: row.status, entryIds, createdAt: row.createdAt };
  }

  private async listForPatient(patientId: string, kind: string | undefined, accessBasis: string) {
    const normalizedKind = kind ? normalizeClinicalProfileKind(kind) : undefined;
    const [rows, reconciliation] = await Promise.all([
      this.prisma.clinicalProfileEntry.findMany({
        where: { patientId, ...(normalizedKind ? { kind: normalizedKind } : {}) },
        orderBy: [{ kind: "asc" }, { updatedAt: "desc" }],
      }),
      this.prisma.medicationReconciliation.findFirst({
        where: { patientId },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    const reconciledIds = new Set(this.jsonStringArray(reconciliation?.entryIds));
    const items = [];
    for (const row of rows) {
      const payload = await this.decrypt(row);
      items.push({
        ...this.present(row, payload.payload, accessBasis),
        medicationReconciled: row.kind === "MEDICATION" ? reconciledIds.has(row.id) : undefined,
      });
    }
    await this.audit.writeClinical({
      action: "CLINICAL_PROFILE_LIST_READ",
      objectType: "PATIENT",
      objectId: patientId,
      purpose: accessBasis === "PATIENT_SELF" ? "PATIENT_ACCESS" : "TREATMENT",
      result: "SUCCESS",
      metadata: {
        domain: "CLINICAL_PROFILE",
        accessBasis,
        patientId,
        itemCount: items.length,
        decision: "ALLOW",
      },
    });
    return {
      patientId,
      accessBasis,
      medicationReconciliation: reconciliation
        ? { id: reconciliation.id, status: reconciliation.status, createdAt: reconciliation.createdAt }
        : null,
      items,
    };
  }

  private async createEntry(
    principal: AuthPrincipal,
    patientId: string,
    input: CreateClinicalProfileEntryInput,
    sourceType: "PATIENT" | "PROVIDER",
    accessBasis: string,
  ) {
    const kind = normalizeClinicalProfileKind(input?.kind);
    const status = normalizeClinicalProfileStatus(input?.status);
    const payload = normalizeClinicalProfilePayload(kind, input?.data);
    const encrypted = await this.envelope.encryptRecord({ schemaVersion: 1, payload } satisfies StoredEntry);
    const verificationStatus = sourceType === "PATIENT" ? "PATIENT_DECLARED" : "PROVIDER_VERIFIED";

    const result = await this.prisma.$transaction(async (tx) => {
      const row = await tx.clinicalProfileEntry.create({
        data: {
          patientId,
          kind,
          status,
          version: 1,
          verificationStatus,
          sourceType,
          sourceActorId: principal.accountId,
          ...(sourceType === "PROVIDER" ? { verifiedByActorId: principal.accountId, verifiedAt: new Date() } : {}),
          ...this.envelopeData(encrypted),
        },
      });
      await tx.clinicalProfileEntryRevision.create({
        data: {
          entryId: row.id,
          version: 1,
          changedFields: Object.keys(payload).filter((item) => item !== "kind").sort() as unknown as Prisma.InputJsonValue,
          verificationStatus,
          sourceType,
          sourceActorId: principal.accountId,
          ...this.envelopeData(encrypted),
        },
      });
      await this.audit.writeClinicalInTransaction(tx, {
        actorId: principal.accountId,
        action: "CLINICAL_PROFILE_ENTRY_CREATED",
        objectType: "CLINICAL_PROFILE_ENTRY",
        objectId: row.id,
        purpose: sourceType === "PATIENT" ? "PATIENT_ACCESS" : "TREATMENT",
        result: "SUCCESS",
        metadata: {
          domain: "CLINICAL_PROFILE",
          accessBasis,
          patientId,
          resourceId: row.id,
          resourceVersion: 1,
          changedFields: Object.keys(payload).filter((item) => item !== "kind").sort(),
          verificationStatus,
          sourceType,
          decision: "ALLOW",
        },
      });
      return row;
    });

    return this.present(result, payload, accessBasis);
  }

  private async updateEntry(
    principal: AuthPrincipal,
    patientId: string,
    entryId: string,
    input: UpdateClinicalProfileEntryInput,
    sourceType: "PATIENT" | "PROVIDER",
    accessBasis: string,
  ) {
    const expectedVersion = this.nonNegativeInteger(input?.expectedVersion, "expectedVersion");
    const observed = await this.prisma.clinicalProfileEntry.findUnique({ where: { id: entryId } });
    if (!observed || observed.patientId !== patientId) throw new NotFoundException("Clinical profile entry not found.");
    if (observed.version !== expectedVersion) {
      throw new ConflictException({ message: "Clinical profile entry version conflict.", currentVersion: observed.version });
    }
    const stored = await this.decrypt(observed);
    const nextPayload = normalizeClinicalProfilePayload(observed.kind as ClinicalProfileEntryKind, input?.data, stored.payload);
    const nextStatus = input?.status === undefined ? observed.status : normalizeClinicalProfileStatus(input.status);
    const changedFields = changedClinicalProfileFields(stored.payload, nextPayload);
    if (nextStatus !== observed.status) changedFields.push("status");
    if (changedFields.length === 0) throw new BadRequestException("Clinical profile update contains no changes.");
    const encrypted = await this.envelope.encryptRecord({ schemaVersion: 1, payload: nextPayload } satisfies StoredEntry);
    const nextVersion = observed.version + 1;
    const verificationStatus = sourceType === "PATIENT"
      ? "PATIENT_DECLARED"
      : "PROVIDER_VERIFIED";

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "ClinicalProfileEntry" WHERE id = ${entryId} FOR UPDATE`);
      const current = await tx.clinicalProfileEntry.findUnique({ where: { id: entryId } });
      if (!current || current.patientId !== patientId) throw new NotFoundException("Clinical profile entry not found.");
      if (current.version !== expectedVersion) {
        throw new ConflictException({ message: "Clinical profile entry version conflict.", currentVersion: current.version });
      }
      const row = await tx.clinicalProfileEntry.update({
        where: { id: entryId },
        data: {
          status: nextStatus,
          version: nextVersion,
          verificationStatus,
          sourceType,
          sourceActorId: principal.accountId,
          ...(sourceType === "PROVIDER"
            ? { verifiedByActorId: principal.accountId, verifiedAt: new Date() }
            : { verifiedByActorId: null, verifiedAt: null }),
          ...this.envelopeData(encrypted),
        },
      });
      await tx.clinicalProfileEntryRevision.create({
        data: {
          entryId,
          version: nextVersion,
          changedFields: changedFields as unknown as Prisma.InputJsonValue,
          verificationStatus,
          sourceType,
          sourceActorId: principal.accountId,
          ...this.envelopeData(encrypted),
        },
      });
      await this.audit.writeClinicalInTransaction(tx, {
        actorId: principal.accountId,
        action: "CLINICAL_PROFILE_ENTRY_UPDATED",
        objectType: "CLINICAL_PROFILE_ENTRY",
        objectId: entryId,
        purpose: sourceType === "PATIENT" ? "PATIENT_ACCESS" : "TREATMENT",
        result: "SUCCESS",
        metadata: {
          domain: "CLINICAL_PROFILE",
          accessBasis,
          patientId,
          resourceId: entryId,
          resourceVersion: nextVersion,
          changedFields,
          verificationStatus,
          sourceType,
          decision: "ALLOW",
        },
      });
      return row;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return this.present(result, nextPayload, accessBasis);
  }

  private async requireDoctorAccess(principal: AuthPrincipal, patientId: string, action: "READ" | "WRITE") {
    if (principal.role !== "DOCTOR") throw new ForbiddenException("Clinical profile provider access requires DOCTOR role.");
    const provider = await this.providerForPrincipal(principal);
    const patient = await this.prisma.patientProfile.findUnique({ where: { id: patientId }, select: { id: true } });
    if (!patient) throw new NotFoundException("Patient not found.");

    const now = new Date();
    const from = new Date(now.getTime() - TREATMENT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const to = new Date(now.getTime() + TREATMENT_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);
    const scope = action === "READ" ? PROFILE_READ_SCOPE : PROFILE_WRITE_SCOPE;
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
          scope,
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
      action,
      providerActive: true,
      capabilityAllowed: true,
      purpose: "TREATMENT",
      allowedPurposes: ["TREATMENT"],
      withinAccessWindow: Boolean(relationship),
      sensitivityAllowed: true,
      isAssignedProvider: action === "WRITE" && Boolean(relationship),
      hasTreatmentRelationship: false,
      hasPatientConsent: action === "READ" ? Boolean(consent) : false,
    });

    const allowed = Boolean(relationship) && Boolean(consent) && decision.allowed;
    if (!allowed) {
      await this.audit.writeClinical({
        actorId: principal.accountId,
        action: `CLINICAL_PROFILE_${action}_DENIED`,
        objectType: "PATIENT",
        objectId: patientId,
        purpose: "TREATMENT",
        result: "DENIED",
        metadata: {
          domain: "CLINICAL_PROFILE",
          patientId,
          providerId: provider.id,
          consentVersion: PROFILE_CONSENT_VERSION,
          decision: "DENY",
        },
      });
      throw new ForbiddenException("Clinical profile access denied.");
    }
    return { basis: action === "WRITE" ? "TREATMENT_RELATIONSHIP" : decision.basis, providerId: provider.id };
  }

  private async providerForPrincipal(principal: AuthPrincipal) {
    const provider = await this.prisma.provider.findUnique({
      where: { userId: principal.accountId },
      select: { id: true, status: true },
    });
    if (!provider || provider.status !== "ACTIVE") throw new ForbiddenException("An active doctor provider profile is required.");
    return provider;
  }

  private async requirePatient(principal: AuthPrincipal) {
    if (principal.role !== "PATIENT") throw new ForbiddenException("Patient clinical profile access requires PATIENT role.");
    const patient = await this.prisma.patientProfile.findUnique({ where: { userId: principal.accountId }, select: { id: true } });
    if (!patient) throw new NotFoundException("Patient profile not found.");
    return patient;
  }

  private nonNegativeInteger(value: unknown, field: string): number {
    if (!Number.isInteger(value) || Number(value) < 0) throw new BadRequestException(`${field} must be a non-negative integer.`);
    return Number(value);
  }

  private identifier(value: unknown, field: string): string {
    if (typeof value !== "string") throw new BadRequestException(`${field} is required.`);
    const normalized = value.trim();
    if (!/^[A-Za-z0-9_.:-]{1,180}$/.test(normalized)) throw new BadRequestException(`${field} is invalid.`);
    return normalized;
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

  private decrypt(row: {
    algorithm: string;
    keyId: string;
    wrappedKey: string;
    iv: string;
    ciphertext: string;
  }) {
    return this.envelope.decryptRecord<StoredEntry>({
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
      kind: string;
      status: string;
      version: number;
      verificationStatus: string;
      sourceType: string;
      sourceActorId: string | null;
      verifiedByActorId: string | null;
      verifiedAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
    },
    payload: ClinicalProfilePayload,
    accessBasis: string,
  ) {
    return {
      id: row.id,
      patientId: row.patientId,
      kind: row.kind,
      status: row.status,
      version: row.version,
      data: payload,
      verificationStatus: row.verificationStatus,
      provenance: {
        sourceType: row.sourceType,
        sourceActorId: row.sourceActorId,
        verifiedByActorId: row.verifiedByActorId,
        verifiedAt: row.verifiedAt,
        recordedAt: row.createdAt,
        updatedAt: row.updatedAt,
      },
      accessBasis,
    };
  }
}
