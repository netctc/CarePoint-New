import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { AuthPrincipal } from "@carepoint/identity";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { isMfaAssuredSessionId } from "../../security/privileged-mfa-policy";
import { OrdersAttestationService } from "../orders/orders-attestation.service";

const POLICY_VERSION = "DOCTOR_ENCOUNTER_SIGNATURE_V1";

@Injectable()
export class ClinicalSignatureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly attestation: OrdersAttestationService,
  ) {}

  async sign(principal: AuthPrincipal, encounterIdInput: string) {
    if (principal.role !== "DOCTOR") {
      throw new ForbiddenException("Clinical encounter signatures require DOCTOR role.");
    }
    if (!isMfaAssuredSessionId(principal.sessionId)) {
      throw new ForbiddenException("A current MFA-assured session is required to sign a clinical encounter.");
    }
    const encounterId = this.identifier(encounterIdInput, "encounterId");
    const provider = await this.prisma.provider.findUnique({
      where: { userId: principal.accountId },
      select: { id: true, class: true, status: true },
    });
    if (!provider || provider.status !== "ACTIVE" || provider.class !== "DOCTOR") {
      throw new ForbiddenException("An active doctor provider profile is required.");
    }

    const row = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "Appointment" WHERE id = ${encounterId} FOR UPDATE`);
      const appointment = await tx.appointment.findUnique({
        where: { id: encounterId },
        select: { id: true, patientId: true, providerId: true, status: true },
      });
      if (!appointment) throw new NotFoundException("Encounter not found.");
      if (appointment.providerId !== provider.id) {
        throw new ForbiddenException("Only the encounter doctor can sign this clinical encounter.");
      }
      if (appointment.status !== "CONFIRMED") {
        throw new ConflictException("Only a confirmed, not-yet-finalized encounter can be signed.");
      }

      const record = await tx.clinicalRecord.findFirst({
        where: { encounterRef: appointment.id, providerId: provider.id },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          patientId: true,
          providerId: true,
          encounterRef: true,
          algorithm: true,
          keyId: true,
          wrappedKey: true,
          iv: true,
          ciphertext: true,
          createdAt: true,
        },
      });
      if (!record) throw new ConflictException("A clinical record revision is required before signature.");

      const existing = await tx.clinicalSignature.findFirst({
        where: { encounterId: appointment.id, recordId: record.id },
      });
      if (existing) return existing;

      const material = {
        type: "DOCTOR_ENCOUNTER_SIGNATURE",
        policyVersion: POLICY_VERSION,
        encounterId: appointment.id,
        recordId: record.id,
        patientId: appointment.patientId,
        providerId: provider.id,
        envelope: {
          algorithm: record.algorithm,
          keyId: record.keyId,
          wrappedKey: record.wrappedKey,
          iv: record.iv,
          ciphertext: record.ciphertext,
        },
      };
      const signed = await this.attestation.attest(material);
      const created = await tx.clinicalSignature.create({
        data: {
          encounterId: appointment.id,
          recordId: record.id,
          patientId: appointment.patientId,
          providerId: provider.id,
          actorId: principal.accountId,
          sessionId: principal.sessionId,
          policyVersion: POLICY_VERSION,
          payloadDigest: signed.payloadDigest,
          signatureAlgorithm: signed.algorithm,
          signatureKeyId: signed.keyId,
          signature: signed.signature,
          signedAt: signed.signedAt,
        },
      });
      await this.audit.writeClinicalInTransaction(tx, {
        actorId: principal.accountId,
        action: "CLINICAL_ENCOUNTER_SIGNED",
        objectType: "CLINICAL_SIGNATURE",
        objectId: created.id,
        purpose: "TREATMENT",
        result: "SUCCESS",
        metadata: {
          domain: "CLINICAL_SIGNATURE",
          appointmentId: appointment.id,
          patientId: appointment.patientId,
          providerId: provider.id,
          resourceId: created.id,
          decision: "SIGNED",
        },
      });
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return {
      id: row.id,
      encounterId: row.encounterId,
      recordId: row.recordId,
      patientId: row.patientId,
      providerId: row.providerId,
      policyVersion: row.policyVersion,
      payloadDigest: row.payloadDigest,
      signatureAlgorithm: row.signatureAlgorithm,
      signatureKeyId: row.signatureKeyId,
      signedAt: row.signedAt,
      immutable: true,
      mfaAssured: true,
      createdAt: row.createdAt,
    };
  }

  private identifier(value: unknown, field: string) {
    if (typeof value !== "string") throw new BadRequestException(`${field} is required.`);
    const normalized = value.trim();
    if (!/^[A-Za-z0-9_.:-]{1,180}$/.test(normalized)) {
      throw new BadRequestException(`${field} is invalid.`);
    }
    return normalized;
  }
}
