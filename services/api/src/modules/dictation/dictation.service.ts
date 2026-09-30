import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import type { EncryptedEnvelope } from "@carepoint/security";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { ClinicalEnvelopeService } from "../clinical/clinical-envelope.service";

const DRAFT_TTL_MINUTES = 30;
const SOURCE = "DEVICE_SPEECH_RECOGNITION";
const TARGET_LIMITS = new Map<string, number>([
  ["CHIEF_COMPLAINT", 2000],
  ["SUBJECTIVE", 20000],
  ["OBJECTIVE", 20000],
  ["ASSESSMENT", 20000],
  ["PLAN", 20000],
]);
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,180}$/;
const IDEMPOTENCY = /^[A-Za-z0-9_.:-]{8,128}$/;

type DictationPayload = {
  schemaVersion: 1;
  transcript: string;
  targetField: string;
  locale: string | null;
  source: typeof SOURCE;
  automatedClinicalInference: false;
};

export interface CreateDictationJobInput {
  appointmentId?: unknown;
  targetField?: unknown;
  transcript?: unknown;
  locale?: unknown;
  idempotencyKey?: unknown;
  deviceSpeechDisclosureAccepted?: unknown;
}

@Injectable()
export class DictationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly envelope: ClinicalEnvelopeService,
    private readonly audit: DatabaseAuditService,
  ) {}

  async create(principal: AuthPrincipal, input: CreateDictationJobInput) {
    const provider = await this.requireDoctor(principal);
    if (input?.deviceSpeechDisclosureAccepted !== true) {
      throw new BadRequestException("Device speech-processing disclosure must be acknowledged.");
    }
    const appointmentId = this.id(input?.appointmentId, "appointmentId");
    const targetField = this.targetField(input?.targetField);
    const transcript = this.transcript(input?.transcript, targetField);
    const locale = this.locale(input?.locale);
    const idempotencyKey = this.idempotency(input?.idempotencyKey);
    const appointment = await this.prisma.appointment.findFirst({
      where: {
        id: appointmentId,
        providerId: provider.id,
        status: "CONFIRMED",
      },
      select: { id: true, patientId: true, status: true },
    });
    if (!appointment) {
      throw new ForbiddenException("Dictation requires this Doctor's confirmed, non-finalized appointment.");
    }

    const existing = await this.prisma.dictationJob.findUnique({ where: { idempotencyKey } });
    if (existing) {
      if (
        existing.providerId !== provider.id ||
        existing.patientId !== appointment.patientId ||
        existing.appointmentId !== appointment.id ||
        existing.targetField !== targetField
      ) {
        throw new ConflictException("idempotencyKey is bound to another dictation draft.");
      }
      const payload = await this.decrypt(existing);
      if (payload.transcript !== transcript || payload.locale !== locale) {
        throw new ConflictException("idempotencyKey was reused with different dictation text.");
      }
      return this.present(existing, true);
    }

    const payload: DictationPayload = {
      schemaVersion: 1,
      transcript,
      targetField,
      locale,
      source: SOURCE,
      automatedClinicalInference: false,
    };
    const encrypted = await this.envelope.encryptRecord(payload);
    const expiresAt = new Date(Date.now() + DRAFT_TTL_MINUTES * 60_000);
    const job = await this.prisma.dictationJob.create({
      data: {
        idempotencyKey,
        providerId: provider.id,
        patientId: appointment.patientId,
        appointmentId: appointment.id,
        targetField,
        status: "DRAFT",
        source: SOURCE,
        locale,
        expiresAt,
        createdByActorId: principal.accountId,
        ...this.envelopeData(encrypted),
      },
    });
    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "CLINICAL_DICTATION_DRAFT_CREATED",
      objectType: "DICTATION_JOB",
      objectId: job.id,
      purpose: "TREATMENT",
      result: "SUCCESS",
      metadata: {
        providerId: provider.id,
        patientId: appointment.patientId,
        appointmentId: appointment.id,
        targetField,
        source: SOURCE,
        audioStored: false,
        clinicalRecordWritten: false,
        automatedClinicalInference: false,
      },
    });
    return this.present(job, false);
  }

  async confirm(principal: AuthPrincipal, jobIdRaw: string) {
    const provider = await this.requireDoctor(principal);
    const jobId = this.id(jobIdRaw, "jobId");
    const job = await this.prisma.dictationJob.findUnique({ where: { id: jobId } });
    if (!job || job.providerId !== provider.id || job.createdByActorId !== principal.accountId) {
      throw new NotFoundException("Dictation draft not found.");
    }
    await this.requireCurrentAppointment(provider.id, job.appointmentId, job.patientId);

    if (job.status === "CONFIRMED") {
      const payload = await this.decrypt(job);
      return this.confirmed(job, payload.transcript, true);
    }
    if (job.status !== "DRAFT") throw new ConflictException("Only a DRAFT dictation can be confirmed.");
    if (job.expiresAt.getTime() <= Date.now()) {
      await this.prisma.dictationJob.updateMany({
        where: { id: job.id, status: "DRAFT" },
        data: { status: "EXPIRED" },
      });
      await this.auditState(principal, job, "CLINICAL_DICTATION_DRAFT_EXPIRED", "EXPIRED");
      throw new ConflictException("Dictation draft expired before confirmation.");
    }

    const payload = await this.decrypt(job);
    const confirmedAt = new Date();
    const changed = await this.prisma.dictationJob.updateMany({
      where: { id: job.id, status: "DRAFT" },
      data: { status: "CONFIRMED", confirmedAt },
    });
    if (changed.count !== 1) throw new ConflictException("Dictation draft changed concurrently.");
    await this.auditState(principal, job, "CLINICAL_DICTATION_DRAFT_CONFIRMED", "CONFIRMED");

    return this.confirmed({ ...job, status: "CONFIRMED", confirmedAt }, payload.transcript, false);
  }

  async discard(principal: AuthPrincipal, jobIdRaw: string) {
    const provider = await this.requireDoctor(principal);
    const jobId = this.id(jobIdRaw, "jobId");
    const job = await this.prisma.dictationJob.findUnique({ where: { id: jobId } });
    if (!job || job.providerId !== provider.id || job.createdByActorId !== principal.accountId) {
      throw new NotFoundException("Dictation draft not found.");
    }
    if (job.status === "DISCARDED") return { id: job.id, status: job.status, replay: true };
    if (job.status !== "DRAFT") throw new ConflictException("Only a DRAFT dictation can be discarded.");
    const discardedAt = new Date();
    const changed = await this.prisma.dictationJob.updateMany({
      where: { id: job.id, status: "DRAFT" },
      data: { status: "DISCARDED", discardedAt },
    });
    if (changed.count !== 1) throw new ConflictException("Dictation draft changed concurrently.");
    await this.auditState(principal, job, "CLINICAL_DICTATION_DRAFT_DISCARDED", "DISCARDED");
    return { id: job.id, status: "DISCARDED", replay: false };
  }

  private async requireCurrentAppointment(providerId: string, appointmentId: string, patientId: string) {
    const appointment = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, providerId, patientId, status: "CONFIRMED" },
      select: { id: true },
    });
    if (!appointment) {
      throw new ConflictException("The clinical appointment is no longer writable.");
    }
  }

  private async requireDoctor(principal: AuthPrincipal) {
    if (principal.role !== "DOCTOR") throw new ForbiddenException("Clinical dictation requires DOCTOR role.");
    const provider = await this.prisma.provider.findUnique({
      where: { userId: principal.accountId },
      select: { id: true, class: true, status: true },
    });
    if (!provider || provider.class !== "DOCTOR" || provider.status !== "ACTIVE") {
      throw new ForbiddenException("An active Doctor provider profile is required.");
    }
    return provider;
  }

  private async auditState(
    principal: AuthPrincipal,
    job: { id: string; providerId: string; patientId: string; appointmentId: string; targetField: string },
    action: string,
    status: string,
  ) {
    await this.audit.writeClinical({
      actorId: principal.accountId,
      action,
      objectType: "DICTATION_JOB",
      objectId: job.id,
      purpose: "TREATMENT",
      result: "SUCCESS",
      metadata: {
        providerId: job.providerId,
        patientId: job.patientId,
        appointmentId: job.appointmentId,
        targetField: job.targetField,
        status,
        source: SOURCE,
        audioStored: false,
        clinicalRecordWritten: false,
        automatedClinicalInference: false,
      },
    });
  }

  private confirmed(
    job: { id: string; targetField: string; status: string; expiresAt: Date; confirmedAt: Date | null },
    transcript: string,
    replay: boolean,
  ) {
    return {
      id: job.id,
      status: job.status,
      targetField: job.targetField,
      transcript,
      expiresAt: job.expiresAt.toISOString(),
      confirmedAt: job.confirmedAt?.toISOString() ?? null,
      replay,
      reviewedByHuman: true,
      clinicalRecordWritten: false,
      requiresSeparateClinicalSave: true,
      automatedClinicalInference: false,
    };
  }

  private present(
    job: { id: string; targetField: string; status: string; source: string; expiresAt: Date; createdAt: Date },
    replay: boolean,
  ) {
    return {
      id: job.id,
      status: job.status,
      targetField: job.targetField,
      source: job.source,
      expiresAt: job.expiresAt.toISOString(),
      createdAt: job.createdAt.toISOString(),
      replay,
      audioStored: false,
      clinicalRecordWritten: false,
      requiresHumanConfirmation: true,
      automatedClinicalInference: false,
    };
  }

  private async decrypt(row: {
    algorithm: string;
    keyId: string;
    wrappedKey: string;
    iv: string;
    ciphertext: string;
  }) {
    return this.envelope.decryptRecord<DictationPayload>(this.asEnvelope(row));
  }

  private asEnvelope(row: {
    algorithm: string;
    keyId: string;
    wrappedKey: string;
    iv: string;
    ciphertext: string;
  }): EncryptedEnvelope {
    if (row.algorithm !== "AES-256-GCM") throw new ConflictException("Unsupported dictation encryption algorithm.");
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

  private targetField(raw: unknown) {
    const value = String(raw ?? "").trim().toUpperCase();
    if (!TARGET_LIMITS.has(value)) throw new BadRequestException("targetField is not dictation-enabled.");
    return value;
  }

  private transcript(raw: unknown, targetField: string) {
    if (typeof raw !== "string") throw new BadRequestException("transcript is required.");
    const value = raw.trim();
    const max = TARGET_LIMITS.get(targetField)!;
    if (!value || value.length > max || /\u0000/.test(value)) {
      throw new BadRequestException(`transcript must contain 1-${max} characters.`);
    }
    return value;
  }

  private locale(raw: unknown) {
    if (raw == null || raw === "") return null;
    if (typeof raw !== "string") throw new BadRequestException("locale is invalid.");
    const value = raw.trim();
    if (!/^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})?$/.test(value)) {
      throw new BadRequestException("locale is invalid.");
    }
    return value;
  }

  private idempotency(raw: unknown) {
    if (typeof raw !== "string" || !IDEMPOTENCY.test(raw.trim())) {
      throw new BadRequestException("idempotencyKey is invalid.");
    }
    return raw.trim();
  }

  private id(raw: unknown, field: string) {
    if (typeof raw !== "string" || !SAFE_ID.test(raw.trim())) {
      throw new BadRequestException(`${field} is invalid.`);
    }
    return raw.trim();
  }
}
