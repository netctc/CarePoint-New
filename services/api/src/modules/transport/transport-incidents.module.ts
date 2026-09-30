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
import { ClinicalEnvelopeService } from "../clinical/clinical-envelope.service";
import { ClinicalModule } from "../clinical/clinical.module";
import { CommunicationsModule } from "../communications/communications.module";
import { NotificationsService } from "../communications/notifications.service";

const SAFE_ID = /^[A-Za-z0-9_.:-]{1,180}$/;
const SAFE_CODE = /^[A-Z0-9][A-Z0-9_.:-]{1,79}$/;
const IDEMPOTENCY = /^[A-Za-z0-9_.:-]{8,128}$/;
const CATEGORIES = new Set(["DELAY", "VEHICLE_BREAKDOWN", "PATIENT_CONDITION_CHANGE", "REFUSAL", "OPERATIONAL"]);
const SEVERITIES = new Set(["INFO", "WARNING", "CRITICAL"]);
const ACTIVE_STATUSES = new Set(["ASSIGNED", "EN_ROUTE", "ARRIVED", "TRANSPORTING"]);

type IncidentInput = {
  idempotencyKey?: unknown;
  category?: unknown;
  severity?: unknown;
  reasonCode?: unknown;
  detail?: unknown;
  occurredAt?: unknown;
};
type EnvelopeRow = { algorithm: string; keyId: string; wrappedKey: string; iv: string; ciphertext: string };
type JsonObject = Record<string, unknown>;

@Injectable()
class TransportIncidentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly envelope: ClinicalEnvelopeService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(principal: AuthPrincipal, requestIdRaw: string, input: IncidentInput) {
    const responder = await this.requireTransportResponder(principal);
    const requestId = this.requiredId(requestIdRaw, "requestId");
    const idempotencyKey = this.idempotencyKey(input.idempotencyKey);
    const category = this.enumValue(input.category, CATEGORIES, "category");
    const severity = this.enumValue(input.severity, SEVERITIES, "severity");
    const reasonCode = this.reasonCode(input.reasonCode);
    const detail = this.text(input.detail, "detail", 4000, false) ?? null;
    const occurredAt = this.eventTime(input.occurredAt, "occurredAt");

    const request = await this.prisma.medicalTransportRequest.findFirst({
      where: { id: requestId, assignedProviderId: responder.providerId, mode: responder.mode },
      select: { id: true, patientId: true, assignedProviderId: true, mode: true, status: true },
    });
    if (!request) throw new NotFoundException("Assigned medical transport job not found.");
    if (!ACTIVE_STATUSES.has(request.status)) {
      throw new ConflictException("Incidents can only be recorded while the transport job is active.");
    }

    const assignment = await this.prisma.crewAssignment.findFirst({
      where: { transportRequestId: request.id, providerId: responder.providerId },
      orderBy: { revision: "desc" },
      select: { id: true, revision: true, transportUnitId: true, crewProviderIds: true },
    });

    const payload = {
      schemaVersion: 1,
      kind: "TRANSPORT_INCIDENT",
      transportRequestId: request.id,
      patientId: request.patientId,
      providerId: responder.providerId,
      transportStatus: request.status,
      category,
      severity,
      reasonCode,
      detail,
      crewAssignmentId: assignment?.id ?? null,
      crewAssignmentRevision: assignment?.revision ?? null,
      transportUnitId: assignment?.transportUnitId ?? null,
      crewProviderIds: assignment ? [...assignment.crewProviderIds].sort() : [],
      occurredAt: occurredAt.toISOString(),
    };
    const requestDigest = this.digest(payload);

    const existing = await this.prisma.transportIncident.findUnique({ where: { idempotencyKey } });
    if (existing) {
      if (existing.transportRequestId !== request.id || existing.providerId !== responder.providerId || existing.requestDigest !== requestDigest) {
        throw new ConflictException("idempotencyKey was already used with different incident content.");
      }
      return this.present(existing, await this.decrypt(existing));
    }

    const encrypted = await this.envelope.encryptRecord(payload);
    let criticalNotificationQueued = false;
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        await this.audit.reserveIntegrityChainForSerializableTransaction(tx);
        await tx.$queryRaw(Prisma.sql`SELECT id FROM "MedicalTransportRequest" WHERE id = ${request.id} FOR UPDATE`);
        const locked = await tx.medicalTransportRequest.findUnique({
          where: { id: request.id },
          select: { id: true, patientId: true, assignedProviderId: true, mode: true, status: true },
        });
        if (!locked || locked.assignedProviderId !== responder.providerId || locked.mode !== responder.mode || !ACTIVE_STATUSES.has(locked.status)) {
          throw new ConflictException("Transport job changed before the incident could be recorded.");
        }
        const latestAssignment = await tx.crewAssignment.findFirst({
          where: { transportRequestId: request.id, providerId: responder.providerId },
          orderBy: { revision: "desc" },
          select: { id: true },
        });
        if ((latestAssignment?.id ?? null) !== (assignment?.id ?? null)) {
          throw new ConflictException("Crew or unit assignment changed. Refresh before reporting the incident.");
        }

        const created = await tx.transportIncident.create({
          data: {
            transportRequestId: request.id,
            providerId: responder.providerId,
            patientId: request.patientId,
            category,
            severity,
            reasonCode,
            idempotencyKey,
            requestDigest,
            crewAssignmentId: assignment?.id ?? null,
            occurredAt,
            reportedByAccountId: principal.accountId,
            ...this.envelopeData(encrypted),
          },
        });

        await this.audit.writeClinicalInTransaction(tx, {
          actorId: principal.accountId,
          action: "MEDICAL_TRANSPORT_INCIDENT_RECORDED",
          objectType: "TRANSPORT_INCIDENT",
          objectId: created.id,
          purpose: "MEDICAL_TRANSPORT",
          result: "SUCCESS",
          metadata: {
            domain: "MEDICAL_TRANSPORT",
            providerId: responder.providerId,
            patientId: request.patientId,
            transportRequestId: request.id,
            crewAssignmentId: assignment?.id ?? null,
            category,
            severity,
            reasonCode,
            detailIncluded: detail !== null,
            decision: "ALLOW",
          },
        });

        if (severity === "CRITICAL") {
          const operationalAccounts = await tx.user.findMany({
            where: { role: { in: ["ADMIN", "SUPPORT"] }, status: "ACTIVE" },
            select: { id: true },
            take: 100,
          });
          for (const account of operationalAccounts) {
            await this.notifications.enqueueAccountInTransaction(tx, {
              accountId: account.id,
              dedupeKey: `transport-incident:${created.id}`,
              type: "TRANSPORT_UPDATE",
              entityType: "TRANSPORT_INCIDENT",
              entityId: created.id,
              safeTitleKey: "transport.incident.critical.title",
              safeBodyKey: "transport.incident.critical.body",
            });
          }
          criticalNotificationQueued = operationalAccounts.length > 0;
        }
        return created;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

      if (criticalNotificationQueued) this.notifications.wakeOutbox();
      return this.present(row, payload);
    } catch (error) {
      if (!this.uniqueConflict(error)) throw error;
      const raced = await this.prisma.transportIncident.findUnique({ where: { idempotencyKey } });
      if (!raced || raced.transportRequestId !== request.id || raced.providerId !== responder.providerId || raced.requestDigest !== requestDigest) {
        throw new ConflictException("Transport incident changed concurrently.");
      }
      return this.present(raced, await this.decrypt(raced));
    }
  }

  async list(principal: AuthPrincipal, requestIdRaw: string) {
    const responder = await this.requireTransportResponder(principal);
    const requestId = this.requiredId(requestIdRaw, "requestId");
    const request = await this.prisma.medicalTransportRequest.findFirst({
      where: { id: requestId, assignedProviderId: responder.providerId, mode: responder.mode },
      select: { id: true, patientId: true },
    });
    if (!request) throw new NotFoundException("Assigned medical transport job not found.");
    const rows = await this.prisma.transportIncident.findMany({
      where: { transportRequestId: request.id, providerId: responder.providerId },
      orderBy: { occurredAt: "desc" },
      take: 100,
    });
    const items = [];
    for (const row of rows) items.push(this.present(row, await this.decrypt(row)));
    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "MEDICAL_TRANSPORT_INCIDENT_TIMELINE_READ",
      objectType: "MEDICAL_TRANSPORT_REQUEST",
      objectId: request.id,
      purpose: "MEDICAL_TRANSPORT",
      result: "SUCCESS",
      metadata: { domain: "MEDICAL_TRANSPORT", providerId: responder.providerId, patientId: request.patientId, itemCount: items.length, decision: "ALLOW" },
    });
    return { transportRequestId: request.id, items, appendOnly: true };
  }

  private async requireTransportResponder(principal: AuthPrincipal) {
    const provider = await this.prisma.provider.findUnique({
      where: { userId: principal.accountId },
      include: { otherProviderProfile: { include: { category: true } } },
    });
    const category = provider?.otherProviderProfile?.category;
    const family = category?.family;
    if (!provider || provider.class !== "OTHER_PROVIDER" || provider.status !== "ACTIVE" || !category?.active ||
        (family !== "MEDICAL_TRANSPORT_GROUND" && family !== "MEDICAL_TRANSPORT_AIR")) {
      throw new ForbiddenException("This Other Provider account is not authorized for transport incidents.");
    }
    return { providerId: provider.id, mode: family === "MEDICAL_TRANSPORT_AIR" ? "AIR" as const : "GROUND" as const };
  }

  private present(row: any, payload: JsonObject) {
    return {
      id: row.id,
      transportRequestId: row.transportRequestId,
      category: row.category,
      severity: row.severity,
      reasonCode: row.reasonCode,
      crewAssignmentId: row.crewAssignmentId,
      occurredAt: row.occurredAt,
      data: payload,
      immutable: true,
      criticalNotificationRequired: row.severity === "CRITICAL",
      createdAt: row.createdAt,
    };
  }

  private requiredId(value: unknown, field: string) {
    if (typeof value !== "string" || !SAFE_ID.test(value.trim())) throw new BadRequestException(`${field} is invalid.`);
    return value.trim();
  }
  private idempotencyKey(value: unknown) {
    if (typeof value !== "string" || !IDEMPOTENCY.test(value.trim())) throw new BadRequestException("idempotencyKey is invalid.");
    return value.trim();
  }
  private reasonCode(value: unknown) {
    if (typeof value !== "string") throw new BadRequestException("reasonCode is required.");
    const normalized = value.trim().toUpperCase();
    if (!SAFE_CODE.test(normalized)) throw new BadRequestException("reasonCode is invalid.");
    return normalized;
  }
  private enumValue(value: unknown, allowed: Set<string>, field: string) {
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
  private eventTime(value: unknown, field: string) {
    if (value == null || value === "") throw new BadRequestException(`${field} is required.`);
    const date = new Date(String(value));
    if (!Number.isFinite(date.getTime())) throw new BadRequestException(`${field} is invalid.`);
    const now = Date.now();
    if (date.getTime() > now + 5 * 60 * 1000 || date.getTime() < now - 24 * 60 * 60 * 1000) {
      throw new BadRequestException(`${field} must be within the last 24 hours.`);
    }
    return date;
  }
  private digest(value: unknown) {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
  }
  private envelopeData(envelope: EncryptedEnvelope) {
    return { algorithm: envelope.algorithm, keyId: envelope.keyId, wrappedKey: envelope.wrappedKey, iv: envelope.iv, ciphertext: envelope.ciphertext };
  }
  private async decrypt(row: EnvelopeRow): Promise<JsonObject> {
    return this.envelope.decryptRecord<JsonObject>({ version: 1, algorithm: row.algorithm as "AES-256-GCM", keyId: row.keyId, wrappedKey: row.wrappedKey, iv: row.iv, ciphertext: row.ciphertext });
  }
  private uniqueConflict(error: unknown) {
    return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002";
  }
}

@RequirePermissions("TRANSPORT_RESPOND")
@Controller("provider/transport/jobs")
class TransportIncidentsController {
  constructor(private readonly incidents: TransportIncidentsService) {}

  @Post(":id/incidents")
  @Header("Cache-Control", "no-store")
  create(@CurrentPrincipal() principal: AuthPrincipal, @Param("id") id: string, @Body() body: IncidentInput) {
    return this.incidents.create(principal, id, body);
  }

  @Get(":id/incidents")
  @Header("Cache-Control", "no-store")
  list(@CurrentPrincipal() principal: AuthPrincipal, @Param("id") id: string) {
    return this.incidents.list(principal, id);
  }
}

@Module({
  imports: [ClinicalModule, CommunicationsModule],
  controllers: [TransportIncidentsController],
  providers: [TransportIncidentsService],
})
export class TransportIncidentsModule {}
