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
  Param,
  Post,
} from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { ClinicalMediaModule } from "../documents/clinical-media.module";
import { ClinicalMediaService } from "../documents/clinical-media.service";
import { ProviderCategoryCapabilityService } from "../providers/provider-category-capability.service";
import { ProvidersModule } from "../providers/providers.module";

const SAFE_ID = /^[A-Za-z0-9_.:-]{1,180}$/;
const IDEMPOTENCY = /^[A-Za-z0-9_.:-]{8,128}$/;
const RETENTION_POLICY = "CLINICAL_MEDIA_GOVERNED_RETENTION";
const PHOTO_TYPES = new Set(["image/jpeg", "image/png"]);

type JsonObject = Record<string, unknown>;

@Injectable()
class ProviderFieldMediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly capabilities: ProviderCategoryCapabilityService,
    private readonly media: ClinicalMediaService,
  ) {}

  async create(principal: AuthPrincipal, appointmentIdRaw: string, input: JsonObject) {
    const context = await this.capabilities.assertWorkflowCapability(principal, "MEDIA_CAPTURE");
    const appointmentId = this.requiredId(appointmentIdRaw, "appointmentId");
    const appointment = await this.prisma.appointment.findFirst({
      where: {
        id: appointmentId,
        providerId: context.providerId,
        modality: "HOME_VISIT",
        status: { in: ["CONFIRMED", "COMPLETED"] },
      },
      select: { id: true, patientId: true, providerId: true, startsAt: true, status: true },
    });
    if (!appointment) throw new ForbiddenException("Assigned HOME_VISIT appointment is required for field media capture.");

    const idempotencyKey = this.idempotencyKey(input.idempotencyKey);
    const mediaType = this.photoType(input.mediaType);
    const consentId = this.requiredId(input.consentId, "consentId");
    const contentBase64 = this.requiredBase64(input.contentBase64);
    const capturedAt = this.capturedAt(input.capturedAt);
    const metadata = this.metadata(input.metadata, appointment.id, capturedAt);
    const requestDigest = this.digest({
      appointmentId: appointment.id,
      patientId: appointment.patientId,
      providerId: context.providerId,
      consentId,
      mediaType,
      contentDigest: this.digest(Buffer.from(contentBase64, "base64")),
      capturedAt: capturedAt.toISOString(),
      metadata,
    });

    const existing = await this.prisma.providerFieldMediaEvidence.findUnique({ where: { idempotencyKey } });
    if (existing) {
      if (existing.providerId !== context.providerId || existing.appointmentId !== appointment.id || existing.requestDigest !== requestDigest) {
        throw new ConflictException("idempotencyKey was already used with different field media content.");
      }
      return this.presentEvidence(existing, await this.findVisibleMedia(principal, appointment.patientId, existing.clinicalMediaId));
    }

    const createdMedia = await this.media.providerCreate(principal, appointment.patientId, {
      consentId,
      purpose: "TREATMENT",
      mediaType,
      contentBase64,
      metadata,
    }) as JsonObject;
    const clinicalMediaId = this.requiredId(createdMedia.id, "clinicalMediaId");
    const stored = await this.prisma.clinicalMedia.findUnique({
      where: { id: clinicalMediaId },
      select: { id: true, patientId: true, providerId: true, createdByAccountId: true, contentDigest: true, createdAt: true },
    });
    if (!stored || stored.patientId !== appointment.patientId || stored.providerId !== context.providerId || stored.createdByAccountId !== principal.accountId) {
      throw new ConflictException("Stored clinical media context does not match the field visit.");
    }

    const evidence = await this.prisma.$transaction(async (tx) => {
      const row = await tx.providerFieldMediaEvidence.create({
        data: {
          idempotencyKey,
          requestDigest,
          clinicalMediaId: stored.id,
          appointmentId: appointment.id,
          patientId: appointment.patientId,
          providerId: context.providerId,
          authorActorId: principal.accountId,
          contentDigest: stored.contentDigest,
          capturedAt,
          retentionPolicyCode: RETENTION_POLICY,
        },
      });
      await this.audit.writeClinicalInTransaction(tx, {
        actorId: principal.accountId,
        action: "PROVIDER_FIELD_MEDIA_EVIDENCE_LINKED",
        objectType: "CLINICAL_MEDIA",
        objectId: stored.id,
        purpose: "TREATMENT",
        result: "SUCCESS",
        metadata: {
          domain: "OTHER_PROVIDER_WORKFLOW",
          providerId: context.providerId,
          patientId: appointment.patientId,
          appointmentId: appointment.id,
          resourceId: stored.id,
          evidenceId: row.id,
          contentDigest: stored.contentDigest,
          retentionPolicyCode: RETENTION_POLICY,
          decision: "ALLOW",
        },
      });
      return row;
    });

    return this.presentEvidence(evidence, createdMedia);
  }

  async list(principal: AuthPrincipal, appointmentIdRaw: string) {
    const context = await this.capabilities.assertWorkflowCapability(principal, "MEDIA_CAPTURE");
    const appointmentId = this.requiredId(appointmentIdRaw, "appointmentId");
    const appointment = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, providerId: context.providerId, modality: "HOME_VISIT" },
      select: { id: true, patientId: true },
    });
    if (!appointment) throw new ForbiddenException("Assigned HOME_VISIT appointment is required for field media access.");
    const evidence = await this.prisma.providerFieldMediaEvidence.findMany({
      where: { appointmentId, providerId: context.providerId, patientId: appointment.patientId },
      orderBy: [{ capturedAt: "desc" }, { createdAt: "desc" }],
      take: 100,
    });
    const visible = await this.media.listForProvider(principal, appointment.patientId) as { items?: JsonObject[] };
    const byId = new Map((visible.items ?? []).map((item) => [item.id?.toString(), item]));
    const items = evidence
      .filter((row) => byId.has(row.clinicalMediaId))
      .map((row) => this.presentEvidence(row, byId.get(row.clinicalMediaId)!));
    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "PROVIDER_FIELD_MEDIA_HISTORY_READ",
      objectType: "APPOINTMENT",
      objectId: appointment.id,
      purpose: "TREATMENT",
      result: "SUCCESS",
      metadata: {
        domain: "OTHER_PROVIDER_WORKFLOW",
        providerId: context.providerId,
        patientId: appointment.patientId,
        appointmentId: appointment.id,
        itemCount: items.length,
        decision: "ALLOW",
      },
    });
    return { appointmentId, patientId: appointment.patientId, items, retentionPolicyCode: RETENTION_POLICY };
  }

  private async findVisibleMedia(principal: AuthPrincipal, patientId: string, mediaId: string): Promise<JsonObject> {
    const visible = await this.media.listForProvider(principal, patientId) as { items?: JsonObject[] };
    return (visible.items ?? []).find((item) => item.id === mediaId) ?? { id: mediaId };
  }

  private presentEvidence(row: {
    id: string;
    clinicalMediaId: string;
    appointmentId: string;
    patientId: string;
    providerId: string;
    authorActorId: string;
    contentDigest: string;
    capturedAt: Date;
    retentionPolicyCode: string;
    createdAt: Date;
  }, media: JsonObject) {
    return {
      evidenceId: row.id,
      clinicalMediaId: row.clinicalMediaId,
      appointmentId: row.appointmentId,
      patientId: row.patientId,
      providerId: row.providerId,
      authorActorId: row.authorActorId,
      contentDigest: row.contentDigest,
      capturedAt: row.capturedAt,
      retentionPolicyCode: row.retentionPolicyCode,
      createdAt: row.createdAt,
      consentEvidence: media.consentEvidence ?? null,
      media,
      encryptedAtRest: true,
      capability: "MEDIA_CAPTURE",
      automatedClinicalInference: false,
    };
  }

  private metadata(value: unknown, appointmentId: string, capturedAt: Date): JsonObject {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
    return {
      ...(typeof source.title === "string" && source.title.trim() ? { title: source.title.trim() } : {}),
      ...(typeof source.caption === "string" && source.caption.trim() ? { caption: source.caption.trim() } : {}),
      ...(typeof source.bodySiteCode === "string" && source.bodySiteCode.trim() ? { bodySiteCode: source.bodySiteCode.trim().toUpperCase() } : {}),
      encounterRef: appointmentId,
      capturedAt: capturedAt.toISOString(),
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
  private photoType(value: unknown): string {
    if (typeof value !== "string") throw new BadRequestException("mediaType is required.");
    const normalized = value.trim().toLowerCase();
    if (!PHOTO_TYPES.has(normalized)) throw new BadRequestException("Field evidence accepts JPEG or PNG photos only.");
    return normalized;
  }
  private requiredBase64(value: unknown): string {
    if (typeof value !== "string" || value.trim().length < 4) throw new BadRequestException("contentBase64 is required.");
    return value.replace(/\s+/g, "");
  }
  private capturedAt(value: unknown): Date {
    if (value == null || value === "") throw new BadRequestException("capturedAt is required.");
    const date = new Date(String(value));
    if (!Number.isFinite(date.getTime())) throw new BadRequestException("capturedAt is invalid.");
    const now = Date.now();
    if (date.getTime() > now + 5 * 60 * 1000 || date.getTime() < now - 7 * 24 * 60 * 60 * 1000) {
      throw new BadRequestException("capturedAt must be within the last 7 days and not materially in the future.");
    }
    return date;
  }
  private digest(value: unknown): string {
    const input = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value));
    return createHash("sha256").update(input).digest("hex");
  }
}

@Controller("provider/jobs/:appointmentId/media")
class ProviderFieldMediaController {
  constructor(private readonly fieldMedia: ProviderFieldMediaService) {}

  @RequirePermissions("OTHER_PROVIDER_CLINICAL_WORKSPACE")
  @Post()
  @Header("Cache-Control", "no-store")
  create(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("appointmentId") appointmentId: string,
    @Body() body: JsonObject,
  ) {
    return this.fieldMedia.create(principal, appointmentId, body);
  }

  @RequirePermissions("OTHER_PROVIDER_CLINICAL_WORKSPACE")
  @Get()
  @Header("Cache-Control", "no-store")
  list(@CurrentPrincipal() principal: AuthPrincipal, @Param("appointmentId") appointmentId: string) {
    return this.fieldMedia.list(principal, appointmentId);
  }
}

@Module({
  imports: [ProvidersModule, ClinicalMediaModule],
  controllers: [ProviderFieldMediaController],
  providers: [ProviderFieldMediaService],
})
export class ProviderFieldMediaModule {}
