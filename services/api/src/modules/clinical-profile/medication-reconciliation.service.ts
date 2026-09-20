import {
  BadRequestException,
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
import { OrdersAttestationService } from "../orders/orders-attestation.service";
import { OrdersService } from "../orders/orders.service";

const PROFILE_READ_SCOPE = "CLINICAL_PROFILE_READ";
const PROFILE_WRITE_SCOPE = "CLINICAL_PROFILE_WRITE";
const PROFILE_CONSENT_VERSION = "clinical-profile-v1";
const TREATMENT_LOOKBACK_DAYS = 365;
const TREATMENT_LOOKAHEAD_DAYS = 30;
const OUTCOMES = new Set(["MATCHED", "CONTINUE", "SUSPEND", "DUPLICATE", "CORRECT"] as const);
const DISCREPANCY_STATES = new Set(["NONE", "OPEN", "RESOLVED"] as const);
const REASON_CODES = new Set([
  "PATIENT_NOT_TAKING",
  "DOSE_MISMATCH",
  "DUPLICATE_THERAPY",
  "NOT_IN_CAREPOINT",
  "ORDER_STOPPED",
  "OTHER",
] as const);

type MedicationOutcome = "MATCHED" | "CONTINUE" | "SUSPEND" | "DUPLICATE" | "CORRECT";
type DiscrepancyState = "NONE" | "OPEN" | "RESOLVED";
type ReasonCode = "PATIENT_NOT_TAKING" | "DOSE_MISMATCH" | "DUPLICATE_THERAPY" | "NOT_IN_CAREPOINT" | "ORDER_STOPPED" | "OTHER";

type ReconciliationItemInput = {
  medicationEntryId?: string;
  prescriptionOrderId?: string;
  outcome: MedicationOutcome | string;
  discrepancyState?: DiscrepancyState | string;
  reasonCode?: ReasonCode | string | null;
};

export interface CreateMedicationReconciliationInput {
  items: ReconciliationItemInput[];
  note?: string | null;
}

type StoredReconciliation = {
  schemaVersion: 1;
  note: string | null;
};

type NormalizedItem = {
  medicationEntryId: string | null;
  prescriptionOrderId: string | null;
  outcome: MedicationOutcome;
  discrepancyState: DiscrepancyState;
  reasonCode: ReasonCode | null;
};

@Injectable()
export class MedicationReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly envelope: ClinicalEnvelopeService,
    private readonly attestation: OrdersAttestationService,
    private readonly orders: OrdersService,
  ) {}

  async comparisonForDoctor(principal: AuthPrincipal, patientId: string) {
    const access = await this.requireDoctorAccess(principal, patientId, "READ");
    const [medications, orders, history] = await Promise.all([
      this.medications(patientId),
      this.orders.providerPatientOrders(principal, patientId),
      this.history(patientId),
    ]);
    const prescriptions = orders.items.filter((item) => item.type === "PRESCRIPTION");
    const unresolved = this.currentUnresolved(history);

    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "MEDICATION_RECONCILIATION_COMPARISON_READ",
      objectType: "PATIENT",
      objectId: patientId,
      purpose: "TREATMENT",
      result: "SUCCESS",
      metadata: {
        domain: "MEDICATION_RECONCILIATION",
        patientId,
        providerId: access.providerId,
        medicationCount: medications.length,
        prescriptionCount: prescriptions.length,
        unresolvedCount: unresolved.length,
        decision: "ALLOW",
      },
    });

    return {
      patientId,
      accessBasis: access.basis,
      medications,
      prescriptions,
      unresolvedDiscrepancies: unresolved,
      history: await Promise.all(history.slice(0, 20).map((row) => this.presentReconciliation(row))),
      automatedClinicalInference: false,
    };
  }

  async createForDoctor(principal: AuthPrincipal, patientId: string, input: CreateMedicationReconciliationInput) {
    const access = await this.requireDoctorAccess(principal, patientId, "WRITE");
    const items = this.normalizeItems(input?.items);
    const note = this.optionalText(input?.note, 2000, "note");
    await this.validateReferences(principal, patientId, items);

    const encrypted = await this.envelope.encryptRecord({ schemaVersion: 1, note } satisfies StoredReconciliation);
    const material = this.attestationMaterial(patientId, access.providerId, encrypted, items);
    const signature = await this.attestation.attest(material);
    const entryIds = [...new Set(items.flatMap((item) => item.medicationEntryId ? [item.medicationEntryId] : []))];

    const row = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "PatientProfile" WHERE id = ${patientId} FOR UPDATE`);
      const reconciliation = await tx.medicationReconciliation.create({
        data: {
          patientId,
          providerId: access.providerId,
          entryIds: entryIds as unknown as Prisma.InputJsonValue,
          status: "SIGNED",
          version: 1,
          createdByActorId: principal.accountId,
          ...this.envelopeData(encrypted),
          payloadDigest: signature.payloadDigest,
          signatureAlgorithm: signature.algorithm,
          signatureKeyId: signature.keyId,
          signature: signature.signature,
          signedAt: signature.signedAt,
          items: {
            create: items.map((item) => ({
              medicationEntryId: item.medicationEntryId,
              prescriptionOrderId: item.prescriptionOrderId,
              outcome: item.outcome,
              discrepancyState: item.discrepancyState,
              reasonCode: item.reasonCode,
            })),
          },
        },
        include: { items: true },
      });

      await this.audit.writeClinicalInTransaction(tx, {
        actorId: principal.accountId,
        action: "MEDICATION_RECONCILIATION_SIGNED",
        objectType: "MEDICATION_RECONCILIATION",
        objectId: reconciliation.id,
        purpose: "TREATMENT",
        result: "SUCCESS",
        metadata: {
          domain: "MEDICATION_RECONCILIATION",
          patientId,
          providerId: access.providerId,
          reconciliationId: reconciliation.id,
          itemCount: items.length,
          unresolvedCount: items.filter((item) => item.discrepancyState === "OPEN").length,
          decision: "ALLOW",
        },
      });
      return reconciliation;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return this.presentReconciliation(row);
  }

  async statusForPatient(principal: AuthPrincipal) {
    const patient = await this.requirePatient(principal);
    const [medications, history] = await Promise.all([
      this.medications(patient.id),
      this.history(patient.id),
    ]);
    const latestByMedication = new Map<string, ReturnType<typeof this.itemSummary>>();
    for (const reconciliation of history) {
      for (const item of reconciliation.items) {
        if (item.medicationEntryId && !latestByMedication.has(item.medicationEntryId)) {
          latestByMedication.set(item.medicationEntryId, this.itemSummary(reconciliation, item));
        }
      }
    }

    const items = medications.map((medication) => ({
      ...medication,
      reconciliation: latestByMedication.get(medication.id) ?? null,
    }));

    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "PATIENT_MEDICATION_RECONCILIATION_STATUS_READ",
      objectType: "PATIENT",
      objectId: patient.id,
      purpose: "PATIENT_ACCESS",
      result: "SUCCESS",
      metadata: {
        domain: "MEDICATION_RECONCILIATION",
        patientId: patient.id,
        medicationCount: items.length,
        decision: "ALLOW",
      },
    });

    return { patientId: patient.id, items };
  }

  private async validateReferences(principal: AuthPrincipal, patientId: string, items: NormalizedItem[]) {
    const medicationIds = [...new Set(items.flatMap((item) => item.medicationEntryId ? [item.medicationEntryId] : []))];
    const medicationRows = medicationIds.length === 0 ? [] : await this.prisma.clinicalProfileEntry.findMany({
      where: { id: { in: medicationIds }, patientId, kind: "MEDICATION" },
      select: { id: true },
    });
    if (medicationRows.length !== medicationIds.length) {
      throw new BadRequestException("Every medicationEntryId must reference this patient's medication list.");
    }

    const orderIds = [...new Set(items.flatMap((item) => item.prescriptionOrderId ? [item.prescriptionOrderId] : []))];
    if (orderIds.length > 0) {
      const orderView = await this.orders.providerPatientOrders(principal, patientId);
      const accessiblePrescriptionIds = new Set(
        orderView.items.filter((item) => item.type === "PRESCRIPTION").map((item) => item.id),
      );
      for (const orderId of orderIds) {
        if (!accessiblePrescriptionIds.has(orderId)) {
          throw new BadRequestException("Every prescriptionOrderId must reference an accessible CarePoint prescription for this patient.");
        }
      }
    }
  }

  private async medications(patientId: string) {
    const rows = await this.prisma.clinicalProfileEntry.findMany({
      where: { patientId, kind: "MEDICATION" },
      orderBy: { updatedAt: "desc" },
      take: 500,
    });
    const items = [];
    for (const row of rows) {
      const stored = await this.envelope.decryptRecord<{ schemaVersion: 1; payload: Record<string, unknown> }>({
        version: 1,
        algorithm: row.algorithm as "AES-256-GCM",
        keyId: row.keyId,
        wrappedKey: row.wrappedKey,
        iv: row.iv,
        ciphertext: row.ciphertext,
      });
      items.push({
        id: row.id,
        status: row.status,
        version: row.version,
        verificationStatus: row.verificationStatus,
        sourceType: row.sourceType,
        sourceActorId: row.sourceActorId,
        verifiedByActorId: row.verifiedByActorId,
        verifiedAt: row.verifiedAt,
        updatedAt: row.updatedAt,
        data: stored.payload,
      });
    }
    return items;
  }

  private async history(patientId: string) {
    return this.prisma.medicationReconciliation.findMany({
      where: { patientId },
      include: { items: { orderBy: { createdAt: "asc" } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }

  private currentUnresolved(history: Awaited<ReturnType<MedicationReconciliationService["history"]>>) {
    const latest = new Map<string, ReturnType<typeof this.itemSummary>>();
    for (const reconciliation of history) {
      for (const item of reconciliation.items) {
        const key = this.referenceKey(item.medicationEntryId, item.prescriptionOrderId);
        if (!latest.has(key)) latest.set(key, this.itemSummary(reconciliation, item));
      }
    }
    return [...latest.values()].filter((item) => item.discrepancyState === "OPEN");
  }

  private async presentReconciliation(row: Awaited<ReturnType<MedicationReconciliationService["history"]>>[number]) {
    const integrityValid = await this.verify(row);
    const note = await this.decryptNote(row);
    return {
      id: row.id,
      patientId: row.patientId,
      providerId: row.providerId,
      status: row.status,
      version: row.version,
      createdByActorId: row.createdByActorId,
      signedAt: row.signedAt,
      createdAt: row.createdAt,
      note,
      attestation: row.payloadDigest
        ? {
            algorithm: row.signatureAlgorithm,
            keyId: row.signatureKeyId,
            payloadDigest: row.payloadDigest,
            integrityValid,
          }
        : null,
      items: row.items.map((item) => this.itemSummary(row, item)),
    };
  }

  private itemSummary(
    reconciliation: { id: string; providerId: string; signedAt: Date | null; createdAt: Date },
    item: {
      id: string;
      medicationEntryId: string | null;
      prescriptionOrderId: string | null;
      outcome: string;
      discrepancyState: string;
      reasonCode: string | null;
      createdAt: Date;
    },
  ) {
    return {
      id: item.id,
      reconciliationId: reconciliation.id,
      medicationEntryId: item.medicationEntryId,
      prescriptionOrderId: item.prescriptionOrderId,
      outcome: item.outcome,
      discrepancyState: item.discrepancyState,
      reasonCode: item.reasonCode,
      providerId: reconciliation.providerId,
      reconciledAt: reconciliation.signedAt ?? reconciliation.createdAt,
    };
  }

  private async verify(row: Awaited<ReturnType<MedicationReconciliationService["history"]>>[number]) {
    if (!row.algorithm || !row.keyId || !row.wrappedKey || !row.iv || !row.ciphertext || !row.payloadDigest || !row.signature || !row.signedAt) {
      return null;
    }
    const envelope: EncryptedEnvelope = {
      version: 1,
      algorithm: row.algorithm as "AES-256-GCM",
      keyId: row.keyId,
      wrappedKey: row.wrappedKey,
      iv: row.iv,
      ciphertext: row.ciphertext,
    };
    const items = row.items.map((item) => ({
      medicationEntryId: item.medicationEntryId,
      prescriptionOrderId: item.prescriptionOrderId,
      outcome: item.outcome,
      discrepancyState: item.discrepancyState,
      reasonCode: item.reasonCode,
    }));
    return this.attestation.verify(
      this.attestationMaterial(row.patientId, row.providerId, envelope, items as NormalizedItem[]),
      {
        payloadDigest: row.payloadDigest,
        signature: row.signature,
        signedAt: row.signedAt,
        keyId: row.signatureKeyId,
        algorithm: row.signatureAlgorithm,
      },
    );
  }

  private async decryptNote(row: Awaited<ReturnType<MedicationReconciliationService["history"]>>[number]) {
    if (!row.algorithm || !row.keyId || !row.wrappedKey || !row.iv || !row.ciphertext) return null;
    const payload = await this.envelope.decryptRecord<StoredReconciliation>({
      version: 1,
      algorithm: row.algorithm as "AES-256-GCM",
      keyId: row.keyId,
      wrappedKey: row.wrappedKey,
      iv: row.iv,
      ciphertext: row.ciphertext,
    });
    return payload.note;
  }

  private attestationMaterial(patientId: string, providerId: string, envelope: EncryptedEnvelope, items: NormalizedItem[]) {
    return {
      domain: "MEDICATION_RECONCILIATION",
      patientId,
      providerId,
      envelope,
      items: items.map((item) => ({
        medicationEntryId: item.medicationEntryId,
        prescriptionOrderId: item.prescriptionOrderId,
        outcome: item.outcome,
        discrepancyState: item.discrepancyState,
        reasonCode: item.reasonCode,
      })),
    };
  }

  private normalizeItems(input: unknown): NormalizedItem[] {
    if (!Array.isArray(input) || input.length < 1 || input.length > 100) {
      throw new BadRequestException("items must contain between 1 and 100 reconciliation items.");
    }
    const seen = new Set<string>();
    return input.map((raw, index) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new BadRequestException(`items[${index}] must be an object.`);
      }
      const item = raw as ReconciliationItemInput;
      const medicationEntryId = item.medicationEntryId == null ? null : this.identifier(item.medicationEntryId, `items[${index}].medicationEntryId`);
      const prescriptionOrderId = item.prescriptionOrderId == null ? null : this.identifier(item.prescriptionOrderId, `items[${index}].prescriptionOrderId`);
      if (!medicationEntryId && !prescriptionOrderId) {
        throw new BadRequestException(`items[${index}] must reference a medication entry or prescription order.`);
      }
      const outcome = this.enumValue(item.outcome, OUTCOMES, `items[${index}].outcome`);
      const discrepancyState = this.enumValue(item.discrepancyState ?? "NONE", DISCREPANCY_STATES, `items[${index}].discrepancyState`);
      const reasonCode = item.reasonCode == null ? null : this.enumValue(item.reasonCode, REASON_CODES, `items[${index}].reasonCode`);
      const key = this.referenceKey(medicationEntryId, prescriptionOrderId);
      if (seen.has(key)) throw new BadRequestException("A reconciliation request cannot contain duplicate medication/prescription reference pairs.");
      seen.add(key);
      return { medicationEntryId, prescriptionOrderId, outcome, discrepancyState, reasonCode };
    });
  }

  private async requireDoctorAccess(principal: AuthPrincipal, patientId: string, action: "READ" | "WRITE") {
    if (principal.role !== "DOCTOR") throw new ForbiddenException("Medication reconciliation requires DOCTOR role.");
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
        action: `MEDICATION_RECONCILIATION_${action}_DENIED`,
        objectType: "PATIENT",
        objectId: patientId,
        purpose: "TREATMENT",
        result: "DENIED",
        metadata: { domain: "MEDICATION_RECONCILIATION", patientId, providerId: provider.id, decision: "DENY" },
      });
      throw new ForbiddenException("Medication reconciliation access denied.");
    }
    return { basis: action === "WRITE" ? "TREATMENT_RELATIONSHIP" : decision.basis, providerId: provider.id };
  }

  private async requirePatient(principal: AuthPrincipal) {
    if (principal.role !== "PATIENT") throw new ForbiddenException("Patient medication reconciliation status requires PATIENT role.");
    const patient = await this.prisma.patientProfile.findUnique({ where: { userId: principal.accountId }, select: { id: true } });
    if (!patient) throw new NotFoundException("Patient profile not found.");
    return patient;
  }

  private referenceKey(medicationEntryId: string | null, prescriptionOrderId: string | null) {
    return `${medicationEntryId ?? "-"}|${prescriptionOrderId ?? "-"}`;
  }

  private identifier(value: unknown, field: string) {
    if (typeof value !== "string") throw new BadRequestException(`${field} is required.`);
    const normalized = value.trim();
    if (!/^[A-Za-z0-9_.:-]{1,180}$/.test(normalized)) throw new BadRequestException(`${field} is invalid.`);
    return normalized;
  }

  private optionalText(value: unknown, max: number, field: string) {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string") throw new BadRequestException(`${field} must be text.`);
    const normalized = value.trim();
    if (!normalized || normalized.length > max || /\p{Cc}/u.test(normalized)) throw new BadRequestException(`${field} is invalid.`);
    return normalized;
  }

  private enumValue<T extends string>(value: unknown, allowed: ReadonlySet<T>, field: string): T {
    if (typeof value !== "string") throw new BadRequestException(`${field} is required.`);
    const normalized = value.trim().toUpperCase() as T;
    if (!allowed.has(normalized)) throw new BadRequestException(`${field} is invalid.`);
    return normalized;
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
