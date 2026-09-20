import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, type EncounterAddendum } from "@prisma/client";
import type { EncryptedEnvelope } from "@carepoint/security";
import type { AuthPrincipal } from "@carepoint/identity";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { OrdersAttestationService } from "../orders/orders-attestation.service";
import { ClinicalEnvelopeService } from "./clinical-envelope.service";
import { normalizeEncounterAddendumInput, type EncounterAddendumInput } from "./encounter-addendum.engine";

type StoredAddendumPayload = EncounterAddendumInput & {
  schemaVersion: 1;
  authoredAt: string;
};

@Injectable()
export class EncounterAddendaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly envelope: ClinicalEnvelopeService,
    private readonly attestation: OrdersAttestationService,
  ) {}

  async create(principal: AuthPrincipal, encounterId: string, raw: Record<string, unknown>) {
    const provider = await this.requireActiveProvider(principal);
    const appointment = await this.requireAppointment(encounterId);
    if (appointment.providerId !== provider.id) {
      throw new ForbiddenException("Only the encounter provider can append an addendum.");
    }
    if (appointment.status !== "COMPLETED") {
      throw new ConflictException("Addenda can only be appended to finalized encounters.");
    }
    const original = await this.prisma.clinicalRecord.findFirst({
      where: { encounterRef: appointment.id },
      select: { id: true },
      orderBy: { createdAt: "desc" },
    });
    if (!original) throw new ConflictException("A finalized clinical record is required before adding an addendum.");

    const input = this.normalizedInput(raw);
    const payload: StoredAddendumPayload = {
      schemaVersion: 1,
      reason: input.reason,
      text: input.text,
      authoredAt: new Date().toISOString(),
    };
    const encrypted = await this.envelope.encryptRecord(payload);
    const material = this.attestationMaterial(appointment.id, appointment.patientId, provider.id, encrypted);
    const attestation = await this.attestation.attest(material);

    const created = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "Appointment" WHERE id = ${appointment.id} FOR UPDATE`);
      const locked = await tx.appointment.findUnique({
        where: { id: appointment.id },
        select: { id: true, patientId: true, providerId: true, status: true },
      });
      if (!locked) throw new NotFoundException("Encounter not found.");
      if (locked.providerId !== provider.id) throw new ForbiddenException("Encounter provider changed.");
      if (locked.patientId !== appointment.patientId) throw new ConflictException("Encounter patient changed.");
      if (locked.status !== "COMPLETED") throw new ConflictException("Encounter is no longer finalized.");

      const sequence = (await tx.encounterAddendum.count({ where: { encounterId: appointment.id } })) + 1;
      const addendum = await tx.encounterAddendum.create({
        data: {
          encounterId: appointment.id,
          patientId: appointment.patientId,
          providerId: provider.id,
          sequence,
          algorithm: encrypted.algorithm,
          keyId: encrypted.keyId,
          wrappedKey: encrypted.wrappedKey,
          iv: encrypted.iv,
          ciphertext: encrypted.ciphertext,
          payloadDigest: attestation.payloadDigest,
          signatureAlgorithm: attestation.algorithm,
          signatureKeyId: attestation.keyId,
          signature: attestation.signature,
          signedAt: attestation.signedAt,
        },
      });
      await this.audit.writeClinicalInTransaction(tx, {
        actorId: principal.accountId,
        action: "CLINICAL_ENCOUNTER_ADDENDUM_CREATED",
        objectType: "ENCOUNTER_ADDENDUM",
        objectId: addendum.id,
        purpose: "TREATMENT",
        result: "SUCCESS",
        metadata: {
          appointmentId: appointment.id,
          patientId: appointment.patientId,
          providerId: provider.id,
          sequence,
        },
      });
      return addendum;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return this.present(created);
  }

  async listForEncounter(encounterId: string) {
    const rows = await this.prisma.encounterAddendum.findMany({
      where: { encounterId },
      orderBy: { sequence: "asc" },
      take: 100,
    });
    return this.presentMany(rows);
  }

  async listForEncounters(encounterIds: string[]) {
    if (encounterIds.length === 0) return new Map<string, Awaited<ReturnType<EncounterAddendaService["present"]>>[]>();
    const rows = await this.prisma.encounterAddendum.findMany({
      where: { encounterId: { in: encounterIds } },
      orderBy: [{ encounterId: "asc" }, { sequence: "asc" }],
      take: Math.min(encounterIds.length * 100, 5000),
    });
    const result = new Map<string, Awaited<ReturnType<EncounterAddendaService["present"]>>[]>();
    for (const row of rows) {
      const value = await this.present(row);
      const bucket = result.get(row.encounterId) ?? [];
      bucket.push(value);
      result.set(row.encounterId, bucket);
    }
    return result;
  }

  private async presentMany(rows: EncounterAddendum[]) {
    const result = [];
    for (const row of rows) result.push(await this.present(row));
    return result;
  }

  private async present(addendum: EncounterAddendum) {
    const envelope = this.asEnvelope(addendum);
    const material = this.attestationMaterial(addendum.encounterId, addendum.patientId, addendum.providerId, envelope);
    const valid = await this.attestation.verify(material, {
      payloadDigest: addendum.payloadDigest,
      signature: addendum.signature,
      signedAt: addendum.signedAt,
      keyId: addendum.signatureKeyId,
      algorithm: addendum.signatureAlgorithm,
    });
    if (!valid) throw new ConflictException("Encounter addendum attestation verification failed.");
    const data = await this.envelope.decryptRecord<StoredAddendumPayload>(envelope);
    return {
      id: addendum.id,
      encounterId: addendum.encounterId,
      patientId: addendum.patientId,
      providerId: addendum.providerId,
      sequence: addendum.sequence,
      signedAt: addendum.signedAt,
      createdAt: addendum.createdAt,
      data,
      attestation: {
        algorithm: addendum.signatureAlgorithm,
        keyId: addendum.signatureKeyId,
        payloadDigest: addendum.payloadDigest,
      },
    };
  }

  private async requireActiveProvider(principal: AuthPrincipal) {
    if (principal.role !== "DOCTOR" && principal.role !== "OTHER_PROVIDER") {
      throw new ForbiddenException("An active healthcare provider account is required.");
    }
    const provider = await this.prisma.provider.findUnique({
      where: { userId: principal.accountId },
      select: { id: true, status: true },
    });
    if (!provider || provider.status !== "ACTIVE") {
      throw new ForbiddenException("An active healthcare provider profile is required.");
    }
    return provider;
  }

  private async requireAppointment(encounterId: string) {
    if (!encounterId?.trim()) throw new BadRequestException("encounterId is required.");
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: encounterId.trim() },
      select: { id: true, patientId: true, providerId: true, status: true },
    });
    if (!appointment) throw new NotFoundException("Encounter not found.");
    return appointment;
  }

  private normalizedInput(raw: Record<string, unknown>) {
    try {
      return normalizeEncounterAddendumInput(raw);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : "Invalid encounter addendum input.");
    }
  }

  private attestationMaterial(
    encounterId: string,
    patientId: string,
    providerId: string,
    envelope: EncryptedEnvelope,
  ) {
    return { type: "ENCOUNTER_ADDENDUM", encounterId, patientId, providerId, envelope };
  }

  private asEnvelope(addendum: EncounterAddendum): EncryptedEnvelope {
    if (addendum.algorithm !== "AES-256-GCM") {
      throw new ConflictException("Unsupported encounter addendum encryption algorithm.");
    }
    return {
      version: 1,
      algorithm: "AES-256-GCM",
      keyId: addendum.keyId,
      wrappedKey: addendum.wrappedKey,
      iv: addendum.iv,
      ciphertext: addendum.ciphertext,
    };
  }
}
