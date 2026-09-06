import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { ClinicalRecord } from "@prisma/client";
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
type ClinicalInput = Record<string, unknown>;
type StoredClinicalPayload = ClinicalInput & { schemaVersion: 1; revision: number; authoredAt: string };

@Injectable()
export class ClinicalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly envelope: ClinicalEnvelopeService,
  ) {}

  async writeRecord(principal: AuthPrincipal, appointmentId: string, input: ClinicalInput) {
    const provider = await this.requireActiveProvider(principal);
    const appointment = await this.requireAppointment(appointmentId);
    if (appointment.providerId !== provider.id) throw new ForbiddenException("Only the appointment provider can author this encounter.");
    if (appointment.status === "COMPLETED") throw new ConflictException("A finalized clinical encounter is immutable.");
    if (appointment.status !== "CONFIRMED") throw new ConflictException("Clinical documentation requires a confirmed appointment.");

    const cleaned = this.validateInput(input);
    const revision = (await this.prisma.clinicalRecord.count({ where: { encounterRef: appointment.id } })) + 1;
    const payload: StoredClinicalPayload = { ...cleaned, schemaVersion: 1, revision, authoredAt: new Date().toISOString() };
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
    const items = await this.timelineForPatient(patient.id);
    await this.audit.write({ actorId: principal.accountId, action: "CLINICAL_TIMELINE_READ", objectType: "PATIENT", objectId: patient.id, purpose: "PATIENT_ACCESS", result: "SUCCESS", metadata: { basis: "PATIENT_SELF", itemCount: items.length } });
    return { patientId: patient.id, accessBasis: "PATIENT_SELF" as const, items };
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
    const items = await this.timelineForPatient(patient.id, basis === "OWN_AUTHORSHIP" ? provider.id : undefined);
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
    const records = await this.prisma.clinicalRecord.findMany({ where: { patientId, ...(providerId ? { providerId } : {}) }, orderBy: { createdAt: "desc" }, take: 500 });
    const latest = new Map<string, ClinicalRecord>();
    for (const record of records) if (record.encounterRef && !latest.has(record.encounterRef)) latest.set(record.encounterRef, record);
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
      if (record) result.push(this.presentEncounter(appointment, await this.presentRecord(record), providerId ? "OWN_AUTHORSHIP" : "PATIENT_SELF"));
    }
    return result;
  }

  private async accessBasisForAppointment(principal: AuthPrincipal, appointment: any): Promise<AccessBasis | null> {
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
    const relationship = await this.prisma.appointment.findFirst({ where: { providerId, patientId, status: { in: ["CONFIRMED", "COMPLETED"] }, startsAt: { gte: from, lte: to } }, select: { id: true } });
    if (relationship) return "TREATMENT_RELATIONSHIP";
    const consent = await this.prisma.consent.findFirst({
      where: {
        patientId,
        scope: CLINICAL_SCOPE,
        state: "GRANTED",
        AND: [{ OR: [{ providerId }, { providerId: null }] }, { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }],
      },
      select: { id: true, version: true },
      orderBy: { grantedAt: "desc" },
    });
    if (consent?.version === CLINICAL_CONSENT_VERSION) return "PATIENT_CONSENT";
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
    const data = await this.envelope.decryptRecord<StoredClinicalPayload>(this.asEnvelope(record));
    return { id: record.id, createdAt: record.createdAt, revision: data.revision, data };
  }

  private presentEncounter(appointment: any, latestRecord: any, basis: AccessBasis) {
    return {
      appointment: { id: appointment.id, modality: appointment.modality, status: appointment.status, startsAt: appointment.startsAt, endsAt: appointment.endsAt, provider: appointment.provider, service: appointment.service },
      accessBasis: basis,
      latestRecord,
      finalized: appointment.status === "COMPLETED",
    };
  }

  private asEnvelope(record: ClinicalRecord): EncryptedEnvelope {
    if (record.algorithm !== "AES-256-GCM") throw new ConflictException("Unsupported clinical record encryption algorithm.");
    return { version: 1, algorithm: "AES-256-GCM", keyId: record.keyId, wrappedKey: record.wrappedKey, iv: record.iv, ciphertext: record.ciphertext };
  }

  private validateInput(input: ClinicalInput): ClinicalInput {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new BadRequestException("Clinical record body must be an object.");
    const cleaned: ClinicalInput = {};
    for (const [key, max] of Object.entries({ chiefComplaint: 2000, subjective: 20000, objective: 20000, assessment: 20000, plan: 20000 })) {
      const value = input[key];
      if (value !== undefined && value !== null && value !== "") cleaned[key] = this.requiredText(value, max);
    }
    if (input.vitals !== undefined) cleaned.vitals = this.validateVitals(input.vitals);
    if (input.diagnoses !== undefined) cleaned.diagnoses = this.validateObjectList(input.diagnoses, 50, "diagnosis", ["codeSystem", "code", "display", "status"], ["display"]);
    if (input.treatments !== undefined) cleaned.treatments = this.validateStringList(input.treatments, 50, 2000);
    if (input.medications !== undefined) cleaned.medications = this.validateObjectList(input.medications, 50, "medication", ["name", "dose", "route", "frequency", "duration"], ["name"]);
    if (input.attachments !== undefined) cleaned.attachments = this.validateObjectList(input.attachments, 20, "attachment", ["documentId", "name", "mimeType", "kind"], ["documentId", "name"]);
    if (Object.keys(cleaned).length === 0) throw new BadRequestException("At least one clinical field is required.");
    if (Buffer.byteLength(JSON.stringify(cleaned), "utf8") > MAX_RECORD_BYTES) throw new BadRequestException("Clinical record payload is too large.");
    return cleaned;
  }

  private requiredText(value: unknown, max: number): string {
    if (typeof value !== "string") throw new BadRequestException("Clinical text values must be strings.");
    const text = value.trim();
    if (!text || text.length > max) throw new BadRequestException(`Clinical text must contain between 1 and ${max} characters.`);
    return text;
  }

  private validateVitals(value: unknown): Record<string, number | string | null> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestException("vitals must be an object.");
    const allowed = new Set(["temperatureC", "heartRateBpm", "systolicMmHg", "diastolicMmHg", "respiratoryRate", "oxygenSaturationPct", "weightKg", "heightCm"]);
    const result: Record<string, number | string | null> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (!allowed.has(key)) throw new BadRequestException(`Unsupported vital sign: ${key}`);
      if (item !== null && typeof item !== "number" && typeof item !== "string") throw new BadRequestException(`Invalid vital sign value: ${key}`);
      result[key] = item as number | string | null;
    }
    return result;
  }

  private validateStringList(value: unknown, maxItems: number, maxLength: number): string[] {
    if (!Array.isArray(value) || value.length > maxItems) throw new BadRequestException(`List must contain at most ${maxItems} items.`);
    return value.map((item) => this.requiredText(item, maxLength));
  }

  private validateObjectList(value: unknown, maxItems: number, label: string, allowed: string[], required: string[]): Array<Record<string, string>> {
    if (!Array.isArray(value) || value.length > maxItems) throw new BadRequestException(`${label} list must contain at most ${maxItems} items.`);
    return value.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw new BadRequestException(`Each ${label} must be an object.`);
      const source = item as Record<string, unknown>;
      const result: Record<string, string> = {};
      for (const key of allowed) {
        if (source[key] !== undefined && source[key] !== null && source[key] !== "") result[key] = this.requiredText(source[key], key === "display" || key === "name" ? 300 : 200);
      }
      for (const key of required) if (!result[key]) throw new BadRequestException(`Each ${label} requires ${key}.`);
      return result;
    });
  }
}
