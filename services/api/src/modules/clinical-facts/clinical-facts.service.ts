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
  mergeClinicalFactPayload,
  normalizeClinicalFactKind,
  normalizeClinicalFactPayload,
  normalizeDoctorVerification,
  normalizeMedicationReconciliation,
  type ClinicalFactKind,
  type ClinicalFactPayload,
} from "./clinical-fact.engine";

const FACT_READ_SCOPE = "CLINICAL_FACT_READ";
const FACT_CONSENT_VERSION = "clinical-fact-v1";
const TREATMENT_LOOKBACK_DAYS = 365;
const TREATMENT_LOOKAHEAD_DAYS = 30;
const MAX_FACTS = 500;

type StoredClinicalFact = {
  schemaVersion: 1;
  kind: ClinicalFactKind;
  data: ClinicalFactPayload;
};

export interface CreateClinicalFactInput {
  kind: ClinicalFactKind;
  data: unknown;
}

export interface UpdateClinicalFactInput {
  expectedVersion: number;
  data: unknown;
}

export interface DoctorProblemInput {
  factId?: string;
  expectedVersion?: number;
  data: unknown;
}

export interface VerifyClinicalFactInput {
  verificationStatus: "VERIFIED" | "NEEDS_REVIEW";
  reconciliationStatus?: "CONFIRMED" | "NOT_TAKING" | "NEEDS_REVIEW";
}

@Injectable()
export class ClinicalFactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly envelope: ClinicalEnvelopeService,
  ) {}

  async listMine(principal: AuthPrincipal) {
    const patient = await this.requirePatient(principal);
    const rows = await this.prisma.patientClinicalFact.findMany({
      where: { patientId: patient.id, status: "ACTIVE" },
      include: { revisions: { orderBy: { version: "desc" }, take: 1 } },
      orderBy: [{ kind: "asc" }, { updatedAt: "desc" }],
      take: MAX_FACTS,
    });
    const items = await Promise.all(rows.map(async (row) => this.present(row, await this.decrypt(row), row.revisions[0] ?? null, "PATIENT_SELF")));
    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "CLINICAL_FACT_LIST_READ",
      objectType: "PATIENT",
      objectId: patient.id,
      purpose: "PATIENT_ACCESS",
      result: "SUCCESS",
      metadata: { domain: "CLINICAL_FACT", patientId: patient.id, itemCount: items.length, decision: "ALLOW" },
    });
    return { patientId: patient.id, items };
  }

  async createMine(principal: AuthPrincipal, input: CreateClinicalFactInput) {
    const patient = await this.requirePatient(principal);
    const kind = normalizeClinicalFactKind(input?.kind);
    const data = normalizeClinicalFactPayload(kind, input?.data);
    return this.createFact({
      principal,
      patientId: patient.id,
      kind,
      data,
      sourceType: "PATIENT",
      verificationStatus: "PATIENT_DECLARED",
      reconciliationStatus: kind === "MEDICATION" ? "UNRECONCILED" : null,
      accessBasis: "PATIENT_SELF",
    });
  }

  async updateMine(principal: AuthPrincipal, factId: string, input: UpdateClinicalFactInput) {
    const patient = await this.requirePatient(principal);
    const row = await this.prisma.patientClinicalFact.findUnique({ where: { id: factId } });
    if (!row) throw new NotFoundException("Clinical fact not found.");
    if (row.patientId !== patient.id) throw new ForbiddenException("Clinical fact access denied.");
    if (row.status !== "ACTIVE") throw new ConflictException("Clinical fact is not active.");
    const expectedVersion = this.version(input?.expectedVersion);
    if (row.version !== expectedVersion) throw new ConflictException({ message: "Clinical fact version conflict.", currentVersion: row.version });

    const kind = normalizeClinicalFactKind(row.kind);
    const current = await this.decrypt(row);
    const merged = mergeClinicalFactPayload(kind, current.data, input?.data);
    if (merged.changedFields.length === 0) return this.present(row, current, null, "PATIENT_SELF");
    const encrypted = await this.encrypt(kind, merged.payload);
    const nextVersion = expectedVersion + 1;

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "PatientClinicalFact" WHERE id = ${row.id} FOR UPDATE`);
      const currentRow = await tx.patientClinicalFact.findUnique({ where: { id: row.id } });
      if (!currentRow || currentRow.patientId !== patient.id) throw new ConflictException("Clinical fact changed.");
      if (currentRow.version !== expectedVersion) {
        throw new ConflictException({ message: "Clinical fact version conflict.", currentVersion: currentRow.version });
      }
      const updated = await tx.patientClinicalFact.update({
        where: { id: row.id },
        data: {
          version: nextVersion,
          verificationStatus: "PATIENT_DECLARED",
          verifiedByProviderId: null,
          verifiedByActorId: null,
          verifiedAt: null,
          reconciliationStatus: kind === "MEDICATION" ? "UNRECONCILED" : currentRow.reconciliationStatus,
          sourceType: "PATIENT",
          sourceActorId: principal.accountId,
          ...this.envelopeData(encrypted),
        },
      });
      const revision = await tx.clinicalFactRevision.create({
        data: {
          factId: updated.id,
          version: nextVersion,
          sourceType: "PATIENT",
          sourceActorId: principal.accountId,
          changedFields: merged.changedFields as unknown as Prisma.InputJsonValue,
          ...this.envelopeData(encrypted),
        },
      });
      await this.audit.writeClinicalInTransaction(tx, {
        actorId: principal.accountId,
        action: "CLINICAL_FACT_UPDATED",
        objectType: "PATIENT_CLINICAL_FACT",
        objectId: updated.id,
        purpose: "PATIENT_ACCESS",
        result: "SUCCESS",
        metadata: {
          domain: "CLINICAL_FACT",
          accessBasis: "PATIENT_SELF",
          patientId: patient.id,
          resourceId: updated.id,
          resourceVersion: nextVersion,
          factKind: kind,
          changedFields: merged.changedFields,
          verificationStatus: "PATIENT_DECLARED",
          decision: "ALLOW",
        },
      });
      return { updated, revision };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return this.present(result.updated, { schemaVersion: 1, kind, data: merged.payload }, result.revision, "PATIENT_SELF");
  }

  async snapshotForDoctor(principal: AuthPrincipal, patientId: string) {
    const access = await this.requireDoctorAccess(principal, patientId, "READ");
    const now = new Date();
    const [facts, previousConsult, profile, questionnaireCount, observationCount] = await Promise.all([
      this.prisma.patientClinicalFact.findMany({
        where: { patientId, status: "ACTIVE" },
        include: { revisions: { orderBy: { version: "desc" }, take: 1 } },
        orderBy: [{ kind: "asc" }, { updatedAt: "desc" }],
        take: MAX_FACTS,
      }),
      this.prisma.appointment.findFirst({
        where: {
          providerId: access.provider.id,
          patientId,
          status: "COMPLETED",
          startsAt: { lt: now },
        },
        select: { id: true, startsAt: true, endsAt: true },
        orderBy: { startsAt: "desc" },
      }),
      this.prisma.patientHealthProfile.findUnique({
        where: { patientId },
        select: { id: true, version: true, updatedAt: true },
      }),
      this.prisma.questionnaireResponse.count({ where: { patientId } }),
      this.prisma.observation.count({ where: { patientId } }),
    ]);

    const items = await Promise.all(
      facts.map(async (row) => this.present(row, await this.decrypt(row), row.revisions[0] ?? null, access.basis)),
    );
    const since = previousConsult?.endsAt ?? previousConsult?.startsAt ?? null;
    const [factChanges, questionnaireChanges, observationChanges] = await Promise.all([
      since ? this.prisma.patientClinicalFact.count({ where: { patientId, updatedAt: { gt: since } } }) : Promise.resolve(facts.length),
      since ? this.prisma.questionnaireResponse.count({ where: { patientId, completedAt: { gt: since } } }) : Promise.resolve(questionnaireCount),
      since ? this.prisma.observation.count({ where: { patientId, observedAt: { gt: since } } }) : Promise.resolve(observationCount),
    ]);

    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "CLINICIAN_SNAPSHOT_READ",
      objectType: "PATIENT",
      objectId: patientId,
      purpose: "TREATMENT",
      result: "SUCCESS",
      metadata: {
        domain: "CLINICAL_FACT",
        accessBasis: access.basis,
        consentVersion: FACT_CONSENT_VERSION,
        patientId,
        providerId: access.provider.id,
        itemCount: items.length,
        decision: "ALLOW",
      },
    });

    return {
      patientId,
      accessBasis: access.basis,
      facts: items,
      profile: profile
        ? { resourceId: profile.id, version: profile.version, updatedAt: profile.updatedAt }
        : null,
      sinceLastConsult: {
        appointmentId: previousConsult?.id ?? null,
        since: since?.toISOString() ?? null,
        factChanges,
        questionnaireResponses: questionnaireChanges,
        observations: observationChanges,
      },
      security: {
        encryptedClinicalFacts: true,
        patientConsentRequired: true,
        treatmentRelationshipRequired: true,
        auditedAccess: true,
        automatedClinicalInference: false,
      },
    };
  }

  async doctorProblem(principal: AuthPrincipal, patientId: string, input: DoctorProblemInput) {
    const access = await this.requireDoctorAccess(principal, patientId, "WRITE");
    if (!input?.factId) {
      const data = normalizeClinicalFactPayload("PROBLEM", input?.data);
      return this.createFact({
        principal,
        patientId,
        kind: "PROBLEM",
        data,
        sourceType: "DOCTOR",
        verificationStatus: "VERIFIED",
        reconciliationStatus: null,
        accessBasis: access.basis,
        providerId: access.provider.id,
      });
    }

    const row = await this.prisma.patientClinicalFact.findUnique({ where: { id: input.factId } });
    if (!row || row.patientId !== patientId) throw new NotFoundException("Clinical problem not found.");
    if (row.kind !== "PROBLEM") throw new BadRequestException("Only PROBLEM facts can be updated through this route.");
    const expectedVersion = this.version(input.expectedVersion);
    if (row.version !== expectedVersion) throw new ConflictException({ message: "Clinical fact version conflict.", currentVersion: row.version });
    const current = await this.decrypt(row);
    const merged = mergeClinicalFactPayload("PROBLEM", current.data, input.data);
    if (merged.changedFields.length === 0) return this.present(row, current, null, access.basis);

    const encrypted = await this.encrypt("PROBLEM", merged.payload);
    const nextVersion = expectedVersion + 1;
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "PatientClinicalFact" WHERE id = ${row.id} FOR UPDATE`);
      const currentRow = await tx.patientClinicalFact.findUnique({ where: { id: row.id } });
      if (!currentRow || currentRow.version !== expectedVersion) {
        throw new ConflictException({ message: "Clinical fact version conflict.", currentVersion: currentRow?.version ?? null });
      }
      const verifiedAt = new Date();
      const updated = await tx.patientClinicalFact.update({
        where: { id: row.id },
        data: {
          version: nextVersion,
          verificationStatus: "VERIFIED",
          verifiedByProviderId: access.provider.id,
          verifiedByActorId: principal.accountId,
          verifiedAt,
          sourceType: "DOCTOR",
          sourceActorId: principal.accountId,
          ...this.envelopeData(encrypted),
        },
      });
      const revision = await tx.clinicalFactRevision.create({
        data: {
          factId: updated.id,
          version: nextVersion,
          sourceType: "DOCTOR",
          sourceActorId: principal.accountId,
          changedFields: merged.changedFields as unknown as Prisma.InputJsonValue,
          ...this.envelopeData(encrypted),
        },
      });
      await tx.clinicalFactVerification.create({
        data: {
          factId: updated.id,
          sourceVersion: nextVersion,
          status: "VERIFIED",
          providerId: access.provider.id,
          actorId: principal.accountId,
        },
      });
      await this.audit.writeClinicalInTransaction(tx, {
        actorId: principal.accountId,
        action: "CLINICAL_PROBLEM_UPDATED",
        objectType: "PATIENT_CLINICAL_FACT",
        objectId: updated.id,
        purpose: "TREATMENT",
        result: "SUCCESS",
        metadata: {
          domain: "CLINICAL_FACT",
          accessBasis: access.basis,
          patientId,
          providerId: access.provider.id,
          resourceId: updated.id,
          resourceVersion: nextVersion,
          factKind: "PROBLEM",
          changedFields: merged.changedFields,
          verificationStatus: "VERIFIED",
          decision: "ALLOW",
        },
      });
      return { updated, revision };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return this.present(result.updated, { schemaVersion: 1, kind: "PROBLEM", data: merged.payload }, result.revision, access.basis);
  }

  async verifyFact(principal: AuthPrincipal, patientId: string, factId: string, input: VerifyClinicalFactInput) {
    const access = await this.requireDoctorAccess(principal, patientId, "WRITE");
    const row = await this.prisma.patientClinicalFact.findUnique({ where: { id: factId } });
    if (!row || row.patientId !== patientId) throw new NotFoundException("Clinical fact not found.");
    if (row.status !== "ACTIVE") throw new ConflictException("Clinical fact is not active.");
    const verificationStatus = normalizeDoctorVerification(input?.verificationStatus);
    let reconciliationStatus: string | null = row.reconciliationStatus;
    if (input?.reconciliationStatus !== undefined) {
      if (row.kind !== "MEDICATION") throw new BadRequestException("reconciliationStatus applies only to MEDICATION facts.");
      reconciliationStatus = normalizeMedicationReconciliation(input.reconciliationStatus);
    } else if (row.kind === "MEDICATION" && verificationStatus === "VERIFIED" && !reconciliationStatus) {
      throw new BadRequestException("Medication verification requires reconciliationStatus.");
    }

    const verifiedAt = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "PatientClinicalFact" WHERE id = ${row.id} FOR UPDATE`);
      const current = await tx.patientClinicalFact.findUnique({ where: { id: row.id } });
      if (!current || current.patientId !== patientId) throw new ConflictException("Clinical fact changed.");
      const updated = await tx.patientClinicalFact.update({
        where: { id: row.id },
        data: {
          verificationStatus,
          reconciliationStatus,
          verifiedByProviderId: access.provider.id,
          verifiedByActorId: principal.accountId,
          verifiedAt,
        },
      });
      await tx.clinicalFactVerification.create({
        data: {
          factId: row.id,
          sourceVersion: current.version,
          status: verificationStatus,
          providerId: access.provider.id,
          actorId: principal.accountId,
        },
      });
      await this.audit.writeClinicalInTransaction(tx, {
        actorId: principal.accountId,
        action: "CLINICAL_FACT_VERIFIED",
        objectType: "PATIENT_CLINICAL_FACT",
        objectId: row.id,
        purpose: "TREATMENT",
        result: "SUCCESS",
        metadata: {
          domain: "CLINICAL_FACT",
          accessBasis: access.basis,
          patientId,
          providerId: access.provider.id,
          resourceId: row.id,
          resourceVersion: current.version,
          sourceVersion: current.version,
          factKind: row.kind,
          verificationStatus,
          ...(reconciliationStatus ? { reconciliationStatus } : {}),
          decision: "ALLOW",
        },
      });
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return this.present(result, await this.decrypt(result), null, access.basis);
  }

  private async createFact(input: {
    principal: AuthPrincipal;
    patientId: string;
    kind: ClinicalFactKind;
    data: ClinicalFactPayload;
    sourceType: "PATIENT" | "DOCTOR";
    verificationStatus: "PATIENT_DECLARED" | "VERIFIED";
    reconciliationStatus: string | null;
    accessBasis: string;
    providerId?: string;
  }) {
    const encrypted = await this.encrypt(input.kind, input.data);
    const changedFields = Object.keys(input.data).sort();
    const result = await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const created = await tx.patientClinicalFact.create({
        data: {
          patientId: input.patientId,
          kind: input.kind,
          status: "ACTIVE",
          version: 1,
          verificationStatus: input.verificationStatus,
          reconciliationStatus: input.reconciliationStatus,
          verifiedByProviderId: input.providerId ?? null,
          verifiedByActorId: input.providerId ? input.principal.accountId : null,
          verifiedAt: input.providerId ? now : null,
          sourceType: input.sourceType,
          sourceActorId: input.principal.accountId,
          ...this.envelopeData(encrypted),
        },
      });
      const revision = await tx.clinicalFactRevision.create({
        data: {
          factId: created.id,
          version: 1,
          sourceType: input.sourceType,
          sourceActorId: input.principal.accountId,
          changedFields: changedFields as unknown as Prisma.InputJsonValue,
          ...this.envelopeData(encrypted),
        },
      });
      if (input.providerId) {
        await tx.clinicalFactVerification.create({
          data: {
            factId: created.id,
            sourceVersion: 1,
            status: input.verificationStatus,
            providerId: input.providerId,
            actorId: input.principal.accountId,
          },
        });
      }
      await this.audit.writeClinicalInTransaction(tx, {
        actorId: input.principal.accountId,
        action: input.sourceType === "PATIENT" ? "CLINICAL_FACT_CREATED" : "CLINICAL_PROBLEM_CREATED",
        objectType: "PATIENT_CLINICAL_FACT",
        objectId: created.id,
        purpose: input.sourceType === "PATIENT" ? "PATIENT_ACCESS" : "TREATMENT",
        result: "SUCCESS",
        metadata: {
          domain: "CLINICAL_FACT",
          accessBasis: input.accessBasis,
          patientId: input.patientId,
          ...(input.providerId ? { providerId: input.providerId } : {}),
          resourceId: created.id,
          resourceVersion: 1,
          factKind: input.kind,
          changedFields,
          verificationStatus: input.verificationStatus,
          ...(input.reconciliationStatus ? { reconciliationStatus: input.reconciliationStatus } : {}),
          decision: "ALLOW",
        },
      });
      return { created, revision };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return this.present(result.created, { schemaVersion: 1, kind: input.kind, data: input.data }, result.revision, input.accessBasis);
  }

  private async requireDoctorAccess(principal: AuthPrincipal, patientId: string, action: "READ" | "WRITE") {
    if (principal.role !== "DOCTOR") throw new ForbiddenException("Doctor clinical-fact access requires DOCTOR role.");
    const provider = await this.prisma.provider.findUnique({
      where: { userId: principal.accountId },
      select: { id: true, class: true, status: true },
    });
    if (!provider || provider.class !== "DOCTOR" || provider.status !== "ACTIVE") {
      throw new ForbiddenException("An active doctor provider profile is required.");
    }
    const patient = await this.prisma.patientProfile.findUnique({ where: { id: patientId }, select: { id: true } });
    if (!patient) throw new NotFoundException("Patient not found.");

    const now = new Date();
    const from = new Date(now.getTime() - TREATMENT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const to = new Date(now.getTime() + TREATMENT_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);
    const [relationship, consent] = await Promise.all([
      this.prisma.appointment.findFirst({
        where: { providerId: provider.id, patientId, status: { in: ["CONFIRMED", "COMPLETED"] }, startsAt: { gte: from, lte: to } },
        select: { id: true },
      }),
      this.prisma.consent.findFirst({
        where: {
          patientId,
          scope: FACT_READ_SCOPE,
          version: FACT_CONSENT_VERSION,
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
      hasTreatmentRelationship: action === "READ" ? false : Boolean(relationship),
      hasPatientConsent: Boolean(consent),
    });

    if (!relationship || !consent || !decision.allowed) {
      const denyReason = !relationship ? "OUTSIDE_ACCESS_WINDOW" : !consent ? "NO_ACCESS_BASIS" : decision.allowed ? "NO_ACCESS_BASIS" : decision.reason;
      await this.audit.writeClinical({
        actorId: principal.accountId,
        action: "CLINICAL_FACT_ACCESS_DENIED",
        objectType: "PATIENT",
        objectId: patientId,
        purpose: "TREATMENT",
        result: "DENIED",
        metadata: {
          domain: "CLINICAL_FACT",
          patientId,
          providerId: provider.id,
          consentVersion: FACT_CONSENT_VERSION,
          denyReason,
          decision: "DENY",
        },
      });
      throw new ForbiddenException("Clinical fact access denied.");
    }

    return { provider, basis: action === "READ" ? "PATIENT_CONSENT" : decision.basis };
  }

  private async requirePatient(principal: AuthPrincipal) {
    if (principal.role !== "PATIENT") throw new ForbiddenException("Patient clinical-fact access requires PATIENT role.");
    const patient = await this.prisma.patientProfile.findUnique({ where: { userId: principal.accountId }, select: { id: true } });
    if (!patient) throw new NotFoundException("Patient profile not found.");
    return patient;
  }

  private version(value: unknown): number {
    if (!Number.isInteger(value) || Number(value) < 1) throw new BadRequestException("expectedVersion must be a positive integer.");
    return Number(value);
  }

  private encrypt(kind: ClinicalFactKind, data: ClinicalFactPayload) {
    return this.envelope.encryptRecord({ schemaVersion: 1, kind, data } satisfies StoredClinicalFact);
  }

  private decrypt(row: { kind: string; algorithm: string; keyId: string; wrappedKey: string; iv: string; ciphertext: string }) {
    return this.envelope.decryptRecord<StoredClinicalFact>({
      version: 1,
      algorithm: row.algorithm as "AES-256-GCM",
      keyId: row.keyId,
      wrappedKey: row.wrappedKey,
      iv: row.iv,
      ciphertext: row.ciphertext,
    });
  }

  private envelopeData(envelope: EncryptedEnvelope) {
    return { algorithm: envelope.algorithm, keyId: envelope.keyId, wrappedKey: envelope.wrappedKey, iv: envelope.iv, ciphertext: envelope.ciphertext };
  }

  private present(
    row: {
      id: string;
      patientId: string;
      kind: string;
      status: string;
      version: number;
      verificationStatus: string;
      reconciliationStatus: string | null;
      verifiedByProviderId: string | null;
      verifiedAt: Date | null;
      sourceType: string;
      sourceActorId: string | null;
      createdAt: Date;
      updatedAt: Date;
    },
    payload: StoredClinicalFact,
    revision: { sourceType: string; sourceActorId: string | null; createdAt: Date } | null,
    accessBasis: string,
  ) {
    return {
      id: row.id,
      patientId: row.patientId,
      kind: row.kind,
      status: row.status,
      version: row.version,
      data: payload.data,
      verification: {
        status: row.verificationStatus,
        verifiedByProviderId: row.verifiedByProviderId,
        verifiedAt: row.verifiedAt,
        ...(row.kind === "MEDICATION" ? { reconciliationStatus: row.reconciliationStatus ?? "UNRECONCILED" } : {}),
      },
      provenance: {
        sourceType: revision?.sourceType ?? row.sourceType,
        sourceActorId: revision?.sourceActorId ?? row.sourceActorId,
        recordedAt: revision?.createdAt ?? row.createdAt,
      },
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      accessBasis,
    };
  }
}
