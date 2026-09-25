import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, type MedicationReconciliation, type MedicationReconciliationItem } from "@prisma/client";
import { decideClinicalResourceAccess, type AuthPrincipal } from "@carepoint/identity";
import type { EncryptedEnvelope } from "@carepoint/security";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { ClinicalEnvelopeService } from "../clinical/clinical-envelope.service";
import { OrdersAttestationService } from "../orders/orders-attestation.service";

const PROFILE_READ_SCOPE = "CLINICAL_PROFILE_READ";
const PROFILE_WRITE_SCOPE = "CLINICAL_PROFILE_WRITE";
const PROFILE_CONSENT_VERSION = "clinical-profile-v1";
const TREATMENT_LOOKBACK_DAYS = 365;
const TREATMENT_LOOKAHEAD_DAYS = 30;
const OUTCOMES = new Set(["CONTINUE","SUSPEND","DUPLICATE","CORRECT","MATCHED"]);
const RESOLUTION_STATUSES = new Set(["OPEN","RESOLVED"]);
const MAX_ITEMS = 100;

type Outcome = "CONTINUE" | "SUSPEND" | "DUPLICATE" | "CORRECT" | "MATCHED";
type ResolutionStatus = "OPEN" | "RESOLVED";
type StoredReason = { schemaVersion: 1; reason: string | null };

export interface MedicationReconciliationItemInput {
  statementEntryId: string;
  prescriptionOrderId?: string | null;
  outcome: Outcome | string;
  resolutionStatus?: ResolutionStatus | string;
  reason?: string | null;
}

export interface SignedMedicationReconciliationInput {
  expectedLatestReconciliationId?: string | null;
  items?: MedicationReconciliationItemInput[];
  entryIds?: string[];
}

type PersistedItem = MedicationReconciliationItem;
type PersistedReconciliation = MedicationReconciliation & { items: PersistedItem[] };

@Injectable()
export class MedicationReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly envelope: ClinicalEnvelopeService,
    private readonly attestation: OrdersAttestationService,
  ) {}

  async forDoctor(principal: AuthPrincipal, patientId: string) {
    const access = await this.requireDoctorAccess(principal, patientId, "READ");
    const latest = await this.latest(patientId);
    const result = await this.present(latest, patientId);
    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "MEDICATION_RECONCILIATION_READ",
      objectType: "PATIENT",
      objectId: patientId,
      purpose: "TREATMENT",
      result: "SUCCESS",
      metadata: {
        domain: "MEDICATION_RECONCILIATION",
        patientId,
        providerId: access.providerId,
        accessBasis: access.basis,
        reconciliationId: result?.id ?? null,
        decision: "ALLOW",
      },
    });
    return { patientId, accessBasis: access.basis, reconciliation: result };
  }

  async mine(principal: AuthPrincipal) {
    const patient = await this.requirePatient(principal);
    const latest = await this.latest(patient.id);
    const result = await this.present(latest, patient.id);
    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "MEDICATION_RECONCILIATION_PATIENT_READ",
      objectType: "PATIENT",
      objectId: patient.id,
      purpose: "PATIENT_ACCESS",
      result: "SUCCESS",
      metadata: {
        domain: "MEDICATION_RECONCILIATION",
        patientId: patient.id,
        reconciliationId: result?.id ?? null,
        decision: "ALLOW",
      },
    });
    return { patientId: patient.id, accessBasis: "PATIENT_SELF", reconciliation: result };
  }

  async reconcile(
    principal: AuthPrincipal,
    patientId: string,
    raw: SignedMedicationReconciliationInput,
  ) {
    const access = await this.requireDoctorAccess(principal, patientId, "WRITE");
    const provider = await this.requireDoctor(principal);
    const latest = await this.latest(patientId);

    const expected = raw?.expectedLatestReconciliationId == null
      ? null
      : this.id(raw.expectedLatestReconciliationId, "expectedLatestReconciliationId");
    if ((latest?.id ?? null) !== expected && raw?.expectedLatestReconciliationId !== undefined) {
      throw new ConflictException({
        message: "Medication reconciliation changed; refresh and retry.",
        currentReconciliationId: latest?.id ?? null,
      });
    }

    const normalized = this.normalizeItems(raw);
    const statementIds = normalized.map((item) => item.statementEntryId);
    const statements = await this.prisma.clinicalProfileEntry.findMany({
      where: { id: { in: statementIds }, patientId, kind: "MEDICATION" },
      select: {
        id: true,
        patientId: true,
        version: true,
        status: true,
        verificationStatus: true,
        sourceType: true,
        sourceActorId: true,
        verifiedByActorId: true,
        verifiedAt: true,
        algorithm: true,
        keyId: true,
        wrappedKey: true,
        iv: true,
        ciphertext: true,
        updatedAt: true,
      },
    });
    if (statements.length !== statementIds.length) {
      throw new BadRequestException("Every reconciliation statement must reference this patient's MEDICATION entry.");
    }

    const orderIds = [...new Set(normalized.map((item) => item.prescriptionOrderId).filter((value): value is string => Boolean(value)))];
    if (orderIds.length > 0) {
      const orders = await this.prisma.clinicalOrder.findMany({
        where: { id: { in: orderIds }, patientId, type: "PRESCRIPTION" },
        select: { id: true },
      });
      if (orders.length !== orderIds.length) {
        throw new BadRequestException("Every prescriptionOrderId must reference this patient's PRESCRIPTION order.");
      }
    }

    const priorOpen = latest?.items.filter((item) => item.resolutionStatus === "OPEN") ?? [];
    const nextStatementIds = new Set(statementIds);
    for (const item of priorOpen) {
      if (!nextStatementIds.has(item.statementEntryId)) {
        throw new ConflictException("Open medication discrepancies must be explicitly carried forward or resolved.");
      }
    }

    const encryptedItems = await Promise.all(normalized.map(async (item) => ({
      ...item,
      envelope: await this.envelope.encryptRecord({
        schemaVersion: 1,
        reason: item.reason,
      } satisfies StoredReason),
    })));
    const version = (latest?.version ?? 0) + 1;
    const status = encryptedItems.some((item) => item.resolutionStatus === "OPEN") ? "OPEN" : "COMPLETED";
    const material = this.attestationMaterial({
      patientId,
      providerId: provider.id,
      version,
      supersedesId: latest?.id ?? null,
      status,
      items: encryptedItems.map((item) => ({
        statementEntryId: item.statementEntryId,
        prescriptionOrderId: item.prescriptionOrderId,
        outcome: item.outcome,
        resolutionStatus: item.resolutionStatus,
        envelope: item.envelope,
      })),
    });
    const signed = await this.attestation.attest(material);

    const created = await this.prisma.$transaction(async (tx) => {
      await this.audit.reserveIntegrityChainForSerializableTransaction(tx);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "PatientProfile" WHERE id = ${patientId} FOR UPDATE`);
      const current = await tx.medicationReconciliation.findFirst({
        where: { patientId },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if ((current?.id ?? null) !== (latest?.id ?? null)) {
        throw new ConflictException("Medication reconciliation changed concurrently. Refresh and retry.");
      }

      const row = await tx.medicationReconciliation.create({
        data: {
          patientId,
          providerId: provider.id,
          entryIds: statementIds as unknown as Prisma.InputJsonValue,
          version,
          supersedesId: latest?.id ?? null,
          status,
          payloadDigest: signed.payloadDigest,
          signatureAlgorithm: signed.algorithm,
          signatureKeyId: signed.keyId,
          signature: signed.signature,
          signedAt: signed.signedAt,
          createdByActorId: principal.accountId,
          items: {
            create: encryptedItems.map((item) => ({
              patientId,
              statementEntryId: item.statementEntryId,
              prescriptionOrderId: item.prescriptionOrderId,
              outcome: item.outcome,
              resolutionStatus: item.resolutionStatus,
              ...this.envelopeData(item.envelope),
            })),
          },
        },
        include: { items: true },
      });

      await this.audit.writeClinicalInTransaction(tx, {
        actorId: principal.accountId,
        action: "MEDICATION_RECONCILIATION_SIGNED",
        objectType: "MEDICATION_RECONCILIATION",
        objectId: row.id,
        purpose: "TREATMENT",
        result: "SUCCESS",
        metadata: {
          domain: "MEDICATION_RECONCILIATION",
          accessBasis: access.basis,
          patientId,
          providerId: provider.id,
          resourceId: row.id,
          resourceVersion: version,
          itemCount: encryptedItems.length,
          openDiscrepancyCount: encryptedItems.filter((item) => item.resolutionStatus === "OPEN").length,
          outcomes: [...new Set(encryptedItems.map((item) => item.outcome))].sort(),
          payloadDigest: signed.payloadDigest,
          decision: "ALLOW",
        },
      });
      return row;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return this.present(created, patientId);
  }

  private async latest(patientId: string): Promise<PersistedReconciliation | null> {
    return this.prisma.medicationReconciliation.findFirst({
      where: { patientId },
      include: { items: { orderBy: [{ statementEntryId: "asc" }, { createdAt: "asc" }] } },
      orderBy: { createdAt: "desc" },
    });
  }

  private async present(row: PersistedReconciliation | null, patientId: string) {
    if (!row) return null;
    if (row.patientId !== patientId) throw new NotFoundException("Medication reconciliation not found.");

    const legacyEntryIds = this.jsonStringArray(row.entryIds);
    const items = row.items.length > 0
      ? row.items
      : legacyEntryIds.map((entryId) => ({
          id: `legacy:${entryId}`,
          reconciliationId: row.id,
          patientId,
          statementEntryId: entryId,
          prescriptionOrderId: null,
          outcome: "MATCHED",
          resolutionStatus: "RESOLVED",
          algorithm: "",
          keyId: "",
          wrappedKey: "",
          iv: "",
          ciphertext: "",
          createdAt: row.createdAt,
        } satisfies PersistedItem));

    let attestationVerified = false;
    if (
      row.payloadDigest &&
      row.signature &&
      row.signatureAlgorithm &&
      row.signatureKeyId &&
      row.signedAt &&
      row.items.length > 0
    ) {
      const material = this.attestationMaterial({
        patientId: row.patientId,
        providerId: row.providerId,
        version: row.version,
        supersedesId: row.supersedesId,
        status: row.status,
        items: row.items.map((item) => ({
          statementEntryId: item.statementEntryId,
          prescriptionOrderId: item.prescriptionOrderId,
          outcome: item.outcome as Outcome,
          resolutionStatus: item.resolutionStatus as ResolutionStatus,
          envelope: this.itemEnvelope(item),
        })),
      });
      attestationVerified = await this.attestation.verify(material, {
        payloadDigest: row.payloadDigest,
        signature: row.signature,
        signedAt: row.signedAt,
        keyId: row.signatureKeyId,
        algorithm: row.signatureAlgorithm,
      });
      if (!attestationVerified) throw new ConflictException("Medication reconciliation attestation verification failed.");
    }

    const statementIds = [...new Set(items.map((item) => item.statementEntryId))];
    const orderIds = [...new Set(items.map((item) => item.prescriptionOrderId).filter((value): value is string => Boolean(value)))];
    const [statements, orders, provider] = await Promise.all([
      this.prisma.clinicalProfileEntry.findMany({
        where: { id: { in: statementIds }, patientId, kind: "MEDICATION" },
      }),
      orderIds.length === 0
        ? Promise.resolve([])
        : this.prisma.clinicalOrder.findMany({
            where: { id: { in: orderIds }, patientId, type: "PRESCRIPTION" },
            select: { id: true, status: true, providerId: true, signedAt: true, createdAt: true },
          }),
      this.prisma.provider.findUnique({
        where: { id: row.providerId },
        select: { id: true, displayName: true },
      }),
    ]);
    const statementMap = new Map(statements.map((item) => [item.id, item]));
    const orderMap = new Map(orders.map((item) => [item.id, item]));

    const presentedItems = [];
    for (const item of items) {
      const statement = statementMap.get(item.statementEntryId);
      if (!statement) continue;
      const stored = await this.envelope.decryptRecord<{ schemaVersion: 1; payload: Record<string, unknown> }>({
        version: 1,
        algorithm: statement.algorithm as "AES-256-GCM",
        keyId: statement.keyId,
        wrappedKey: statement.wrappedKey,
        iv: statement.iv,
        ciphertext: statement.ciphertext,
      });
      const reason = item.id.startsWith("legacy:")
        ? null
        : (await this.envelope.decryptRecord<StoredReason>(this.itemEnvelope(item))).reason;
      const order = item.prescriptionOrderId ? orderMap.get(item.prescriptionOrderId) ?? null : null;
      presentedItems.push({
        id: item.id,
        statement: {
          id: statement.id,
          version: statement.version,
          status: statement.status,
          verificationStatus: statement.verificationStatus,
          sourceType: statement.sourceType,
          sourceActorId: statement.sourceActorId,
          verifiedByActorId: statement.verifiedByActorId,
          verifiedAt: statement.verifiedAt,
          updatedAt: statement.updatedAt,
          data: stored.payload,
        },
        prescription: order
          ? {
              id: order.id,
              status: order.status,
              providerId: order.providerId,
              signedAt: order.signedAt,
              createdAt: order.createdAt,
            }
          : null,
        outcome: item.outcome,
        resolutionStatus: item.resolutionStatus,
        reason,
      });
    }

    return {
      id: row.id,
      patientId: row.patientId,
      providerId: row.providerId,
      version: row.version,
      supersedesId: row.supersedesId,
      status: row.status,
      createdAt: row.createdAt,
      signedAt: row.signedAt,
      lastProfessional: {
        providerId: row.providerId,
        displayName: provider?.displayName ?? null,
        actorId: row.createdByActorId,
        at: row.signedAt ?? row.createdAt,
      },
      attestation: {
        legacy: row.items.length === 0,
        verified: attestationVerified,
        algorithm: row.signatureAlgorithm,
        keyId: row.signatureKeyId,
        payloadDigest: row.payloadDigest,
      },
      items: presentedItems,
    };
  }

  private normalizeItems(raw: SignedMedicationReconciliationInput) {
    const source = Array.isArray(raw?.items)
      ? raw.items
      : Array.isArray(raw?.entryIds)
        ? raw.entryIds.map((statementEntryId) => ({
            statementEntryId,
            outcome: "MATCHED",
            resolutionStatus: "RESOLVED",
          }))
        : null;
    if (!source || source.length < 1 || source.length > MAX_ITEMS) {
      throw new BadRequestException(`items must contain between 1 and ${MAX_ITEMS} medication statements.`);
    }

    const seen = new Set<string>();
    return source.map((rawItem, index) => {
      if (!rawItem || typeof rawItem !== "object") throw new BadRequestException(`items[${index}] is invalid.`);
      const statementEntryId = this.id(rawItem.statementEntryId, `items[${index}].statementEntryId`);
      if (seen.has(statementEntryId)) throw new BadRequestException("Medication statements cannot be duplicated in a reconciliation.");
      seen.add(statementEntryId);

      const prescriptionOrderId = rawItem.prescriptionOrderId == null || rawItem.prescriptionOrderId === ""
        ? null
        : this.id(rawItem.prescriptionOrderId, `items[${index}].prescriptionOrderId`);
      const outcome = String(rawItem.outcome ?? "").trim().toUpperCase();
      if (!OUTCOMES.has(outcome)) throw new BadRequestException(`items[${index}].outcome is invalid.`);
      const fallbackResolution = outcome === "MATCHED" ? "RESOLVED" : "OPEN";
      const resolutionStatus = String(rawItem.resolutionStatus ?? fallbackResolution).trim().toUpperCase();
      if (!RESOLUTION_STATUSES.has(resolutionStatus)) {
        throw new BadRequestException(`items[${index}].resolutionStatus is invalid.`);
      }
      if (outcome === "MATCHED" && resolutionStatus !== "RESOLVED") {
        throw new BadRequestException("MATCHED medication items must be RESOLVED.");
      }
      const reason = rawItem.reason == null || rawItem.reason === ""
        ? null
        : this.text(rawItem.reason, 2000, `items[${index}].reason`);
      return {
        statementEntryId,
        prescriptionOrderId,
        outcome: outcome as Outcome,
        resolutionStatus: resolutionStatus as ResolutionStatus,
        reason,
      };
    });
  }

  private async requireDoctor(principal: AuthPrincipal) {
    if (principal.role !== "DOCTOR") throw new ForbiddenException("Medication reconciliation requires DOCTOR role.");
    const provider = await this.prisma.provider.findUnique({
      where: { userId: principal.accountId },
      select: { id: true, status: true, class: true },
    });
    if (!provider || provider.status !== "ACTIVE" || provider.class !== "DOCTOR") {
      throw new ForbiddenException("An active Doctor provider profile is required.");
    }
    return provider;
  }

  private async requireDoctorAccess(principal: AuthPrincipal, patientId: string, action: "READ" | "WRITE") {
    const provider = await this.requireDoctor(principal);
    const patient = await this.prisma.patientProfile.findUnique({ where: { id: patientId }, select: { id: true } });
    if (!patient) throw new NotFoundException("Patient not found.");
    const now = new Date();
    const from = new Date(now.getTime() - TREATMENT_LOOKBACK_DAYS * 86400000);
    const to = new Date(now.getTime() + TREATMENT_LOOKAHEAD_DAYS * 86400000);
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
      throw new ForbiddenException("Medication reconciliation access denied.");
    }
    return { providerId: provider.id, basis: action === "WRITE" ? "TREATMENT_RELATIONSHIP" : decision.basis };
  }

  private async requirePatient(principal: AuthPrincipal) {
    if (principal.role !== "PATIENT") throw new ForbiddenException("Patient reconciliation access requires PATIENT role.");
    const patient = await this.prisma.patientProfile.findUnique({
      where: { userId: principal.accountId },
      select: { id: true },
    });
    if (!patient) throw new NotFoundException("Patient profile not found.");
    return patient;
  }

  private attestationMaterial(input: {
    patientId: string;
    providerId: string;
    version: number;
    supersedesId: string | null;
    status: string;
    items: Array<{
      statementEntryId: string;
      prescriptionOrderId: string | null;
      outcome: Outcome;
      resolutionStatus: ResolutionStatus;
      envelope: EncryptedEnvelope;
    }>;
  }) {
    return {
      domain: "MEDICATION_RECONCILIATION",
      schemaVersion: 1,
      patientId: input.patientId,
      providerId: input.providerId,
      version: input.version,
      supersedesId: input.supersedesId,
      status: input.status,
      items: [...input.items]
        .sort((a, b) =>
          a.statementEntryId.localeCompare(b.statementEntryId) ||
          (a.prescriptionOrderId ?? "").localeCompare(b.prescriptionOrderId ?? ""),
        )
        .map((item) => ({
          statementEntryId: item.statementEntryId,
          prescriptionOrderId: item.prescriptionOrderId,
          outcome: item.outcome,
          resolutionStatus: item.resolutionStatus,
          reasonEnvelope: item.envelope,
        })),
    };
  }

  private itemEnvelope(item: PersistedItem): EncryptedEnvelope {
    if (item.algorithm !== "AES-256-GCM") throw new ConflictException("Unsupported reconciliation reason encryption.");
    return {
      version: 1,
      algorithm: "AES-256-GCM",
      keyId: item.keyId,
      wrappedKey: item.wrappedKey,
      iv: item.iv,
      ciphertext: item.ciphertext,
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

  private jsonStringArray(value: unknown) {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === "string");
  }

  private id(value: unknown, field: string) {
    if (typeof value !== "string") throw new BadRequestException(`${field} is required.`);
    const normalized = value.trim();
    if (!/^[A-Za-z0-9_.:-]{1,180}$/.test(normalized)) throw new BadRequestException(`${field} is invalid.`);
    return normalized;
  }

  private text(value: unknown, max: number, field: string) {
    if (typeof value !== "string") throw new BadRequestException(`${field} must be text.`);
    const normalized = value.trim();
    if (!normalized || normalized.length > max || /\p{Cc}/u.test(normalized)) {
      throw new BadRequestException(`${field} is invalid.`);
    }
    return normalized;
  }
}
