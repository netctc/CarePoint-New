import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { ClinicalRecord, Prisma } from "@prisma/client";
import type { EncryptedEnvelope } from "@carepoint/security";
import type { AuthPrincipal } from "@carepoint/identity";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { ClinicalEnvelopeService } from "./clinical-envelope.service";

const CLINICAL_SCOPE = "CLINICAL_RECORD_READ";
const CLINICAL_CONSENT_VERSION = "clinical-record-v1";
const MAX_RECORD_BYTES = 128 * 1024;
const TREATMENT_LOOKBACK_DAYS = 365;
const TREATMENT_LOOKAHEAD_DAYS = 30;

type AccessBasis = "PATIENT_SELF" | "OWN_AUTHORSHIP" | "TREATMENT_RELATIONSHIP" | "PATIENT_CONSENT";

interface ClinicalRecordInput {
  chiefComplaint?: string;
  subjective?: string;
  objective?: string;
  assessment?: string;
  plan?: string;
  vitals?: Record<string, number | string | null>;
  diagnoses?: Array<{ codeSystem?: string; code?: string; display: string; status?: string }>;
  treatments?: string[];
  medications?: Array<{ name: string; dose?: string; route?: string; frequency?: string; duration?: string }>;
  attachments?: Array<{ documentId: string; name: string; mimeType?: string; kind?: string }>;
}

interface StoredClinicalPayload extends ClinicalRecordInput {
  schemaVersion: 1;
  revision: number;
  authoredAt: string;
}

@Injectable()
export class ClinicalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly envelope: ClinicalEnvelopeService,
  ) {}

  async writeRecord(principal: AuthPrincipal, appointmentId: string, input: ClinicalRecordInput) {
    const provider = await this.requireActiveProvider(principal);
    const appointment = await this.requireAppointment(appointmentId);
    if (appointment.providerId !== provider.id) throw new ForbiddenException("Only the appointment provider can author this encounter.");
    if (appointment.status === "COMPLETED") throw new ConflictException("A finalized clinical encounter is immutable.");
    if (appointment.status !== "CONFIRMED") throw new ConflictException("Clinical documentation requires a confirmed appointment.");

    const cleaned = this.validateInput(input);
    const revision = (await this.prisma.clinicalRecord.count({ where: { encounterRef: appointment.id } })) + 1;
    const payload: StoredClinicalPayload = {
      ...cleaned,
      schemaVersion: 1,
      revision,
      authoredAt: new Date().toISOString(),
    };
    const encrypted = await this.envelope.encryptRecord(payload);
    const record = await this.prisma.clinicalRecord.create({
      data: {
        patientId: appointment.patientId,
        providerId: provider.id,
        encounterRef: appointment.id,
        algorithm: encrypted.algorithm,
        keyId: encrypted.keyId,
        wrappedKey: encrypted.wrappedKey,
        iv: encrypted.iv,
        ciphertext: encrypted.ciphertext,
      },
    });
    await this.audit.write({
      actorId: principal.accountId,
      action: "CLINICAL_RECORD_WRITTEN",
      objectType: "CLINICAL_RECORD",
      objectId: record.id,
      purpose: "TREATMENT",
      result: "SUCCESS",
      metadata: { appointmentId: appointment.id, revision },
    });
    return { id: record.id, appointmentId: appointment.id, revision, createdAt: record.createdAt, data: payload };
  }

  async getEncounter(principal: AuthPrincipal, appointmentId: string) {
    const appointment = await this.requireAppointment(appointmentId);
    const basis = await this.accessBasisForAppointment(principal, appointment);
    if (!basis) {
      await this.audit.write({ actorId: principal.accountId, action: "CLINICAL_RECORD_READ_DENIED", objectType: "APPOINTMENT", objectId: appointment.id, purpose: "TREATMENT", result: "DENIED" });
      throw new ForbiddenException("Clinical record access denied.");
    }
    const record = await this.prisma.clinicalRecord.findFirst({ where: { encounterRef: appointment.id }, orderBy: { createdAt: "desc" } });
    const latestRecord = record ? await this.presentRecord(record) : null;
    await this.audit.write({ actorId: principal.accountId, action: "CLINICAL_RECORD_READ", objectType: "APPOINTMENT", objectId: appointment.id, purpose: "TREATMENT", result: "SUCCESS", metadata: { basis } });
    return this.presentEncounter(appointment, latestRecord, basis);
  }

  async patientTimeline(principal: AuthPrincipal) {
    if (principal.role !== "PATIENT") throw new ForbiddenException("Patient clinical timeline access requires a patient account.");
    const patient = await this.requirePatient(principal);
    const result = await this.timelineForPatient(patient.id, undefined);
    await this.audit.write({ actorId: principal.accountId, action: "CLINICAL_TIMELINE_READ", objectType: "PATIENT", objectId: patient.id, purpose: "PATIENT_ACCESS", result: "SUCCESS", metadata: { basis: "PATIENT_SELF", itemCount: result.length } });
    return { patientId: patient.id, accessBasis: "PATIENT_SELF" as const, items: result };
  }

  async providerPatientTimeline(principal: AuthPrincipal, patientId: string) {
    const provider = await this.requireActiveProvider(principal);
    const patient = await this.prisma.patientProfile.findUnique({ where: { id: patientId }, select: { id: true } });
    if (!patient) throw new NotFoundException("Patient not found.");
    const basis = await this.providerPatientAccessBasis(provider.id, patient.id);
    if (!basis) {
      await this.audit.write({ actorId: principal.accountId, action: "CLINICAL_TIMELINE_READ_DENIED", objectType: "PATIENT", objectId: patient.id, purpose: "TREATMENT", result: "DENIED" });
      throw new ForbiddenException("No clinical record access basis exists for this patient.");
    }
    const providerFilter = basis === "OWN_AUTHORSHIP" ? provider.id : undefined;
    const items = await this.timelineForPatient(patient.id, providerFilter);
    await this.audit.write({ actorId: principal.accountId, action: "CLINICAL_TIMELINE_READ", objectType: "PATIENT", objectId: patient.id, purpose: "TREATMENT", result: "SUCCESS", metadata: { basis, itemCount: items.length } });
    return { patientId: patient.id, accessBasis: basis, items };
  }

  async finalizeEncounter(principal: AuthPrincipal, appointmentId: string) {
    const provider = await this.requireActiveProvider(principal);
    const appointment = await this.requireAppointment(appointmentId);
    if (appointment.providerId !== provider.id) throw new ForbiddenException("Only the appointment provider can finalize this encounter.");
    if (appointment.status === "COMPLETED") return this.getEncounter(principal, appointmentId);
    if (appointment.status !== "CONFIRMED") throw new ConflictException("Only a confirmed appointment can be finalized.");
    const record = await this.prisma.clinicalRecord.findFirst({ where: { encounterRef: appointment.id }, select: { id: true } });
    if (!record) throw new ConflictException("At least one encrypted clinical record revision is required before finalization.");

    await this.prisma.$transaction(async (tx) => {
      await tx.appointment.update({ where: { id: appointment.id }, data: { status: "COMPLETED" } });
      await tx.telehealthSession.updateMany({
        where: { appointmentId: appointment.id, status: { in: ["WAITING", "READY", "ACTIVE"] } },
        data: { status: "ENDED", endedAt: new Date() },
      });
    });
    await this.audit.write({ actorId: principal.accountId, action: "CLINICAL_ENCOUNTER_FINALIZED", objectType: "APPOINTMENT", objectId: appointment.id, purpose: "TREATMENT", result: "SUCCESS" });
    return this.getEncounter(principal, appointmentId);
  }

  private async timelineForPatient(patientId: string, providerId?: string) {
    const records = await this.prisma.clinicalRecord.findMany({
      where: { patientId, ...(providerId ? { providerId } : {}) },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    const latest = new Map<string, ClinicalRecord>();
    for (const record of records) {
      if (record.encounterRef && !latest.has(record.encounterRef)) latest.set(record.encounterRef, record);
    }
    const appointmentIds = [...latest.keys()];
    if (appointmentIds.length === 0) return [];
    const appointments = await this.prisma.appointment.findMany({
      where: { id: { in: appointmentIds } },
      include: {
        provider: { select: { id: true, class: true, displayName: true } },
        service: { select: { id: true, name: true, labels: true } },
      },
      orderBy: { startsAt: "desc" },
    });
    const result = [];
    for (const appointment of appointments) {
      const record = latest.get(appointment.id);
      if (!record) continue;
      result.push(this.presentEncounter(appointment, await this.presentRecord(record), providerId ? "OWN_AUTHORSHIP" : "PATIENT_SELF"));
    }
    return result;
  }

  private async accessBasisForAppointment(principal: AuthPrincipal, appointment: Awaited<ReturnType<ClinicalService["requireAppointment"]>>): Promise<AccessBasis | null> {
    if (principal.role === "PATIENT") {
      const patient = await this.requirePatient(principal);
      return patient.id === appointment.patientId ? "PATIENT_SELF" : null;
    }
    if (principal.role === "DOCTOR" || principal.role === "OTHER_PROVIDER") {
      const provider = await this.requireActiveProvider(principal);
      if (provider.id === appointment.providerId) return "OWN_AUTHORSHIP";
      return this.providerPatientAccessBasis(provider.id, appointment.patientId);
    }
    return null;
  }

  private async providerPatientAccessBasis(providerId: string, patientId: string): Promise<Exclude<AccessBasis, "PATIENT_SELF"> | null> {
    const now = new Date();
    const from = new Date(now.getTime() - TREATMENT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const to = new Date(now.getTime() + TREATMENT_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);
    const relationship = await this.prisma.appointment.findFirst({
      where: { providerId, patientId, status: { in: ["CONFIRMED", "COMPLETED"] }, startsAt: { gte: from, lte: to } },
      select: { id: true },
    });
    if (relationship) return "TREATMENT_RELATIONSHIP";
    const consent = await this.prisma.consent.findFirst({
      where: {
        patientId,
        scope: CLINICAL_SCOPE,
        state: "GRANTED",
        AND: [
          { OR: [{ providerId }, { providerId: null }] },
          { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        ],
      },
      select: { id: true, version: true },
      orderBy: { grantedAt: "desc" },
    });
    if (consent && consent.version === CLINICAL_CONSENT_VERSION) return "PATIENT_CONSENT";
    const own = await this.prisma.clinicalRecord.findFirst({ where: { providerId, patientId }, select: { id: true } });
    return own ? "OWN_AUTHORSHIP" : null;
  }

  private async requireAppointment(appointmentId: string) {
    if (!appointmentId?.trim()) throw new BadRequestException("appointmentId is required.");
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        patient: { select: { id: true, userId: true, firstName: true, lastName: true } },
        provider: { select: { id: true, userId: true, class: true, displayName: true, status: true } },
        service: { select: { id: true, name: true, labels: true } },
      },
    });
    if (!appointment) throw new NotFoundException("Appointment not found.");
    return appointment;
  }

  private async requireActiveProvider(principal: AuthPrincipal) {
    if (principal.role !== "DOCTOR" && principal.role !== "OTHER_PROVIDER") throw new ForbiddenException("An active healthcare provider account is required.");
    const provider = await this.prisma.provider.findUnique({ where: { userId: principal.accountId }, select: { id: true, class: true, status: true } });
    if (!provider || provider.status !== "ACTIVE") throw new ForbiddenException("An active healthcare provider profile is required.");
    return provider;
  }

  private async requirePatient(principal: AuthPrincipal) {
    const patient = await this.prisma.patientProfile.findUnique({ where: { userId: principal.accountId }, select: { id: true } });
    if (!patient) throw new NotFoundException("Patient profile not found.");
    return patient;
  }

  private async presentRecord(record: ClinicalRecord) {
    const envelope = this.asEnvelope(record);
    const data = await this.envelope.decryptRecord<StoredClinicalPayload>(envelope);
    return { id: record.id, createdAt: record.createdAt, revision: data.revision, data };
  }

  private presentEncounter(appointment: any, latestRecord: any, basis: AccessBasis) {
    return {
      appointment: {
        id: appointment.id,
        modality: appointment.modality,
        status: appointment.status,
        startsAt: appointment.startsAt,
        endsAt: appointment.endsAt,
        provider: appointment.provider,
        service: appointment.service,
      },
      accessBasis: basis,
      latestRecord,
      finalized: appointment.status === "COMPLETED",
    };
  }

  private asEnvelope(record: ClinicalRecord): EncryptedEnvelope {
    if (record.algorithm !== "AES-256-GCM") throw new ConflictException("Unsupported clinical record encryption algorithm.");
    return { version: 1, algorithm: "AES-256-GCM", keyId: record.keyId, wrappedKey: record.wrappedKey, iv: record.iv, ciphertext: record.ciphertext };
  }

  private validateInput(input: ClinicalRecordInput): ClinicalRecordInput {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new BadRequestException("Clinical record body must be an object.");
    const cleaned: ClinicalRecordInput = {
      chiefComplaint: this.optionalText(input.chiefComplaint, 2000),
      subjective: this.optionalText(input.subjective, 20000),
      objective: this.optionalText(input.objective, 20000),
      assessment: this.optionalText(input.assessment, 20000),
      plan: this.optionalText(input.plan, 20000),
      vitals: input.vitals ? this.validateVitals(input.vitals) : undefined,
      diagnoses: input.diagnoses ? this.validateDiagnoses(input.diagnoses) : undefined,
      treatments: input.treatments ? this.validateStringList(input.treatments, 50, 2000) : undefined,
      medications: input.medications ? this.validateMedications(input.medications) : undefined,
      attachments: input.attachments ? this.validateAttachments(input.attachments) : undefined,
    };
    const meaningful = Object.entries(cleaned).some(([, value]) => value !== undefined && (!(Array.isArray(value)) || value.length > 0));
    if (!meaningful) throw new BadRequestException("At least one clinical field is required.");
    const size = Buffer.byteLength(JSON.stringify(cleaned), "utf8");
    if (size > MAX_RECORD_BYTES) throw new BadRequestException("Clinical record payload is too large.");
    return cleaned;
  }

  private optionalText(value: unknown, max: number): string | undefined {
    if (value === undefined || value === null || value === "") return undefined;
    if (typeof value !== "string") throw new BadRequestException("Clinical text fields must be strings.");
    const text = value.trim();
    if (!text || text.length > max) throw new BadRequestException(`Clinical text fields must contain between 1 and ${max} characters.`);
    return text;
  }

  private validateVitals(value: Record<string, number | string | null>) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestException("vitals must be an object.");
    const allowed = new Set(["temperatureC", "heartRateBpm", "systolicMmHg", "diastolicMmHg", "respiratoryRate", "oxygenSaturationPct", "weightKg", "heightCm"]);
    const result: Record<string, number | string | null> = {};
    for (const [key, item] of Object.entries(value)) {
      if (!allowed.has(key)) throw new BadRequestException(`Unsupported vital sign: ${key}`);
      if (item !== null && typeof item !== "number" && typeof item !== "string") throw new BadRequestException(`Invalid vital sign value: ${key}`);
      result[key] = item;
    }
    return result;
  }

  private validateDiagnoses(value: ClinicalRecordInput["diagnoses"]) {
    if (!Array.isArray(value) || value.length > 50) throw new BadRequestException("diagnoses must contain at most 50 items.");
    return value.map((item) => {
      if (!item || typeof item.display !== "string" || !item.display.trim()) throw new BadRequestException("Each diagnosis requires display text.");
      return {
        ...(item.codeSystem ? { codeSystem: this.optionalText(item.codeSystem, 80) } : {}),
        ...(item.code ? { code: this.optionalText(item.code, 80) } : {}),
        display: this.optionalText(item.display, 300)!,
        ...(item.status ? { status: this.optionalText(item.status, 40) } : {}),
      };
    });
  }

  private validateStringList(value: unknown, maxItems: number, maxLength: number): string[] {
    if (!Array.isArray(value) || value.length > maxItems) throw new BadRequestException(`List must contain at most ${maxItems} items.`);
    return value.map((item) => {
      if (typeof item !== "string") throw new BadRequestException("List values must be strings.");
      return this.optionalText(item, maxLength)!;
    });
  }

  private validateMedications(value: ClinicalRecordInput["medications"]) {
    if (!Array.isArray(value) || value.length > 50) throw new BadRequestException("medications must contain at most 50 items.");
    return value.map((item) => {
      if (!item || typeof item.name !== "string" || !item.name.trim()) throw new BadRequestException("Each medication requires a name.");
      return {
        name: this.optionalText(item.name, 300)!,
        ...(item.dose ? { dose: this.optionalText(item.dose, 100) } : {}),
        ...(item.route ? { route: this.optionalText(item.route, 80) } : {}),
        ...(item.frequency ? { frequency: this.optionalText(item.frequency, 120) } : {}),
        ...(item.duration ? { duration: this.optionalText(item.duration, 120) } : {}),
      };
    });
  }

  private validateAttachments(value: ClinicalRecordInput["attachments"]) {
    if (!Array.isArray(value) || value.length > 20) throw new BadRequestException("attachments must contain at most 20 references.");
    return value.map((item) => {
      if (!item || typeof item.documentId !== "string" || typeof item.name !== "string") throw new BadRequestException("Each attachment requires documentId and name.");
      return {
        documentId: this.optionalText(item.documentId, 200)!,
        name: this.optionalText(item.name, 300)!,
        ...(item.mimeType ? { mimeType: this.optionalText(item.mimeType, 120) } : {}),
        ...(item.kind ? { kind: this.optionalText(item.kind, 80) } : {}),
      };
    });
  }
}
