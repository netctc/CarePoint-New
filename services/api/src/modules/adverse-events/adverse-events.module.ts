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
  Post,
  Query,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { AuthPrincipal } from "@carepoint/identity";
import type { EncryptedEnvelope } from "@carepoint/security";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { ClinicalEnvelopeService } from "../clinical/clinical-envelope.service";
import { ClinicalModule } from "../clinical/clinical.module";
import { CommunicationsModule } from "../communications/communications.module";
import { NotificationsService } from "../communications/notifications.service";
import { DependentsModule } from "../dependents/dependents.module";
import { PatientContextService } from "../dependents/dependents.service";

const SOURCE_KINDS = new Set(["CLINICAL_PROFILE_ENTRY", "PRESCRIPTION_ORDER"]);
const LOOKBACK_DAYS = 365;
const LOOKAHEAD_DAYS = 30;

type SourceKind = "CLINICAL_PROFILE_ENTRY" | "PRESCRIPTION_ORDER";
type StoredAdverseEvent = {
  schemaVersion: 1;
  symptom: string;
  severityDeclared: number;
  notes?: string;
  source: { type: "PATIENT_REPORTED" };
  causality: { assessed: false };
};

type CreateAdverseEventInput = {
  idempotencyKey?: unknown;
  sourceKind?: unknown;
  sourceId?: unknown;
  symptom?: unknown;
  severityDeclared?: unknown;
  notes?: unknown;
  occurredAt?: unknown;
};

@Injectable()
class AdverseEventReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly contexts: PatientContextService,
    private readonly envelope: ClinicalEnvelopeService,
    private readonly notifications: NotificationsService,
  ) {}

  async patientList(principal: AuthPrincipal, sourceKindRaw?: string, sourceIdRaw?: string) {
    this.patientRole(principal);
    const context = await this.contexts.resolveEffectivePatient(principal, "CLINICAL_READ");
    const sourceKind = sourceKindRaw ? this.sourceKind(sourceKindRaw) : undefined;
    const sourceId = sourceIdRaw ? this.id(sourceIdRaw, "sourceId") : undefined;
    if ((sourceKind && !sourceId) || (!sourceKind && sourceId)) {
      throw new BadRequestException("sourceKind and sourceId must be supplied together.");
    }
    const rows = await this.prisma.adverseEventReport.findMany({
      where: {
        patientId: context.patientId,
        accountId: principal.accountId,
        ...(sourceKind && sourceId ? { sourceKind, sourceId } : {}),
      },
      orderBy: { receivedAt: "desc" },
      take: 100,
    });
    const items = [];
    for (const row of rows) items.push(await this.present(row, await this.decrypt(row), "PATIENT_SELF"));
    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "ADVERSE_EVENT_REPORT_LIST_READ",
      objectType: "PATIENT",
      objectId: context.patientId,
      purpose: context.mode === "DEPENDENT" ? "PROXY_PATIENT_ACCESS" : "PATIENT_ACCESS",
      result: "SUCCESS",
      metadata: {
        domain: "ADVERSE_EVENT_REPORT",
        patientId: context.patientId,
        itemCount: items.length,
        sourceFiltered: Boolean(sourceKind),
        decision: "ALLOW",
      },
    });
    return { patientId: context.patientId, mode: context.mode, items };
  }

  async create(principal: AuthPrincipal, input: CreateAdverseEventInput) {
    this.patientRole(principal);
    const context = await this.contexts.resolveEffectivePatient(principal, "CLINICAL_WRITE");
    const normalized = this.normalize(input);
    const requestDigest = this.digest({
      sourceKind: normalized.sourceKind,
      sourceId: normalized.sourceId,
      payload: normalized.payload,
      occurredAt: normalized.occurredAt?.toISOString() ?? null,
    });

    const replay = await this.prisma.adverseEventReport.findUnique({
      where: {
        accountId_patientId_idempotencyKey: {
          accountId: principal.accountId,
          patientId: context.patientId,
          idempotencyKey: normalized.idempotencyKey,
        },
      },
    });
    if (replay) {
      if (replay.requestDigest !== requestDigest) {
        throw new ConflictException("idempotencyKey is already bound to another adverse-event report.");
      }
      return this.present(replay, await this.decrypt(replay), "PATIENT_SELF");
    }

    const routing = await this.resolveRouting(
      context.patientId,
      normalized.sourceKind,
      normalized.sourceId,
    );
    const encrypted = await this.envelope.encryptRecord(normalized.payload);

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        await this.audit.reserveIntegrityChainForSerializableTransaction(tx);
        const row = await tx.adverseEventReport.create({
          data: {
            patientId: context.patientId,
            accountId: principal.accountId,
            sourceKind: normalized.sourceKind,
            sourceId: normalized.sourceId,
            routedProviderId: routing.providerId,
            idempotencyKey: normalized.idempotencyKey,
            requestDigest,
            status: "RECEIVED",
            ...(normalized.occurredAt ? { occurredAt: normalized.occurredAt } : {}),
            ...this.envelopeData(encrypted),
          },
        });
        await this.notifications.enqueueAccountInTransaction(tx, {
          accountId: routing.providerAccountId,
          dedupeKey: `adverse-event:${row.id}`,
          type: "CARE_COORDINATION",
          entityType: "ADVERSE_EVENT_REPORT",
          entityId: row.id,
          safeTitleKey: "notification.adverse_event.title",
          safeBodyKey: "notification.adverse_event.body",
        });
        await this.audit.writeClinicalInTransaction(tx, {
          actorId: principal.accountId,
          action: "ADVERSE_EVENT_REPORT_RECEIVED",
          objectType: "ADVERSE_EVENT_REPORT",
          objectId: row.id,
          purpose: context.mode === "DEPENDENT" ? "PROXY_PATIENT_ACCESS" : "PATIENT_ACCESS",
          result: "SUCCESS",
          metadata: {
            domain: "ADVERSE_EVENT_REPORT",
            patientId: context.patientId,
            providerId: routing.providerId,
            resourceId: row.id,
            sourceKind: normalized.sourceKind,
            sourceId: normalized.sourceId,
            causalityAssessed: false,
            routedToCareTeam: true,
            decision: "ALLOW",
          },
        });
        return row;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      this.notifications.wakeOutbox();
      return this.present(created, normalized.payload, "PATIENT_SELF");
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const raced = await this.prisma.adverseEventReport.findUnique({
          where: {
            accountId_patientId_idempotencyKey: {
              accountId: principal.accountId,
              patientId: context.patientId,
              idempotencyKey: normalized.idempotencyKey,
            },
          },
        });
        if (raced) {
          if (raced.requestDigest !== requestDigest) {
            throw new ConflictException("idempotencyKey is already bound to another adverse-event report.");
          }
          return this.present(raced, await this.decrypt(raced), "PATIENT_SELF");
        }
      }
      throw error;
    }
  }

  async providerList(principal: AuthPrincipal) {
    if (principal.role !== "DOCTOR") throw new ForbiddenException("Adverse-event inbox requires DOCTOR role.");
    const provider = await this.prisma.provider.findUnique({
      where: { userId: principal.accountId },
      select: { id: true, status: true, class: true },
    });
    if (!provider || provider.status !== "ACTIVE" || provider.class !== "DOCTOR") {
      throw new ForbiddenException("An active Doctor provider profile is required.");
    }
    const rows = await this.prisma.adverseEventReport.findMany({
      where: { routedProviderId: provider.id },
      orderBy: { receivedAt: "desc" },
      take: 200,
    });
    const items = [];
    for (const row of rows) items.push(await this.present(row, await this.decrypt(row), "PATIENT_INITIATED_REPORT"));
    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "ADVERSE_EVENT_INBOX_READ",
      objectType: "PROVIDER",
      objectId: provider.id,
      purpose: "TREATMENT",
      result: "SUCCESS",
      metadata: {
        domain: "ADVERSE_EVENT_REPORT",
        providerId: provider.id,
        itemCount: items.length,
        accessBasis: "PATIENT_INITIATED_REPORT",
        decision: "ALLOW",
      },
    });
    return { providerId: provider.id, items };
  }

  private normalize(input: CreateAdverseEventInput) {
    if (!input || typeof input !== "object") throw new BadRequestException("Adverse-event report payload is required.");
    const idempotencyKey = this.idempotency(input.idempotencyKey);
    const sourceKind = this.sourceKind(input.sourceKind);
    const sourceId = this.id(input.sourceId, "sourceId");
    const symptom = this.text(input.symptom, "symptom", 1000);
    const severityDeclared = Number(input.severityDeclared);
    if (!Number.isInteger(severityDeclared) || severityDeclared < 0 || severityDeclared > 10) {
      throw new BadRequestException("severityDeclared must be an integer from 0 to 10.");
    }
    const notes = this.optionalText(input.notes, "notes", 4000);
    const occurredAt = input.occurredAt == null || input.occurredAt === ""
      ? undefined
      : this.date(input.occurredAt, "occurredAt");
    if (occurredAt && occurredAt.getTime() > Date.now() + 5 * 60 * 1000) {
      throw new BadRequestException("occurredAt cannot be in the future.");
    }
    const payload: StoredAdverseEvent = {
      schemaVersion: 1,
      symptom,
      severityDeclared,
      ...(notes ? { notes } : {}),
      source: { type: "PATIENT_REPORTED" },
      causality: { assessed: false },
    };
    return { idempotencyKey, sourceKind, sourceId, payload, occurredAt };
  }

  private async resolveRouting(patientId: string, sourceKind: SourceKind, sourceId: string) {
    if (sourceKind === "PRESCRIPTION_ORDER") {
      const order = await this.prisma.clinicalOrder.findUnique({
        where: { id: sourceId },
        select: { patientId: true, type: true, status: true, providerId: true },
      });
      if (!order || order.patientId !== patientId || order.type !== "PRESCRIPTION" || order.status !== "SIGNED") {
        throw new ConflictException("Possible adverse effects can only reference an active signed prescription.");
      }
      return this.activeDoctor(order.providerId);
    }

    const entry = await this.prisma.clinicalProfileEntry.findUnique({
      where: { id: sourceId },
      select: {
        patientId: true,
        kind: true,
        status: true,
        sourceType: true,
        sourceActorId: true,
      },
    });
    if (!entry || entry.patientId !== patientId || entry.kind !== "MEDICATION" || entry.status !== "ACTIVE") {
      throw new ConflictException("Possible adverse effects can only reference an active medication statement.");
    }

    if (entry.sourceType === "PROVIDER" && entry.sourceActorId) {
      const author = await this.prisma.provider.findUnique({
        where: { userId: entry.sourceActorId },
        select: { id: true, userId: true, status: true, class: true },
      });
      if (author?.status === "ACTIVE" && author.class === "DOCTOR" && author.userId) {
        return { providerId: author.id, providerAccountId: author.userId };
      }
    }

    const now = new Date();
    const from = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const to = new Date(now.getTime() + LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);
    const appointments = await this.prisma.appointment.findMany({
      where: {
        patientId,
        status: { in: ["CONFIRMED", "COMPLETED"] },
        startsAt: { gte: from, lte: to },
      },
      select: {
        providerId: true,
        startsAt: true,
        provider: { select: { id: true, userId: true, status: true, class: true } },
      },
      orderBy: { startsAt: "desc" },
      take: 50,
    });
    const routed = appointments.find((item) =>
      item.provider.status === "ACTIVE" &&
      item.provider.class === "DOCTOR" &&
      Boolean(item.provider.userId),
    )?.provider;
    if (!routed?.userId) {
      throw new ConflictException("No active Doctor care-team route is available for this medication report.");
    }
    return { providerId: routed.id, providerAccountId: routed.userId };
  }

  private async activeDoctor(providerId: string) {
    const provider = await this.prisma.provider.findUnique({
      where: { id: providerId },
      select: { id: true, userId: true, status: true, class: true },
    });
    if (!provider || provider.status !== "ACTIVE" || provider.class !== "DOCTOR" || !provider.userId) {
      throw new ConflictException("The medication source has no active Doctor care-team route.");
    }
    return { providerId: provider.id, providerAccountId: provider.userId };
  }

  private patientRole(principal: AuthPrincipal) {
    if (principal.role !== "PATIENT") throw new ForbiddenException("Patient account is required.");
  }

  private sourceKind(value: unknown): SourceKind {
    const normalized = String(value ?? "").trim().toUpperCase();
    if (!SOURCE_KINDS.has(normalized)) throw new BadRequestException("sourceKind is invalid.");
    return normalized as SourceKind;
  }

  private id(value: unknown, field: string) {
    if (typeof value !== "string" || !/^[A-Za-z0-9_.:-]{1,180}$/.test(value.trim())) {
      throw new BadRequestException(`${field} is invalid.`);
    }
    return value.trim();
  }

  private idempotency(value: unknown) {
    if (typeof value !== "string") throw new BadRequestException("idempotencyKey is required.");
    const normalized = value.trim();
    if (normalized.length < 8 || normalized.length > 128 || /\p{Cc}/u.test(normalized)) {
      throw new BadRequestException("idempotencyKey is invalid.");
    }
    return normalized;
  }

  private text(value: unknown, field: string, max: number) {
    if (typeof value !== "string") throw new BadRequestException(`${field} is required.`);
    const normalized = value.trim();
    if (!normalized || normalized.length > max || /\p{Cc}/u.test(normalized)) {
      throw new BadRequestException(`${field} is invalid.`);
    }
    return normalized;
  }

  private optionalText(value: unknown, field: string, max: number) {
    if (value == null || value === "") return undefined;
    return this.text(value, field, max);
  }

  private date(value: unknown, field: string) {
    if (typeof value !== "string") throw new BadRequestException(`${field} must be an ISO date-time.`);
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) throw new BadRequestException(`${field} must be an ISO date-time.`);
    return parsed;
  }

  private digest(value: unknown) {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
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

  private decrypt(row: {
    algorithm: string;
    keyId: string;
    wrappedKey: string;
    iv: string;
    ciphertext: string;
  }) {
    if (row.algorithm !== "AES-256-GCM") throw new ConflictException("Unsupported adverse-event envelope algorithm.");
    return this.envelope.decryptRecord<StoredAdverseEvent>({
      version: 1,
      algorithm: "AES-256-GCM",
      keyId: row.keyId,
      wrappedKey: row.wrappedKey,
      iv: row.iv,
      ciphertext: row.ciphertext,
    });
  }

  private present(
    row: {
      id: string;
      patientId: string;
      sourceKind: string;
      sourceId: string;
      routedProviderId: string;
      status: string;
      occurredAt: Date | null;
      receivedAt: Date;
      createdAt: Date;
    },
    payload: StoredAdverseEvent,
    accessBasis: string,
  ) {
    return {
      id: row.id,
      patientId: row.patientId,
      sourceKind: row.sourceKind,
      sourceId: row.sourceId,
      routedProviderId: row.routedProviderId,
      status: row.status,
      symptom: payload.symptom,
      severityDeclared: payload.severityDeclared,
      notes: payload.notes,
      occurredAt: row.occurredAt,
      receivedAt: row.receivedAt,
      provenance: {
        sourceType: payload.source.type,
        accessBasis,
      },
      receipt: {
        status: "RECEIVED",
        receivedAt: row.receivedAt,
        routedToCareTeam: true,
      },
      causalityAssessed: payload.causality.assessed,
      diagnosisCreated: false,
      prescriptionModified: false,
    };
  }
}

@Controller("patient/adverse-events")
class PatientAdverseEventController {
  constructor(private readonly reports: AdverseEventReportService) {}

  @RequirePermissions("PATIENT_MANAGE_CLINICAL_PROFILE")
  @Get()
  @Header("Cache-Control", "no-store")
  list(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Query("sourceKind") sourceKind?: string,
    @Query("sourceId") sourceId?: string,
  ) {
    return this.reports.patientList(principal, sourceKind, sourceId);
  }

  @RequirePermissions("PATIENT_MANAGE_CLINICAL_PROFILE")
  @Post()
  @Header("Cache-Control", "no-store")
  create(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: CreateAdverseEventInput) {
    return this.reports.create(principal, body ?? {});
  }
}

@Controller("provider/adverse-events")
class ProviderAdverseEventController {
  constructor(private readonly reports: AdverseEventReportService) {}

  @RequirePermissions("CLINICAL_PROFILE_READ")
  @Get()
  @Header("Cache-Control", "no-store")
  list(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.reports.providerList(principal);
  }
}

@Module({
  imports: [ClinicalModule, CommunicationsModule, DependentsModule],
  controllers: [PatientAdverseEventController, ProviderAdverseEventController],
  providers: [AdverseEventReportService],
})
export class AdverseEventReportModule {}
