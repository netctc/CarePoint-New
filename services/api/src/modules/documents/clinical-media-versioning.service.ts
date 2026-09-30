import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { Prisma, type ClinicalMedia, type Consent } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { DocumentStorageService } from "./document-storage.service";
import { DocumentsEnvelopeService } from "./documents-envelope.service";
import { DocumentMalwareScannerService } from "./document-malware-scanner.service";

const CLINICAL_MEDIA_SCOPE = "CLINICAL_MEDIA_CAPTURE";
const CLINICAL_MEDIA_CONSENT_VERSION = "clinical-media-v1";
const CLINICAL_MEDIA_PURPOSE = "TREATMENT";
const MAX_MEDIA_BYTES = 8 * 1024 * 1024;
const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;
const MAX_VERSION_ITEMS = 100;
const MEDIA_TYPES = new Set(["image/jpeg", "image/png", "video/mp4"]);
const THUMBNAIL_TYPES = new Set(["image/jpeg", "image/png"]);
const METADATA_KEYS = new Set(["title", "caption", "bodySiteCode", "capturedAt", "encounterRef"]);

type JsonObject = Record<string, unknown>;
type VersionPayload = {
  mediaType: string;
  byteLength: number;
  contentDigest: string;
  storageProvider: string;
  objectKey: string;
  blobAlgorithm: string;
  blobKeyId: string;
  blobWrappedKey: string;
  blobIv: string;
  blobCiphertext: string;
  metadataAlgorithm: string;
  metadataKeyId: string;
  metadataWrappedKey: string;
  metadataIv: string;
  metadataCiphertext: string;
  thumbnailObjectKey: string | null;
  thumbnailMediaType: string | null;
  thumbnailByteLength: number | null;
  thumbnailContentDigest: string | null;
  thumbnailBlobAlgorithm: string | null;
  thumbnailBlobKeyId: string | null;
  thumbnailBlobWrappedKey: string | null;
  thumbnailBlobIv: string | null;
  thumbnailBlobCiphertext: string | null;
};

@Injectable()
export class ClinicalMediaVersioningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly storage: DocumentStorageService,
    private readonly envelope: DocumentsEnvelopeService,
    private readonly scanner: DocumentMalwareScannerService,
  ) {}

  async listVersions(principal: AuthPrincipal, mediaIdRaw: string) {
    const requested = await this.requireMedia(mediaIdRaw);
    await this.assertCanRead(principal, requested);
    const logicalMediaId = requested.logicalMediaId ?? requested.id;
    const [versions, current] = await Promise.all([
      this.prisma.clinicalMediaVersion.findMany({
        where: { logicalMediaId },
        orderBy: { version: "desc" },
        take: MAX_VERSION_ITEMS,
      }),
      this.prisma.clinicalMedia.findFirst({
        where: { logicalMediaId, status: "AVAILABLE" },
        select: { id: true, mediaVersion: true },
        orderBy: { mediaVersion: "desc" },
      }),
    ]);

    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "CLINICAL_MEDIA_VERSION_HISTORY_READ",
      objectType: "CLINICAL_MEDIA",
      objectId: logicalMediaId,
      purpose: principal.role === "PATIENT" ? "PATIENT_ACCESS" : CLINICAL_MEDIA_PURPOSE,
      result: "SUCCESS",
      metadata: { versionCount: versions.length },
    });

    return {
      logicalMediaId,
      currentMediaId: current?.id ?? null,
      currentVersion: current?.mediaVersion ?? null,
      items: versions.map((version) => ({
        id: version.id,
        mediaId: version.mediaId,
        version: version.version,
        mediaType: version.mediaType,
        effectiveDate: version.effectiveDate,
        sourceType: version.sourceType,
        sourceRef: version.sourceRef,
        contentDigest: version.contentDigest,
        thumbnailContentDigest: version.thumbnailContentDigest,
        consentEvidenceId: version.consentEvidenceId,
        supersedesMediaId: version.supersedesMediaId,
        createdAt: version.createdAt,
        current: version.mediaId === current?.id,
      })),
    };
  }

  async createVersion(principal: AuthPrincipal, mediaIdRaw: string, input: JsonObject) {
    const requested = await this.requireMedia(mediaIdRaw);
    await this.assertCanVersion(principal, requested);
    const expectedVersion = this.positiveInteger(input.expectedVersion, "expectedVersion");
    const effectiveDate = this.effectiveDate(input.effectiveDate);
    const payload = await this.preparePayload(input);
    const logicalMediaId = requested.logicalMediaId ?? requested.id;
    const sourceType = principal.role === "PATIENT" ? "PATIENT_UPLOAD" : "PROVIDER_CAPTURE";

    await this.storage.put(payload.objectKey, payload.blobCiphertext);
    try {
      if (payload.thumbnailObjectKey && payload.thumbnailBlobCiphertext) {
        await this.storage.put(payload.thumbnailObjectKey, payload.thumbnailBlobCiphertext);
      }

      const created = await this.prisma.$transaction(async (tx) => {
        await this.audit.reserveIntegrityChainForSerializableTransaction(tx);
        const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT "id"
          FROM "ClinicalMedia"
          WHERE "logicalMediaId" = ${logicalMediaId}
          ORDER BY "mediaVersion" DESC
          LIMIT 1
          FOR UPDATE
        `);
        const latestId = locked[0]?.id;
        if (!latestId) throw new NotFoundException("Clinical media version chain not found.");
        const latest = await tx.clinicalMedia.findUnique({ where: { id: latestId } });
        if (!latest) throw new NotFoundException("Clinical media version chain not found.");
        if (latest.id !== requested.id) throw new ConflictException("A newer clinical media version already exists.");
        if (latest.mediaVersion !== expectedVersion) throw new ConflictException("Clinical media version conflict.");
        if (latest.status !== "AVAILABLE") throw new ConflictException("Only the current available media can be versioned.");

        const consent = await this.assertCanVersionInTransaction(tx, principal, latest);
        const evidence = await tx.consentEvidence.create({
          data: {
            consentId: consent.id,
            patientId: latest.patientId,
            providerId: latest.providerId,
            scope: CLINICAL_MEDIA_SCOPE,
            version: CLINICAL_MEDIA_CONSENT_VERSION,
            purpose: CLINICAL_MEDIA_PURPOSE,
            consentState: "GRANTED",
            grantedAt: consent.grantedAt,
            expiresAt: consent.expiresAt,
            evidenceHash: this.consentEvidenceHash(consent),
          },
        });

        const createdMedia = await tx.clinicalMedia.create({
          data: {
            id: randomUUID(),
            patientId: latest.patientId,
            providerId: latest.providerId,
            consentEvidenceId: evidence.id,
            purpose: CLINICAL_MEDIA_PURPOSE,
            status: "AVAILABLE",
            logicalMediaId,
            mediaVersion: latest.mediaVersion + 1,
            effectiveDate,
            sourceType,
            sourceRef: null,
            supersedesMediaId: latest.id,
            mediaType: payload.mediaType,
            byteLength: payload.byteLength,
            contentDigest: payload.contentDigest,
            storageProvider: payload.storageProvider,
            objectKey: payload.objectKey,
            blobAlgorithm: payload.blobAlgorithm,
            blobKeyId: payload.blobKeyId,
            blobWrappedKey: payload.blobWrappedKey,
            blobIv: payload.blobIv,
            metadataAlgorithm: payload.metadataAlgorithm,
            metadataKeyId: payload.metadataKeyId,
            metadataWrappedKey: payload.metadataWrappedKey,
            metadataIv: payload.metadataIv,
            metadataCiphertext: payload.metadataCiphertext,
            thumbnailObjectKey: payload.thumbnailObjectKey,
            thumbnailMediaType: payload.thumbnailMediaType,
            thumbnailByteLength: payload.thumbnailByteLength,
            thumbnailContentDigest: payload.thumbnailContentDigest,
            thumbnailBlobAlgorithm: payload.thumbnailBlobAlgorithm,
            thumbnailBlobKeyId: payload.thumbnailBlobKeyId,
            thumbnailBlobWrappedKey: payload.thumbnailBlobWrappedKey,
            thumbnailBlobIv: payload.thumbnailBlobIv,
            createdByAccountId: principal.accountId,
          },
        });

        await tx.clinicalMedia.update({
          where: { id: latest.id },
          data: { status: "SUPERSEDED" },
        });

        await this.audit.writeClinicalInTransaction(tx, {
          actorId: principal.accountId,
          action: "CLINICAL_MEDIA_VERSION_CREATED",
          objectType: "CLINICAL_MEDIA",
          objectId: createdMedia.id,
          purpose: principal.role === "PATIENT" ? "PATIENT_ACCESS" : CLINICAL_MEDIA_PURPOSE,
          result: "SUCCESS",
          metadata: {
            logicalMediaId,
            version: createdMedia.mediaVersion,
            supersedesMediaId: latest.id,
            consentEvidenceId: evidence.id,
            mediaType: payload.mediaType,
            byteLength: payload.byteLength,
            thumbnail: Boolean(payload.thumbnailObjectKey),
          },
        });
        return createdMedia;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

      return this.presentCreated(created);
    } catch (error) {
      await Promise.all([
        this.storage.remove(payload.objectKey).catch(() => undefined),
        payload.thumbnailObjectKey
          ? this.storage.remove(payload.thumbnailObjectKey).catch(() => undefined)
          : Promise.resolve(),
      ]);
      throw error;
    }
  }

  private async preparePayload(input: JsonObject): Promise<VersionPayload> {
    const mediaType = this.requiredMediaType(input.mediaType, MEDIA_TYPES, "mediaType");
    const bytes = this.decodeBase64(input.contentBase64, MAX_MEDIA_BYTES, "contentBase64");
    this.assertMediaSignature(mediaType, bytes, "Clinical media");
    await this.scanner.assertClean(bytes);

    const thumbnail = this.optionalThumbnail(input);
    if (thumbnail) await this.scanner.assertClean(thumbnail.bytes);
    const metadata = this.metadata(input.metadata);
    const metadataEnvelope = await this.envelope.encryptMetadata({
      schemaVersion: 2,
      purpose: CLINICAL_MEDIA_PURPOSE,
      ...metadata,
    });
    const encryptedOriginal = await this.envelope.encryptBytes(bytes);
    const encryptedThumbnail = thumbnail ? await this.envelope.encryptBytes(thumbnail.bytes) : null;

    return {
      mediaType,
      byteLength: bytes.byteLength,
      contentDigest: this.digest(bytes),
      storageProvider: this.storage.storageProviderName(),
      objectKey: `clinical-media/${randomUUID()}.cpenc`,
      blobAlgorithm: encryptedOriginal.envelope.algorithm,
      blobKeyId: encryptedOriginal.envelope.keyId,
      blobWrappedKey: encryptedOriginal.envelope.wrappedKey,
      blobIv: encryptedOriginal.envelope.iv,
      blobCiphertext: encryptedOriginal.ciphertext,
      metadataAlgorithm: metadataEnvelope.algorithm,
      metadataKeyId: metadataEnvelope.keyId,
      metadataWrappedKey: metadataEnvelope.wrappedKey,
      metadataIv: metadataEnvelope.iv,
      metadataCiphertext: metadataEnvelope.ciphertext,
      thumbnailObjectKey: thumbnail ? `clinical-media/thumbnails/${randomUUID()}.cpenc` : null,
      thumbnailMediaType: thumbnail?.mediaType ?? null,
      thumbnailByteLength: thumbnail?.bytes.byteLength ?? null,
      thumbnailContentDigest: thumbnail ? this.digest(thumbnail.bytes) : null,
      thumbnailBlobAlgorithm: encryptedThumbnail?.envelope.algorithm ?? null,
      thumbnailBlobKeyId: encryptedThumbnail?.envelope.keyId ?? null,
      thumbnailBlobWrappedKey: encryptedThumbnail?.envelope.wrappedKey ?? null,
      thumbnailBlobIv: encryptedThumbnail?.envelope.iv ?? null,
      thumbnailBlobCiphertext: encryptedThumbnail?.ciphertext ?? null,
    };
  }

  private async assertCanRead(principal: AuthPrincipal, media: ClinicalMedia): Promise<void> {
    if (principal.role === "PATIENT") {
      const patient = await this.prisma.patientProfile.findUnique({
        where: { userId: principal.accountId },
        select: { id: true },
      });
      if (patient?.id === media.patientId) return;
      throw new ForbiddenException("Clinical media version history access denied.");
    }
    if (principal.role !== "DOCTOR" && principal.role !== "OTHER_PROVIDER") {
      throw new ForbiddenException("Clinical media version history access denied.");
    }
    const provider = await this.prisma.provider.findUnique({
      where: { userId: principal.accountId },
      select: { id: true, status: true },
    });
    if (!provider || provider.status !== "ACTIVE" || provider.id !== media.providerId) {
      throw new ForbiddenException("Clinical media version history access denied.");
    }
    await this.requireEffectiveConsentForMedia(this.prisma, media, provider.id);
  }

  private async assertCanVersion(principal: AuthPrincipal, media: ClinicalMedia): Promise<void> {
    if (principal.role === "PATIENT") {
      const patient = await this.prisma.patientProfile.findUnique({
        where: { userId: principal.accountId },
        select: { id: true },
      });
      if (!patient || patient.id !== media.patientId || media.providerId !== null || media.createdByAccountId !== principal.accountId) {
        throw new ForbiddenException("Patients can version only their own uploaded clinical media.");
      }
      await this.requireEffectiveConsentForMedia(this.prisma, media, null);
      return;
    }
    if (principal.role === "DOCTOR" || principal.role === "OTHER_PROVIDER") {
      const provider = await this.prisma.provider.findUnique({
        where: { userId: principal.accountId },
        select: { id: true, status: true },
      });
      if (!provider || provider.status !== "ACTIVE" || provider.id !== media.providerId) {
        throw new ForbiddenException("Only the active authoring provider can version this clinical media.");
      }
      await this.requireEffectiveConsentForMedia(this.prisma, media, provider.id);
      return;
    }
    throw new ForbiddenException("Clinical media versioning is not available to this role.");
  }

  private async assertCanVersionInTransaction(
    tx: Prisma.TransactionClient,
    principal: AuthPrincipal,
    media: ClinicalMedia,
  ): Promise<Consent> {
    if (principal.role === "PATIENT") {
      const patient = await tx.patientProfile.findUnique({
        where: { userId: principal.accountId },
        select: { id: true },
      });
      if (!patient || patient.id !== media.patientId || media.providerId !== null || media.createdByAccountId !== principal.accountId) {
        throw new ForbiddenException("Patients can version only their own uploaded clinical media.");
      }
      return this.requireEffectiveConsentForMedia(tx, media, null);
    }
    if (principal.role === "DOCTOR" || principal.role === "OTHER_PROVIDER") {
      const provider = await tx.provider.findUnique({
        where: { userId: principal.accountId },
        select: { id: true, status: true },
      });
      if (!provider || provider.status !== "ACTIVE" || provider.id !== media.providerId) {
        throw new ForbiddenException("Only the active authoring provider can version this clinical media.");
      }
      return this.requireEffectiveConsentForMedia(tx, media, provider.id);
    }
    throw new ForbiddenException("Clinical media versioning is not available to this role.");
  }

  private async requireEffectiveConsentForMedia(
    db: PrismaService | Prisma.TransactionClient,
    media: ClinicalMedia,
    providerId: string | null,
  ): Promise<Consent> {
    const evidence = await db.consentEvidence.findUnique({ where: { id: media.consentEvidenceId } });
    if (!evidence || evidence.patientId !== media.patientId || evidence.providerId !== providerId) {
      throw new ForbiddenException("Active clinical-media consent is required.");
    }
    const consent = await db.consent.findUnique({ where: { id: evidence.consentId } });
    if (!consent || !this.isEffectiveConsent(consent, media.patientId, providerId)) {
      throw new ForbiddenException("Active clinical-media consent is required.");
    }
    return consent;
  }

  private isEffectiveConsent(consent: Consent, patientId: string, providerId: string | null): boolean {
    return consent.patientId === patientId
      && consent.providerId === providerId
      && consent.scope === CLINICAL_MEDIA_SCOPE
      && consent.version === CLINICAL_MEDIA_CONSENT_VERSION
      && consent.purpose === CLINICAL_MEDIA_PURPOSE
      && consent.state === "GRANTED"
      && (!consent.expiresAt || consent.expiresAt.getTime() > Date.now());
  }

  private async requireMedia(mediaIdRaw: string): Promise<ClinicalMedia> {
    const mediaId = this.identifier(mediaIdRaw, "mediaId");
    const media = await this.prisma.clinicalMedia.findUnique({ where: { id: mediaId } });
    if (!media) throw new NotFoundException("Clinical media not found.");
    return media;
  }

  private presentCreated(media: ClinicalMedia) {
    return {
      id: media.id,
      logicalMediaId: media.logicalMediaId ?? media.id,
      version: media.mediaVersion,
      effectiveDate: media.effectiveDate,
      sourceType: media.sourceType,
      sourceRef: media.sourceRef,
      supersedesMediaId: media.supersedesMediaId,
      mediaType: media.mediaType,
      byteLength: media.byteLength,
      contentDigest: media.contentDigest,
      thumbnailAvailable: Boolean(media.thumbnailObjectKey),
      consentEvidenceId: media.consentEvidenceId,
      status: media.status,
      createdAt: media.createdAt,
    };
  }

  private metadata(value: unknown): JsonObject {
    if (value === undefined || value === null) return {};
    if (typeof value !== "object" || Array.isArray(value)) throw new BadRequestException("metadata must be an object.");
    const raw = value as JsonObject;
    for (const key of Object.keys(raw)) {
      if (!METADATA_KEYS.has(key)) throw new BadRequestException(`Clinical media metadata field '${key}' is not allowed.`);
    }
    const result: JsonObject = {};
    const title = this.optionalText(raw.title, 160, "metadata.title");
    const caption = this.optionalText(raw.caption, 500, "metadata.caption");
    const encounterRef = this.optionalText(raw.encounterRef, 128, "metadata.encounterRef");
    if (title) result.title = title;
    if (caption) result.caption = caption;
    if (encounterRef) result.encounterRef = encounterRef;
    if (raw.bodySiteCode !== undefined && raw.bodySiteCode !== null && raw.bodySiteCode !== "") {
      if (typeof raw.bodySiteCode !== "string") throw new BadRequestException("metadata.bodySiteCode must be a string.");
      const code = raw.bodySiteCode.trim().toUpperCase();
      if (!/^[A-Z0-9][A-Z0-9_.:-]{0,79}$/.test(code)) throw new BadRequestException("metadata.bodySiteCode is invalid.");
      result.bodySiteCode = code;
    }
    if (raw.capturedAt !== undefined && raw.capturedAt !== null && raw.capturedAt !== "") {
      if (typeof raw.capturedAt !== "string") throw new BadRequestException("metadata.capturedAt must be an ISO date-time string.");
      const capturedAt = new Date(raw.capturedAt);
      if (!Number.isFinite(capturedAt.getTime())) throw new BadRequestException("metadata.capturedAt is invalid.");
      if (capturedAt.getTime() > Date.now() + 5 * 60 * 1000) throw new BadRequestException("metadata.capturedAt cannot be materially in the future.");
      result.capturedAt = capturedAt.toISOString();
    }
    return result;
  }

  private optionalThumbnail(input: JsonObject): { mediaType: string; bytes: Uint8Array } | null {
    const hasContent = input.thumbnailBase64 !== undefined && input.thumbnailBase64 !== null && input.thumbnailBase64 !== "";
    const hasType = input.thumbnailMediaType !== undefined && input.thumbnailMediaType !== null && input.thumbnailMediaType !== "";
    if (!hasContent && !hasType) return null;
    if (!hasContent || !hasType) throw new BadRequestException("thumbnailBase64 and thumbnailMediaType must be supplied together.");
    const mediaType = this.requiredMediaType(input.thumbnailMediaType, THUMBNAIL_TYPES, "thumbnailMediaType");
    const bytes = this.decodeBase64(input.thumbnailBase64, MAX_THUMBNAIL_BYTES, "thumbnailBase64");
    this.assertMediaSignature(mediaType, bytes, "Clinical media thumbnail");
    return { mediaType, bytes };
  }

  private requiredMediaType(value: unknown, allowed: Set<string>, field: string): string {
    if (typeof value !== "string") throw new BadRequestException(`${field} is required.`);
    const normalized = value.trim().toLowerCase();
    if (!allowed.has(normalized)) throw new BadRequestException(`${field} is not supported.`);
    return normalized;
  }

  private decodeBase64(value: unknown, maxBytes: number, field: string): Uint8Array {
    if (typeof value !== "string" || value.length < 4) throw new BadRequestException(`${field} is required.`);
    const normalized = value.replace(/\s+/g, "");
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) || normalized.length % 4 !== 0) {
      throw new BadRequestException(`${field} must be canonical base64.`);
    }
    const bytes = Buffer.from(normalized, "base64");
    if (bytes.byteLength < 1 || bytes.byteLength > maxBytes) {
      throw new BadRequestException(`${field} must contain between 1 and ${maxBytes} bytes.`);
    }
    if (bytes.toString("base64") !== normalized) throw new BadRequestException(`${field} must be canonical base64.`);
    return Uint8Array.from(bytes);
  }

  private assertMediaSignature(mediaType: string, bytes: Uint8Array, label: string): void {
    const data = Buffer.from(bytes);
    const jpeg = data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
    const png = data.length >= 8
      && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47
      && data[4] === 0x0d && data[5] === 0x0a && data[6] === 0x1a && data[7] === 0x0a;
    const mp4 = data.length >= 12 && data.subarray(4, 8).toString("ascii") === "ftyp";
    const matches = mediaType === "image/jpeg" ? jpeg : mediaType === "image/png" ? png : mediaType === "video/mp4" ? mp4 : false;
    if (!matches) throw new BadRequestException(`${label} mediaType does not match its content signature.`);
  }

  private consentEvidenceHash(consent: Consent): string {
    const material = JSON.stringify({
      consentId: consent.id,
      patientId: consent.patientId,
      providerId: consent.providerId,
      scope: consent.scope,
      version: consent.version,
      purpose: consent.purpose,
      state: consent.state,
      grantedAt: consent.grantedAt.toISOString(),
      expiresAt: consent.expiresAt?.toISOString() ?? null,
    });
    return createHash("sha256").update(material, "utf8").digest("hex");
  }

  private digest(bytes: Uint8Array): string {
    return createHash("sha256").update(bytes).digest("hex");
  }

  private effectiveDate(value: unknown): Date {
    if (value === undefined || value === null || value === "") return new Date();
    if (typeof value !== "string") throw new BadRequestException("effectiveDate must be an ISO date-time string.");
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) throw new BadRequestException("effectiveDate is invalid.");
    if (parsed.getTime() > Date.now() + 5 * 60 * 1000) throw new BadRequestException("effectiveDate cannot be materially in the future.");
    return parsed;
  }

  private positiveInteger(value: unknown, field: string): number {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
      throw new BadRequestException(`${field} must be a positive integer.`);
    }
    return value;
  }

  private identifier(value: unknown, field: string): string {
    if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/.test(value.trim())) {
      throw new BadRequestException(`${field} is invalid.`);
    }
    return value.trim();
  }

  private optionalText(value: unknown, maxLength: number, field: string): string | null {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string") throw new BadRequestException(`${field} must be a string.`);
    const normalized = value.trim();
    if (!normalized || normalized.length > maxLength) throw new BadRequestException(`${field} is invalid.`);
    return normalized;
  }
}
