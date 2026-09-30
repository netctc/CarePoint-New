import { createHash } from "node:crypto";
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
} from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import type { EncryptedEnvelope } from "@carepoint/security";
import { Prisma } from "@prisma/client";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { ClinicalModule } from "../clinical/clinical.module";
import { ClinicalEnvelopeService } from "../clinical/clinical-envelope.service";

const SAFE_ID = /^[A-Za-z0-9_.:-]{1,180}$/;
const IDEMPOTENCY = /^[A-Za-z0-9_.:-]{8,128}$/;
const SIGNATURE_METHODS = new Set(["TYPED_CONFIRMATION", "DRAWN_SIGNATURE"]);

type JsonObject = Record<string, unknown>;
type HandoffInput = {
  idempotencyKey?: unknown;
  receiverName?: unknown;
  receiverRole?: unknown;
  receiverOrganization?: unknown;
  handoffSummary?: unknown;
  handedOffAt?: unknown;
  receiverAcceptedHandoff?: unknown;
  signatureMethod?: unknown;
  drawnSignatureData?: unknown;
};
type EnvelopeRow = { algorithm: string; keyId: string; wrappedKey: string; iv: string; ciphertext: string };

@Injectable()
class TransportHandoffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly envelope: ClinicalEnvelopeService,
  ) {}

  async create(principal: AuthPrincipal, requestIdRaw: string, input: HandoffInput) {
    const responder = await this.requireTransportResponder(principal);
    const requestId = this.requiredId(requestIdRaw, "requestId");
    const idempotencyKey = this.idempotencyKey(input.idempotencyKey);

    const existingByKey = await this.prisma.transportHandoff.findUnique({ where: { idempotencyKey } });
    if (existingByKey) {
      if (existingByKey.transportRequestId !== requestId || existingByKey.providerId !== responder.providerId) {
        throw new ConflictException("idempotencyKey was already used with different handoff content.");
      }
      const payload = await this.decrypt(existingByKey);
      if (existingByKey.requestDigest !== this.digest(payload)) {
        throw new ConflictException("Stored handoff integrity check failed.");
      }
      return this.present(existingByKey, payload);
    }

    const request = await this.prisma.medicalTransportRequest.findFirst({
      where: {
        id: requestId,
        assignedProviderId: responder.providerId,
        mode: responder.mode,
      },
    });
    if (!request) throw new NotFoundException("Assigned medical transport job not found.");
    if (request.status !== "TRANSPORTING") {
      throw new ConflictException("Destination handoff can only be recorded while the patient is being transported.");
    }

    const priorHandoff = await this.prisma.transportHandoff.findUnique({ where: { transportRequestId: request.id } });
    if (priorHandoff) {
      throw new ConflictException("Destination handoff has already been recorded for this transport job.");
    }

    const assignment = await this.prisma.crewAssignment.findFirst({
      where: { transportRequestId: request.id, providerId: responder.providerId },
      orderBy: { revision: "desc" },
    });
    if (!assignment) {
      throw new ConflictException("Crew and transport unit must be assigned before destination handoff.");
    }

    const receiverName = this.text(input.receiverName, "receiverName", 160, true)!;
    const receiverRole = this.text(input.receiverRole, "receiverRole", 120, true)!;
    const receiverOrganization = this.text(input.receiverOrganization, "receiverOrganization", 200, false) ?? null;
    const handoffSummary = this.text(input.handoffSummary, "handoffSummary", 4000, true)!;
    const handedOffAt = this.eventTime(input.handedOffAt, "handedOffAt");
    if (input.receiverAcceptedHandoff !== true) {
      throw new BadRequestException("receiverAcceptedHandoff must be explicitly true.");
    }

    const signatureRequired = this.signatureRequired(responder.capabilities);
    const signatureMethod = input.signatureMethod == null || input.signatureMethod === ""
      ? null
      : this.enumValue(input.signatureMethod, SIGNATURE_METHODS, "signatureMethod");
    if (signatureRequired && signatureMethod == null) {
      throw new BadRequestException("Destination handoff signature is required by provider policy.");
    }
    const drawnSignatureData = signatureMethod === "DRAWN_SIGNATURE"
      ? this.text(input.drawnSignatureData, "drawnSignatureData", 250000, true)!
      : null;

    const handoffSummaryDigest = this.digest(handoffSummary);
    const transportContextDigest = this.digest({
      transportRequestId: request.id,
      patientId: request.patientId,
      providerId: responder.providerId,
      mode: request.mode,
      assistance: request.assistance,
      equipment: request.equipment,
      destinationLatitude: String(request.destinationLatitude),
      destinationLongitude: String(request.destinationLongitude),
      destinationAddress: request.destinationAddress ?? null,
      crewAssignmentId: assignment.id,
      crewAssignmentRevision: assignment.revision,
      transportUnitId: assignment.transportUnitId,
      crewProviderIds: [...assignment.crewProviderIds].sort(),
    });
    const payload = {
      schemaVersion: 1,
      kind: "TRANSPORT_DESTINATION_HANDOFF",
      transportRequestId: request.id,
      patientId: request.patientId,
      providerId: responder.providerId,
      crewAssignmentId: assignment.id,
      crewAssignmentRevision: assignment.revision,
      transportUnitId: assignment.transportUnitId,
      crewProviderIds: [...assignment.crewProviderIds].sort(),
      receiverName,
      receiverRole,
      receiverOrganization,
      handoffSummary,
      handoffSummaryDigest,
      transportContextDigest,
      receiverAcceptedHandoff: true,
      signatureRequired,
      signatureMethod,
      drawnSignatureData,
      handedOffAt: handedOffAt.toISOString(),
      clinicalConsentGranted: false,
      replacesClinicalConsent: false,
    };
    const requestDigest = this.digest(payload);
    const encrypted = await this.envelope.encryptRecord(payload);

    try {
      const row = await this.prisma.$transaction(async (tx) => {
        await this.audit.reserveIntegrityChainForSerializableTransaction(tx);
        await tx.$queryRaw(Prisma.sql`SELECT id FROM "MedicalTransportRequest" WHERE id = ${request.id} FOR UPDATE`);
        const locked = await tx.medicalTransportRequest.findUnique({ where: { id: request.id } });
        if (!locked || locked.assignedProviderId !== responder.providerId || locked.status !== "TRANSPORTING") {
          throw new ConflictException("Transport job changed before destination handoff could be recorded.");
        }
        const alreadyRecorded = await tx.transportHandoff.findUnique({ where: { transportRequestId: request.id } });
        if (alreadyRecorded) throw new ConflictException("Destination handoff has already been recorded for this transport job.");
        const latestAssignment = await tx.crewAssignment.findFirst({
          where: { transportRequestId: request.id, providerId: responder.providerId },
          orderBy: { revision: "desc" },
        });
        if (!latestAssignment || latestAssignment.id !== assignment.id) {
          throw new ConflictException("Crew or unit assignment changed before handoff. Refresh and confirm again.");
        }
        const created = await tx.transportHandoff.create({
          data: {
            idempotencyKey,
            requestDigest,
            transportRequestId: request.id,
            providerId: responder.providerId,
            patientId: request.patientId,
            crewAssignmentId: assignment.id,
            receiverName,
            receiverRole,
            signatureRequired,
            signatureMethod,
            handoffSummaryDigest,
            transportContextDigest,
            handedOffAt,
            ...this.envelopeData(encrypted),
          },
        });
        await this.audit.writeClinicalInTransaction(tx, {
          actorId: principal.accountId,
          action: "MEDICAL_TRANSPORT_DESTINATION_HANDOFF_RECORDED",
          objectType: "TRANSPORT_HANDOFF",
          objectId: created.id,
          purpose: "MEDICAL_TRANSPORT",
          result: "SUCCESS",
          metadata: {
            domain: "MEDICAL_TRANSPORT",
            providerId: responder.providerId,
            patientId: request.patientId,
            transportRequestId: request.id,
            crewAssignmentId: assignment.id,
            crewAssignmentRevision: assignment.revision,
            transportUnitId: assignment.transportUnitId,
            handoffSummaryDigest,
            transportContextDigest,
            signatureRequired,
            signatureMethod,
            replacesClinicalConsent: false,
            decision: "ALLOW",
          },
        });
        return created;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return this.present(row, payload);
    } catch (error) {
      if (!this.uniqueConflict(error)) throw error;
      const raced = await this.prisma.transportHandoff.findUnique({ where: { idempotencyKey } });
      if (!raced || raced.transportRequestId !== request.id || raced.providerId !== responder.providerId || raced.requestDigest !== requestDigest) {
        throw new ConflictException("Destination handoff changed concurrently.");
      }
      return this.present(raced, await this.decrypt(raced));
    }
  }

  async get(principal: AuthPrincipal, requestIdRaw: string) {
    const responder = await this.requireTransportResponder(principal);
    const requestId = this.requiredId(requestIdRaw, "requestId");
    const request = await this.prisma.medicalTransportRequest.findFirst({
      where: { id: requestId, assignedProviderId: responder.providerId, mode: responder.mode },
      select: { id: true, patientId: true },
    });
    if (!request) throw new NotFoundException("Assigned medical transport job not found.");
    const row = await this.prisma.transportHandoff.findUnique({ where: { transportRequestId: request.id } });
    if (!row) return { transportRequestId: request.id, handoff: null, appendOnly: true };
    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "MEDICAL_TRANSPORT_DESTINATION_HANDOFF_READ",
      objectType: "TRANSPORT_HANDOFF",
      objectId: row.id,
      purpose: "MEDICAL_TRANSPORT",
      result: "SUCCESS",
      metadata: {
        domain: "MEDICAL_TRANSPORT",
        providerId: responder.providerId,
        patientId: request.patientId,
        transportRequestId: request.id,
        decision: "ALLOW",
      },
    });
    return { transportRequestId: request.id, handoff: this.present(row, await this.decrypt(row)), appendOnly: true };
  }

  private async requireTransportResponder(principal: AuthPrincipal) {
    const provider = await this.prisma.provider.findUnique({
      where: { userId: principal.accountId },
      include: { otherProviderProfile: { include: { category: true } } },
    });
    const category = provider?.otherProviderProfile?.category;
    const family = category?.family;
    if (
      !provider ||
      provider.class !== "OTHER_PROVIDER" ||
      provider.status !== "ACTIVE" ||
      !category?.active ||
      (family !== "MEDICAL_TRANSPORT_GROUND" && family !== "MEDICAL_TRANSPORT_AIR")
    ) {
      throw new ForbiddenException("This Other Provider account is not authorized for transport handoff.");
    }
    return {
      providerId: provider.id,
      mode: family === "MEDICAL_TRANSPORT_AIR" ? "AIR" as const : "GROUND" as const,
      capabilities: this.objectValue(category.capabilities),
    };
  }

  private signatureRequired(capabilities: JsonObject): boolean {
    return capabilities.transportHandoffSignatureRequired === true;
  }

  private present(row: any, payload: JsonObject) {
    return {
      id: row.id,
      transportRequestId: row.transportRequestId,
      providerId: row.providerId,
      patientId: row.patientId,
      crewAssignmentId: row.crewAssignmentId,
      receiverName: row.receiverName,
      receiverRole: row.receiverRole,
      signatureRequired: row.signatureRequired,
      signatureMethod: row.signatureMethod,
      handoffSummaryDigest: row.handoffSummaryDigest,
      transportContextDigest: row.transportContextDigest,
      handedOffAt: row.handedOffAt,
      data: payload,
      immutable: true,
      replacesClinicalConsent: false,
      createdAt: row.createdAt,
    };
  }

  private requiredId(value: unknown, field: string): string {
    if (typeof value !== "string" || !SAFE_ID.test(value.trim())) throw new BadRequestException(`${field} is invalid.`);
    return value.trim();
  }
  private idempotencyKey(value: unknown): string {
    if (typeof value !== "string" || !IDEMPOTENCY.test(value.trim())) throw new BadRequestException("idempotencyKey is invalid.");
    return value.trim();
  }
  private enumValue(value: unknown, allowed: Set<string>, field: string): string {
    if (typeof value !== "string") throw new BadRequestException(`${field} is required.`);
    const normalized = value.trim().toUpperCase();
    if (!allowed.has(normalized)) throw new BadRequestException(`${field} is invalid.`);
    return normalized;
  }
  private text(value: unknown, field: string, max: number, required: boolean): string | undefined {
    if (value == null || value === "") {
      if (required) throw new BadRequestException(`${field} is required.`);
      return undefined;
    }
    if (typeof value !== "string") throw new BadRequestException(`${field} must be text.`);
    const text = value.trim();
    if (!text || text.length > max || /\p{Cc}/u.test(text)) throw new BadRequestException(`${field} is invalid.`);
    return text;
  }
  private eventTime(value: unknown, field: string): Date {
    if (value == null || value === "") throw new BadRequestException(`${field} is required.`);
    const date = new Date(String(value));
    if (!Number.isFinite(date.getTime())) throw new BadRequestException(`${field} is invalid.`);
    const now = Date.now();
    if (date.getTime() > now + 5 * 60 * 1000 || date.getTime() < now - 24 * 60 * 60 * 1000) {
      throw new BadRequestException(`${field} must be within the last 24 hours.`);
    }
    return date;
  }
  private objectValue(value: unknown): JsonObject {
    return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
  }
  private digest(value: unknown): string {
    return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
  }
  private envelopeData(envelope: EncryptedEnvelope) {
    return { algorithm: envelope.algorithm, keyId: envelope.keyId, wrappedKey: envelope.wrappedKey, iv: envelope.iv, ciphertext: envelope.ciphertext };
  }
  private async decrypt(row: EnvelopeRow): Promise<JsonObject> {
    return this.envelope.decryptRecord<JsonObject>({
      version: 1,
      algorithm: row.algorithm as "AES-256-GCM",
      keyId: row.keyId,
      wrappedKey: row.wrappedKey,
      iv: row.iv,
      ciphertext: row.ciphertext,
    });
  }
  private uniqueConflict(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002";
  }
}

@RequirePermissions("TRANSPORT_RESPOND")
@Controller("provider/transport/jobs")
class TransportHandoffController {
  constructor(private readonly handoff: TransportHandoffService) {}

  @Post(":id/handoff")
  @Header("Cache-Control", "no-store")
  create(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("id") id: string,
    @Body() body: HandoffInput,
  ) {
    return this.handoff.create(principal, id, body);
  }

  @Get(":id/handoff")
  @Header("Cache-Control", "no-store")
  get(@CurrentPrincipal() principal: AuthPrincipal, @Param("id") id: string) {
    return this.handoff.get(principal, id);
  }
}

@Module({
  imports: [ClinicalModule],
  controllers: [TransportHandoffController],
  providers: [TransportHandoffService],
})
export class TransportHandoffModule {}
