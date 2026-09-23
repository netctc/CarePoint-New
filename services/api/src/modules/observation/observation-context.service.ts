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

type StoredObservationContext = {
  schemaVersion: 1;
  context: string | null;
  note: string | null;
};

export interface UpdateObservationContextInput {
  context?: string | null;
  note?: string | null;
  expectedSequence: number;
}

@Injectable()
export class ObservationContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly envelope: ClinicalEnvelopeService,
  ) {}

  async readMine(principal: AuthPrincipal, observationIdRaw: string) {
    const { patientId, observationId } = await this.requireOwnedObservation(principal, observationIdRaw);
    const rows = await this.prisma.observationContextRevision.findMany({
      where: { observationId },
      orderBy: { sequence: "asc" },
      take: 100,
    });
    const revisions = [];
    for (const row of rows) {
      revisions.push(await this.present(row));
    }
    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "OBSERVATION_CONTEXT_READ",
      objectType: "OBSERVATION",
      objectId: observationId,
      purpose: "PATIENT_ACCESS",
      result: "SUCCESS",
      metadata: {
        domain: "OBSERVATION",
        patientId,
        observationId,
        revisionCount: revisions.length,
        valueMutated: false,
        decision: "ALLOW",
      },
    });
    return {
      observationId,
      patientId,
      currentSequence: revisions.at(-1)?.sequence ?? 0,
      latest: revisions.at(-1) ?? null,
      revisions,
      valueMutated: false,
    };
  }

  async updateMine(
    principal: AuthPrincipal,
    observationIdRaw: string,
    input: UpdateObservationContextInput,
  ) {
    const patient = await this.requirePatient(principal);
    const observationId = this.identifier(observationIdRaw, "observationId");
    const expectedSequence = this.nonNegativeInteger(input?.expectedSequence, "expectedSequence");
    const context = this.optionalText(input?.context, "context", 1000);
    const note = this.optionalText(input?.note, "note", 4000);
    if (!context && !note) throw new BadRequestException("context or note is required.");

    const encrypted = await this.envelope.encryptRecord({
      schemaVersion: 1,
      context,
      note,
    } satisfies StoredObservationContext);

    const created = await this.prisma.$transaction(async (tx) => {
      await this.audit.reserveIntegrityChainForSerializableTransaction(tx);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "Observation" WHERE id = ${observationId} FOR UPDATE`);
      const observation = await tx.observation.findFirst({
        where: { id: observationId, patientId: patient.id },
        select: { id: true },
      });
      if (!observation) throw new NotFoundException("Observation not found.");

      const current = await tx.observationContextRevision.findFirst({
        where: { observationId },
        orderBy: { sequence: "desc" },
        select: { sequence: true },
      });
      const currentSequence = current?.sequence ?? 0;
      if (expectedSequence !== currentSequence) {
        throw new ConflictException("Observation context changed. Refresh and retry.");
      }

      const row = await tx.observationContextRevision.create({
        data: {
          observationId,
          sequence: currentSequence + 1,
          createdByActorId: principal.accountId,
          ...this.envelopeData(encrypted),
        },
      });
      await this.audit.writeClinicalInTransaction(tx, {
        actorId: principal.accountId,
        action: "OBSERVATION_CONTEXT_REVISED",
        objectType: "OBSERVATION",
        objectId: observationId,
        purpose: "PATIENT_ACCESS",
        result: "SUCCESS",
        metadata: {
          domain: "OBSERVATION",
          patientId: patient.id,
          observationId,
          contextSequence: row.sequence,
          hasContext: Boolean(context),
          hasNote: Boolean(note),
          valueMutated: false,
          decision: "ALLOW",
        },
      });
      return row;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return {
      observationId,
      patientId: patient.id,
      currentSequence: created.sequence,
      latest: await this.present(created),
      valueMutated: false,
    };
  }

  private async requireOwnedObservation(principal: AuthPrincipal, observationIdRaw: string) {
    const patient = await this.requirePatient(principal);
    const observationId = this.identifier(observationIdRaw, "observationId");
    const observation = await this.prisma.observation.findFirst({
      where: { id: observationId, patientId: patient.id },
      select: { id: true },
    });
    if (!observation) throw new NotFoundException("Observation not found.");
    return { patientId: patient.id, observationId };
  }

  private async requirePatient(principal: AuthPrincipal) {
    if (principal.role !== "PATIENT") throw new ForbiddenException("Observation context requires PATIENT role.");
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
    const payload = await this.envelope.decryptRecord<StoredObservationContext>({
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
      context: payload.context,
      note: payload.note,
      createdAt: row.createdAt,
      createdByActorId: row.createdByActorId,
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

  private optionalText(value: unknown, field: string, maxLength: number) {
    if (value === undefined || value === null) return null;
    if (typeof value !== "string") throw new BadRequestException(`${field} must be text.`);
    const normalized = value.trim();
    if (!normalized) return null;
    if (normalized.length > maxLength || normalized.includes("\u0000")) {
      throw new BadRequestException(`${field} is invalid.`);
    }
    return normalized;
  }

  private nonNegativeInteger(value: unknown, field: string) {
    if (!Number.isInteger(value) || Number(value) < 0) {
      throw new BadRequestException(`${field} must be a non-negative integer.`);
    }
    return Number(value);
  }

  private identifier(value: unknown, field: string) {
    if (typeof value !== "string") throw new BadRequestException(`${field} is required.`);
    const normalized = value.trim();
    if (!/^[A-Za-z0-9_.:-]{1,180}$/.test(normalized)) throw new BadRequestException(`${field} is invalid.`);
    return normalized;
  }
}
