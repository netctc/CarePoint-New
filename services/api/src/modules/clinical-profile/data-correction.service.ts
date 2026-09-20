import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, type ClinicalProfileEntry, type CorrectionDecision, type DataCorrectionRequest } from "@prisma/client";
import type { EncryptedEnvelope } from "@carepoint/security";
import { decideClinicalResourceAccess, type AuthPrincipal } from "@carepoint/identity";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { ClinicalEnvelopeService } from "../clinical/clinical-envelope.service";
import {
  changedClinicalProfileFields,
  normalizeClinicalProfilePayload,
  normalizeClinicalProfileStatus,
  type ClinicalProfileEntryKind,
  type ClinicalProfilePayload,
} from "./clinical-profile.engine";
import {
  DataCorrectionStatuses,
  normalizeCreateDataCorrectionInput,
  normalizeDecideDataCorrectionInput,
  targetCorrectionStatus,
  type CreateDataCorrectionInput,
  type DataCorrectionStatus,
  type DecideDataCorrectionInput,
} from "./data-correction.engine";

const PROFILE_READ_SCOPE = "CLINICAL_PROFILE_READ";
const PROFILE_WRITE_SCOPE = "CLINICAL_PROFILE_WRITE";
const PROFILE_CONSENT_VERSION = "clinical-profile-v1";
const TREATMENT_LOOKBACK_DAYS = 365;
const TREATMENT_LOOKAHEAD_DAYS = 30;
const MAX_REQUESTS = 250;

type StoredEntry = { schemaVersion: 1; payload: ClinicalProfilePayload };
type StoredRequest = { schemaVersion: 1; note: string };
type StoredDecision = { schemaVersion: 1; reason: string };

@Injectable()
export class DataCorrectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly envelope: ClinicalEnvelopeService,
  ) {}

  async createMine(principal: AuthPrincipal, raw: Record<string, unknown>) {
    const patient = await this.requirePatient(principal);
    const input = this.createInput(raw);
    const observed = await this.requireEntry(patient.id, input.entryId);
    if (observed.version !== input.expectedEntryVersion) {
      throw new ConflictException({
        message: "Clinical profile entry version conflict.",
        currentVersion: observed.version,
      });
    }
    const encrypted = await this.envelope.encryptRecord({ schemaVersion: 1, note: input.note } satisfies StoredRequest);

    try {
      const request = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM "ClinicalProfileEntry" WHERE id = ${observed.id} FOR UPDATE`);
        const current = await tx.clinicalProfileEntry.findUnique({ where: { id: observed.id } });
        if (!current || current.patientId !== patient.id) throw new NotFoundException("Clinical profile entry not found.");
        if (current.version !== input.expectedEntryVersion) {
          throw new ConflictException({
            message: "Clinical profile entry version conflict.",
            currentVersion: current.version,
          });
        }
        const active = await tx.dataCorrectionRequest.findFirst({
          where: {
            entryId: current.id,
            status: { in: ["OPEN", "CLARIFICATION_REQUESTED"] },
          },
          select: { id: true },
        });
        if (active) throw new ConflictException("An active correction request already exists for this entry.");

        const created = await tx.dataCorrectionRequest.create({
          data: {
            patientId: patient.id,
            entryId: current.id,
            entryVersion: current.version,
            reasonCode: input.reasonCode,
            status: "OPEN",
            version: 1,
            requesterActorId: principal.accountId,
            ...this.envelopeData(encrypted),
          },
        });
        await this.audit.writeClinicalInTransaction(tx, {
          actorId: principal.accountId,
          action: "DATA_CORRECTION_REQUEST_CREATED",
          objectType: "DATA_CORRECTION_REQUEST",
          objectId: created.id,
          purpose: "PATIENT_ACCESS",
          result: "SUCCESS",
          metadata: {
            domain: "CLINICAL_PROFILE",
            patientId: patient.id,
            resourceId: current.id,
            resourceVersion: current.version,
            requestVersion: 1,
            reasonCode: input.reasonCode,
            decision: "ALLOW",
          },
        });
        return created;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return this.presentRequest(request);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("An active correction request already exists for this entry.");
      }
      throw error;
    }
  }

  async listMine(principal: AuthPrincipal) {
    const patient = await this.requirePatient(principal);
    const rows = await this.prisma.dataCorrectionRequest.findMany({
      where: { patientId: patient.id },
      orderBy: { createdAt: "desc" },
      take: MAX_REQUESTS,
    });
    const items = [];
    for (const row of rows) items.push(await this.presentRequest(row));
    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "DATA_CORRECTION_REQUEST_LIST_READ",
      objectType: "PATIENT",
      objectId: patient.id,
      purpose: "PATIENT_ACCESS",
      result: "SUCCESS",
      metadata: {
        domain: "CLINICAL_PROFILE",
        patientId: patient.id,
        itemCount: items.length,
        decision: "ALLOW",
      },
    });
    return { patientId: patient.id, items };
  }

  async listForDoctor(principal: AuthPrincipal, patientId: string) {
    const access = await this.requireDoctorAccess(principal, patientId, "READ");
    const rows = await this.prisma.dataCorrectionRequest.findMany({
      where: { patientId },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: MAX_REQUESTS,
    });
    const items = [];
    for (const row of rows) items.push(await this.presentRequest(row));
    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "DATA_CORRECTION_REQUEST_PROVIDER_LIST_READ",
      objectType: "PATIENT",
      objectId: patientId,
      purpose: "TREATMENT",
      result: "SUCCESS",
      metadata: {
        domain: "CLINICAL_PROFILE",
        patientId,
        providerId: access.providerId,
        accessBasis: access.basis,
        itemCount: items.length,
        decision: "ALLOW",
      },
    });
    return { patientId, accessBasis: access.basis, items };
  }

  async decide(principal: AuthPrincipal, entryId: string, raw: Record<string, unknown>) {
    const input = this.decisionInput({ ...raw, entryId });
    const request = await this.prisma.dataCorrectionRequest.findUnique({ where: { id: input.requestId } });
    if (!request || request.entryId !== entryId) throw new NotFoundException("Data correction request not found.");
    const access = await this.requireDoctorAccess(principal, request.patientId, "WRITE");
    const observedEntry = await this.requireEntry(request.patientId, entryId);
    if (request.version !== input.expectedRequestVersion) {
      throw new ConflictException({ message: "Data correction request version conflict.", currentVersion: request.version });
    }
    if (observedEntry.version !== input.expectedEntryVersion) {
      throw new ConflictException({ message: "Clinical profile entry version conflict.", currentVersion: observedEntry.version });
    }
    const targetStatus = this.correctionTarget(request.status, input.action);
    const decisionEnvelope = await this.envelope.encryptRecord({ schemaVersion: 1, reason: input.reason } satisfies StoredDecision);

    let corrected: {
      payload: ClinicalProfilePayload;
      status: string;
      changedFields: string[];
      envelope: EncryptedEnvelope;
    } | null = null;

    if (input.action === "RESOLVE_CORRECTION") {
      const stored = await this.decryptEntry(observedEntry);
      const nextPayload = normalizeClinicalProfilePayload(
        observedEntry.kind as ClinicalProfileEntryKind,
        input.correctedData,
        stored.payload,
      );
      const nextStatus = input.correctedStatus == null
        ? observedEntry.status
        : normalizeClinicalProfileStatus(input.correctedStatus);
      const changedFields = changedClinicalProfileFields(stored.payload, nextPayload);
      if (nextStatus !== observedEntry.status) changedFields.push("status");
      if (changedFields.length === 0) {
        throw new BadRequestException("Correction resolution must change the clinical profile entry.");
      }
      corrected = {
        payload: nextPayload,
        status: nextStatus,
        changedFields: [...new Set(changedFields)].sort(),
        envelope: await this.envelope.encryptRecord({ schemaVersion: 1, payload: nextPayload } satisfies StoredEntry),
      };
    }

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "DataCorrectionRequest" WHERE id = ${request.id} FOR UPDATE`);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "ClinicalProfileEntry" WHERE id = ${entryId} FOR UPDATE`);
      const [currentRequest, currentEntry] = await Promise.all([
        tx.dataCorrectionRequest.findUnique({ where: { id: request.id } }),
        tx.clinicalProfileEntry.findUnique({ where: { id: entryId } }),
      ]);
      if (!currentRequest || currentRequest.entryId !== entryId) throw new NotFoundException("Data correction request not found.");
      if (!currentEntry || currentEntry.patientId !== request.patientId) throw new NotFoundException("Clinical profile entry not found.");
      if (currentRequest.version !== input.expectedRequestVersion) {
        throw new ConflictException({ message: "Data correction request version conflict.", currentVersion: currentRequest.version });
      }
      if (currentEntry.version !== input.expectedEntryVersion) {
        throw new ConflictException({ message: "Clinical profile entry version conflict.", currentVersion: currentEntry.version });
      }

      let entryVersionAfter: number | null = currentEntry.version;
      if (corrected) {
        entryVersionAfter = currentEntry.version + 1;
        await tx.clinicalProfileEntry.update({
          where: { id: currentEntry.id },
          data: {
            status: corrected.status,
            version: entryVersionAfter,
            verificationStatus: "PROVIDER_VERIFIED",
            sourceType: "PROVIDER",
            sourceActorId: principal.accountId,
            verifiedByActorId: principal.accountId,
            verifiedAt: new Date(),
            ...this.envelopeData(corrected.envelope),
          },
        });
        await tx.clinicalProfileEntryRevision.create({
          data: {
            entryId: currentEntry.id,
            version: entryVersionAfter,
            changedFields: corrected.changedFields as unknown as Prisma.InputJsonValue,
            verificationStatus: "PROVIDER_VERIFIED",
            sourceType: "PROVIDER",
            sourceActorId: principal.accountId,
            ...this.envelopeData(corrected.envelope),
          },
        });
      }

      const terminal = targetStatus === "RESOLVED" || targetStatus === "REJECTED" || targetStatus === "CANCELLED";
      const updatedRequest = await tx.dataCorrectionRequest.update({
        where: { id: currentRequest.id },
        data: {
          status: targetStatus,
          version: { increment: 1 },
          ...(terminal ? { resolvedByActorId: principal.accountId, resolvedAt: new Date() } : {}),
        },
      });
      const decision = await tx.correctionDecision.create({
        data: {
          requestId: currentRequest.id,
          action: input.action,
          actorAccountId: principal.accountId,
          entryVersionBefore: currentEntry.version,
          entryVersionAfter,
          ...this.envelopeData(decisionEnvelope),
        },
      });
      await this.audit.writeClinicalInTransaction(tx, {
        actorId: principal.accountId,
        action: `DATA_CORRECTION_${input.action}`,
        objectType: "DATA_CORRECTION_REQUEST",
        objectId: currentRequest.id,
        purpose: "TREATMENT",
        result: "SUCCESS",
        metadata: {
          domain: "CLINICAL_PROFILE",
          patientId: currentRequest.patientId,
          providerId: access.providerId,
          resourceId: currentEntry.id,
          requestVersion: updatedRequest.version,
          entryVersionBefore: currentEntry.version,
          entryVersionAfter,
          status: targetStatus,
          changedFields: corrected?.changedFields ?? [],
          accessBasis: access.basis,
          decision: "ALLOW",
        },
      });
      return { request: updatedRequest, decision };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return this.presentRequest(result.request);
  }

  private async presentRequest(row: DataCorrectionRequest) {
    const requestPayload = await this.envelope.decryptRecord<StoredRequest>(this.asEnvelope(row));
    const decisions = await this.prisma.correctionDecision.findMany({
      where: { requestId: row.id },
      orderBy: { createdAt: "asc" },
      take: 100,
    });
    const presentedDecisions = [];
    for (const decision of decisions) presentedDecisions.push(await this.presentDecision(decision));
    return {
      id: row.id,
      patientId: row.patientId,
      entryId: row.entryId,
      entryVersion: row.entryVersion,
      reasonCode: row.reasonCode,
      status: row.status,
      version: row.version,
      note: requestPayload.note,
      requesterActorId: row.requesterActorId,
      resolvedByActorId: row.resolvedByActorId,
      resolvedAt: row.resolvedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      decisions: presentedDecisions,
    };
  }

  private async presentDecision(row: CorrectionDecision) {
    const payload = await this.envelope.decryptRecord<StoredDecision>(this.asEnvelope(row));
    return {
      id: row.id,
      action: row.action,
      actorAccountId: row.actorAccountId,
      entryVersionBefore: row.entryVersionBefore,
      entryVersionAfter: row.entryVersionAfter,
      reason: payload.reason,
      createdAt: row.createdAt,
    };
  }

  private async requireEntry(patientId: string, entryId: string): Promise<ClinicalProfileEntry> {
    if (!entryId?.trim()) throw new BadRequestException("entryId is required.");
    const entry = await this.prisma.clinicalProfileEntry.findUnique({ where: { id: entryId.trim() } });
    if (!entry || entry.patientId !== patientId) throw new NotFoundException("Clinical profile entry not found.");
    return entry;
  }

  private async requirePatient(principal: AuthPrincipal) {
    if (principal.role !== "PATIENT") throw new ForbiddenException("Patient data correction access requires PATIENT role.");
    const patient = await this.prisma.patientProfile.findUnique({
      where: { userId: principal.accountId },
      select: { id: true },
    });
    if (!patient) throw new NotFoundException("Patient profile not found.");
    return patient;
  }

  private async requireDoctorAccess(principal: AuthPrincipal, patientId: string, action: "READ" | "WRITE") {
    if (principal.role !== "DOCTOR") throw new ForbiddenException("Patient data correction workflow requires DOCTOR role.");
    const provider = await this.prisma.provider.findUnique({
      where: { userId: principal.accountId },
      select: { id: true, status: true, class: true },
    });
    if (!provider || provider.status !== "ACTIVE" || provider.class !== "DOCTOR") {
      throw new ForbiddenException("An active doctor provider profile is required.");
    }
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
    if (!relationship || !consent || !decision.allowed) {
      await this.audit.writeClinical({
        actorId: principal.accountId,
        action: `DATA_CORRECTION_${action}_DENIED`,
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
      throw new ForbiddenException("Patient data correction access denied.");
    }
    return {
      providerId: provider.id,
      basis: action === "WRITE" ? "TREATMENT_RELATIONSHIP" : decision.basis,
    };
  }

  private createInput(raw: Record<string, unknown>): CreateDataCorrectionInput {
    try { return normalizeCreateDataCorrectionInput(raw); }
    catch (error) { throw new BadRequestException(error instanceof Error ? error.message : "Invalid correction request input."); }
  }

  private decisionInput(raw: Record<string, unknown>): DecideDataCorrectionInput {
    try { return normalizeDecideDataCorrectionInput(raw); }
    catch (error) { throw new BadRequestException(error instanceof Error ? error.message : "Invalid correction decision input."); }
  }

  private correctionTarget(status: string, action: DecideDataCorrectionInput["action"]): DataCorrectionStatus {
    if (!DataCorrectionStatuses.includes(status as DataCorrectionStatus)) {
      throw new ConflictException("Data correction request status is invalid.");
    }
    try { return targetCorrectionStatus(status as DataCorrectionStatus, action); }
    catch (error) { throw new ConflictException(error instanceof Error ? error.message : "Invalid correction transition."); }
  }

  private decryptEntry(row: ClinicalProfileEntry) {
    return this.envelope.decryptRecord<StoredEntry>(this.asEnvelope(row));
  }

  private asEnvelope(row: { algorithm: string; keyId: string; wrappedKey: string; iv: string; ciphertext: string }): EncryptedEnvelope {
    if (row.algorithm !== "AES-256-GCM") throw new ConflictException("Unsupported clinical data encryption algorithm.");
    return {
      version: 1,
      algorithm: "AES-256-GCM",
      keyId: row.keyId,
      wrappedKey: row.wrappedKey,
      iv: row.iv,
      ciphertext: row.ciphertext,
    };
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
