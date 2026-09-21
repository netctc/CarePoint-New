import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import type { ClinicalMedia, Consent } from "@prisma/client";
import type { EncryptedEnvelope } from "@carepoint/security";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { DocumentStorageService } from "./document-storage.service";
import { DocumentsEnvelopeService } from "./documents-envelope.service";
import { DocumentMalwareScannerService } from "./document-malware-scanner.service";

const CLINICAL_MEDIA_SCOPE = "CLINICAL_MEDIA_CAPTURE";
const CLINICAL_MEDIA_VERSION = "clinical-media-v1";
const CLINICAL_MEDIA_PURPOSE = "TREATMENT";
const MAX_MEDIA_BYTES = 8 * 1024 * 1024;
const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;
const ACCESS_GRANT_TTL_MS = 5 * 60 * 1000;
const MAX_LIST_ITEMS = 100;
const MEDIA_TYPES = new Set(["image/jpeg", "image/png", "video/mp4"]);
const THUMBNAIL_TYPES = new Set(["image/jpeg", "image/png"]);
const METADATA_KEYS = new Set(["title", "caption", "bodySiteCode", "capturedAt", "encounterRef"]);

type JsonObject = Record<string, unknown>;
type MediaVariant = "ORIGINAL" | "THUMBNAIL";
type ProviderContext = { id: string; class: "DOCTOR" | "OTHER_PROVIDER"; status: string };
type GrantPayload = { g: string; m: string; a: string; v: MediaVariant; e: number };

@Injectable()
export class ClinicalMediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly storage: DocumentStorageService,
    private readonly envelope: DocumentsEnvelopeService,
    private readonly scanner: DocumentMalwareScannerService,
  ) {}

  async patientCreate(principal: AuthPrincipal, input: JsonObject) {
    if (principal.role !== "PATIENT") throw new ForbiddenException("Patient clinical media creation requires a patient account.");
    const patient = await this.requirePatientForPrincipal(principal);
    const consentId = this.requiredId(input.consentId, "consentId");
    const purpose = this.requiredPurpose(input.purpose);
    const consent = await this.requireEffectiveConsent({
      consentId,
      patientId: patient.id,
      providerId: null,
      purpose,
    });
    return this.createMedia(principal, patient.id, null, consent, input);
  }

  async providerCreate(principal: AuthPrincipal, patientIdRaw: string, input: JsonObject) {
    const provider = await this.requireActiveProvider(principal);
    const patientId = this.requiredId(patientIdRaw, "patientId");
    await this.requirePatientById(patientId);
    const consentId = this.requiredId(input.consentId, "consentId");
    const purpose = this.requiredPurpose(input.purpose);
    const consent = await this.requireEffectiveConsent({
      consentId,
      patientId,
      providerId: provider.id,
      purpose,
    });
    return this.createMedia(principal, patientId, provider.id, consent, input);
  }

  async listMine(principal: AuthPrincipal) {
    if (principal.role !== "PATIENT") throw new ForbiddenException("Patient clinical media access requires a patient account.");
    const patient = await this.requirePatientForPrincipal(principal);
    const rows = await this.prisma.clinicalMedia.findMany({
      where: { patientId: patient.id, status: "AVAILABLE" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: MAX_LIST_ITEMS,
    });
    const items = await Promise.all(rows.map((row) => this.present(row, "PATIENT_SELF")));
    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "CLINICAL_MEDIA_LIST_READ",
      objectType: "PATIENT",
      objectId: patient.id,
      purpose: "PATIENT_ACCESS",
      result: "SUCCESS",
      metadata: { itemCount: items.length, accessBasis: "PATIENT_SELF" },
    });
    return { patientId: patient.id, accessBasis: "PATIENT_SELF" as const, items };
  }

  async listForProvider(principal: AuthPrincipal, patientIdRaw: string) {
    const provider = await this.requireActiveProvider(principal);
    const patientId = this.requiredId(patientIdRaw, "patientId");
    await this.requirePatientById(patientId);
    const rows = await this.prisma.clinicalMedia.findMany({
      where: { patientId, providerId: provider.id, status: "AVAILABLE" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: MAX_LIST_ITEMS,
    });
    const visible: ClinicalMedia[] = [];
    for (const row of rows) {
      if (await this.providerConsentStillEffective(row, provider.id)) visible.push(row);
    }
    const items = await Promise.all(visible.map((row) => this.present(row, "CONSENTED_PROVIDER")));
    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "CLINICAL_MEDIA_LIST_READ",
      objectType: "PATIENT",
      objectId: patientId,
      purpose: CLINICAL_MEDIA_PURPOSE,
      result: "SUCCESS",
      metadata: { itemCount: items.length, accessBasis: "CONSENTED_PROVIDER" },
    });
    return { patientId, providerId: provider.id, accessBasis: "CONSENTED_PROVIDER" as const, items };
  }

  async issueAccessGrant(principal: AuthPrincipal, mediaIdRaw: string, input: JsonObject) {
    const mediaId = this.requiredId(mediaIdRaw, "mediaId");
    const variant = this.variant(input.variant);
    const media = await this.requireAccessibleMedia(principal, mediaId);
    if (variant === "THUMBNAIL" && !media.thumbnailObjectKey) {
      throw new NotFoundException("Clinical media thumbnail is not available.");
    }

    const id = randomUUID();
    const expiresAt = new Date(Date.now() + ACCESS_GRANT_TTL_MS);
    const payload: GrantPayload = {
      g: id,
      m: media.id,
      a: principal.accountId,
      v: variant,
      e: expiresAt.getTime(),
    };
    const token = this.signGrant(payload);
    await this.prisma.clinicalMediaAccessGrant.create({
      data: {
        id,
        tokenHash: this.hashToken(token),
        mediaId: media.id,
        accountId: principal.accountId,
        variant,
        expiresAt,
      },
    });
    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "CLINICAL_MEDIA_ACCESS_GRANT_ISSUED",
      objectType: "CLINICAL_MEDIA",
      objectId: media.id,
      purpose: principal.role === "PATIENT" ? "PATIENT_ACCESS" : CLINICAL_MEDIA_PURPOSE,
      result: "SUCCESS",
      metadata: { variant, expiresInSeconds: ACCESS_GRANT_TTL_MS / 1000 },
    });
    return {
      mediaId: media.id,
      variant,
      token,
      expiresAt,
      expiresInSeconds: ACCESS_GRANT_TTL_MS / 1000,
      singleUse: true,
      signed: true,
    };
  }

  async consumeAccessGrant(principal: AuthPrincipal, mediaIdRaw: string, input: JsonObject) {
    const mediaId = this.requiredId(mediaIdRaw, "mediaId");
    const token = this.requiredToken(input.token);
    const payload = this.verifyGrant(token);
    if (payload.m !== mediaId || payload.a !== principal.accountId || payload.e <= Date.now()) {
      await this.auditGrantDenied(principal, mediaId, "SIGNED_GRANT_CONTEXT_MISMATCH");
      throw new ForbiddenException("Clinical media access grant is invalid or expired.");
    }

    const media = await this.requireAccessibleMedia(principal, mediaId);
    const now = new Date();
    const claimed = await this.prisma.clinicalMediaAccessGrant.updateMany({
      where: {
        id: payload.g,
        tokenHash: this.hashToken(token),
        mediaId,
        accountId: principal.accountId,
        variant: payload.v,
        consumedAt: null,
        expiresAt: { gt: now },
      },
      data: { consumedAt: now },
    });
    if (claimed.count !== 1) {
      await this.auditGrantDenied(principal, mediaId, "GRANT_INVALID_EXPIRED_OR_CONSUMED");
      throw new ForbiddenException("Clinical media access grant is invalid, expired or already consumed.");
    }

    const content = await this.readVariant(media, payload.v);
    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "CLINICAL_MEDIA_CONTENT_READ",
      objectType: "CLINICAL_MEDIA",
      objectId: media.id,
      purpose: principal.role === "PATIENT" ? "PATIENT_ACCESS" : CLINICAL_MEDIA_PURPOSE,
      result: "SUCCESS",
      metadata: { variant: payload.v, byteLength: content.bytes.byteLength },
    });
    return content;
  }

  async remove(principal: AuthPrincipal, mediaIdRaw: string) {
    const mediaId = this.requiredId(mediaIdRaw, "mediaId");
    const media = await this.prisma.clinicalMedia.findUnique({ where: { id: mediaId } });
    if (!media) throw new NotFoundException("Clinical media not found.");
    let allowed = false;
    let purpose = CLINICAL_MEDIA_PURPOSE;
    if (principal.role === "PATIENT") {
      const patient = await this.requirePatientForPrincipal(principal);
      allowed = media.patientId === patient.id;
      purpose = "PATIENT_ACCESS";
    } else if (principal.role === "DOCTOR" || principal.role === "OTHER_PROVIDER") {
      const provider = await this.requireActiveProvider(principal);
      allowed = media.providerId === provider.id && media.createdByAccountId === principal.accountId;
    }
    if (!allowed) {
      await this.audit.writeClinical({
        actorId: principal.accountId,
        action: "CLINICAL_MEDIA_REMOVE_DENIED",
        objectType: "CLINICAL_MEDIA",
        objectId: media.id,
        purpose,
        result: "DENIED",
      });
      throw new ForbiddenException("Clinical media removal denied.");
    }
    if (media.status === "REMOVED") return { id: media.id, status: media.status, removedAt: media.removedAt };
    const removedAt = new Date();
    const updated = await this.prisma.clinicalMedia.update({
      where: { id: media.id },
      data: { status: "REMOVED", removedAt },
    });
    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "CLINICAL_MEDIA_REMOVED",
      objectType: "CLINICAL_MEDIA",
      objectId: media.id,
      purpose,
      result: "SUCCESS",
      metadata: { encryptedObjectsRetainedForGovernedCleanup: true },
    });
    return { id: updated.id, status: updated.status, removedAt: updated.removedAt };
  }

  private async createMedia(
    principal: AuthPrincipal,
    patientId: string,
    providerId: string | null,
    consent: Consent,
    input: JsonObject,
  ) {
    const mediaType = this.requiredMediaType(input.mediaType, MEDIA_TYPES, "mediaType");
    const bytes = this.decodeBase64(input.contentBase64, MAX_MEDIA_BYTES, "contentBase64");
    this.assertMediaSignature(mediaType, bytes, "Clinical media");
    await this.scanner.assertClean(bytes);

    const thumbnail = this.optionalThumbnail(input);
    if (thumbnail) await this.scanner.assertClean(thumbnail.bytes);
    const metadata = this.metadata(input.metadata);
    const evidenceHash = this.consentEvidenceHash(consent);
    const metadataEnvelope = await this.envelope.encryptMetadata({
      schemaVersion: 1,
      purpose: CLINICAL_MEDIA_PURPOSE,
      ...metadata,
    });
    const encryptedOriginal = await this.envelope.encryptBytes(bytes);
    const encryptedThumbnail = thumbnail ? await this.envelope.encryptBytes(thumbnail.bytes) : null;
    const objectKey = `clinical-media/${randomUUID()}.cpenc`;
    const thumbnailObjectKey = thumbnail ? `clinical-media/thumbnails/${randomUUID()}.cpenc` : null;

    await this.storage.put(objectKey, encryptedOriginal.ciphertext);
    try {
      if (thumbnailObjectKey && encryptedThumbnail) {
        await this.storage.put(thumbnailObjectKey, encryptedThumbnail.ciphertext);
      }
      const media = await this.prisma.$transaction(async (tx) => {
        const evidence = await tx.consentEvidence.create({
          data: {
            consentId: consent.id,
            patientId,
            providerId,
            scope: CLINICAL_MEDIA_SCOPE,
            version: CLINICAL_MEDIA_VERSION,
            purpose: CLINICAL_MEDIA_PURPOSE,
            consentState: "GRANTED",
            grantedAt: consent.grantedAt,
            expiresAt: consent.expiresAt,
            evidenceHash,
          },
        });
        const created = await tx.clinicalMedia.create({
          data: {
            patientId,
            providerId,
            consentEvidenceId: evidence.id,
            purpose: CLINICAL_MEDIA_PURPOSE,
            mediaType,
            byteLength: bytes.byteLength,
            contentDigest: this.digest(bytes),
            storageProvider: this.storage.storageProviderName(),
            objectKey,
            blobAlgorithm: encryptedOriginal.envelope.algorithm,
            blobKeyId: encryptedOriginal.envelope.keyId,
            blobWrappedKey: encryptedOriginal.envelope.wrappedKey,
            blobIv: encryptedOriginal.envelope.iv,
            metadataAlgorithm: metadataEnvelope.algorithm,
            metadataKeyId: metadataEnvelope.keyId,
            metadataWrappedKey: metadataEnvelope.wrappedKey,
            metadataIv: metadataEnvelope.iv,
            metadataCiphertext: metadataEnvelope.ciphertext,
            ...(thumbnail && encryptedThumbnail && thumbnailObjectKey ? {
              thumbnailObjectKey,
              thumbnailMediaType: thumbnail.mediaType,
              thumbnailByteLength: thumbnail.bytes.byteLength,
              thumbnailContentDigest: this.digest(thumbnail.bytes),
              thumbnailBlobAlgorithm: encryptedThumbnail.envelope.algorithm,
              thumbnailBlobKeyId: encryptedThumbnail.envelope.keyId,
              thumbnailBlobWrappedKey: encryptedThumbnail.envelope.wrappedKey,
              thumbnailBlobIv: encryptedThumbnail.envelope.iv,
            } : {}),
            createdByAccountId: principal.accountId,
          },
        });
        await this.audit.writeClinicalInTransaction(tx, {
          actorId: principal.accountId,
          action: "CLINICAL_MEDIA_CREATED",
          objectType: "CLINICAL_MEDIA",
          objectId: created.id,
          purpose: CLINICAL_MEDIA_PURPOSE,
          result: "SUCCESS",
          metadata: {
            mediaType,
            byteLength: bytes.byteLength,
            thumbnail: Boolean(thumbnail),
            consentEvidenceId: evidence.id,
            providerScoped: Boolean(providerId),
          },
        });
        return created;
      });
      return this.present(media, principal.role === "PATIENT" ? "PATIENT_SELF" : "CONSENTED_PROVIDER");
    } catch (error) {
      await Promise.all([
        this.storage.remove(objectKey).catch(() => undefined),
        thumbnailObjectKey ? this.storage.remove(thumbnailObjectKey).catch(() => undefined) : Promise.resolve(),
      ]);
      throw error;
    }
  }

  private async requireAccessibleMedia(principal: AuthPrincipal, mediaId: string): Promise<ClinicalMedia> {
    const media = await this.prisma.clinicalMedia.findFirst({ where: { id: mediaId, status: "AVAILABLE" } });
    if (!media) throw new NotFoundException("Clinical media not found.");
    if (principal.role === "PATIENT") {
      const patient = await this.requirePatientForPrincipal(principal);
      if (media.patientId === patient.id) return media;
    } else if (principal.role === "DOCTOR" || principal.role === "OTHER_PROVIDER") {
      const provider = await this.requireActiveProvider(principal);
      if (media.providerId === provider.id && await this.providerConsentStillEffective(media, provider.id)) return media;
    }
    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "CLINICAL_MEDIA_ACCESS_DENIED",
      objectType: "CLINICAL_MEDIA",
      objectId: media.id,
      purpose: principal.role === "PATIENT" ? "PATIENT_ACCESS" : CLINICAL_MEDIA_PURPOSE,
      result: "DENIED",
    });
    throw new ForbiddenException("Clinical media access denied.");
  }

  private async providerConsentStillEffective(media: ClinicalMedia, providerId: string): Promise<boolean> {
    const evidence = await this.prisma.consentEvidence.findUnique({ where: { id: media.consentEvidenceId } });
    if (!evidence || evidence.providerId !== providerId || evidence.patientId !== media.patientId) return false;
    const consent = await this.prisma.consent.findUnique({ where: { id: evidence.consentId } });
    if (!consent) return false;
    return this.isEffectiveConsent(consent, media.patientId, providerId, CLINICAL_MEDIA_PURPOSE);
  }

  private async requireEffectiveConsent(input: {
    consentId: string;
    patientId: string;
    providerId: string | null;
    purpose: string;
  }): Promise<Consent> {
    const consent = await this.prisma.consent.findUnique({ where: { id: input.consentId } });
    if (!consent || !this.isEffectiveConsent(consent, input.patientId, input.providerId, input.purpose)) {
      throw new ForbiddenException("An active matching clinical-media consent is required.");
    }
    return consent;
  }

  private isEffectiveConsent(consent: Consent, patientId: string, providerId: string | null, purpose: string): boolean {
    const now = Date.now();
    return consent.patientId === patientId
      && consent.providerId === providerId
      && consent.scope === CLINICAL_MEDIA_SCOPE
      && consent.version === CLINICAL_MEDIA_VERSION
      && consent.purpose === purpose
      && consent.state === "GRANTED"
      && (!consent.expiresAt || consent.expiresAt.getTime() > now);
  }

  private async present(media: ClinicalMedia, accessBasis: "PATIENT_SELF" | "CONSENTED_PROVIDER") {
    const [metadata, evidence] = await Promise.all([
      this.envelope.decryptMetadata<JsonObject>(this.metadataEnvelope(media)),
      this.prisma.consentEvidence.findUnique({ where: { id: media.consentEvidenceId } }),
    ]);
    if (!evidence) throw new ConflictException("Clinical media consent evidence is missing.");
    return {
      id: media.id,
      patientId: media.patientId,
      providerId: media.providerId,
      purpose: media.purpose,
      status: media.status,
      mediaType: media.mediaType,
      byteLength: media.byteLength,
      thumbnailAvailable: Boolean(media.thumbnailObjectKey),
      thumbnailMediaType: media.thumbnailMediaType,
      createdAt: media.createdAt,
      accessBasis,
      metadata,
      consentEvidence: {
        id: evidence.id,
        scope: evidence.scope,
        version: evidence.version,
        purpose: evidence.purpose,
        grantedAt: evidence.grantedAt,
        expiresAt: evidence.expiresAt,
        capturedAt: evidence.capturedAt,
      },
    };
  }

  private async readVariant(media: ClinicalMedia, variant: MediaVariant) {
    const original = variant === "ORIGINAL";
    const objectKey = original ? media.objectKey : media.thumbnailObjectKey;
    const algorithm = original ? media.blobAlgorithm : media.thumbnailBlobAlgorithm;
    const keyId = original ? media.blobKeyId : media.thumbnailBlobKeyId;
    const wrappedKey = original ? media.blobWrappedKey : media.thumbnailBlobWrappedKey;
    const iv = original ? media.blobIv : media.thumbnailBlobIv;
    const expectedDigest = original ? media.contentDigest : media.thumbnailContentDigest;
    const mediaType = original ? media.mediaType : media.thumbnailMediaType;
    if (!objectKey || !algorithm || !keyId || !wrappedKey || !iv || !expectedDigest || !mediaType) {
      throw new NotFoundException(variant === "THUMBNAIL" ? "Clinical media thumbnail is not available." : "Clinical media content envelope is incomplete.");
    }
    const ciphertext = await this.storage.get(objectKey);
    const bytes = await this.envelope.decryptBytes(this.blobEnvelope(algorithm, keyId, wrappedKey, iv, ciphertext));
    if (this.digest(bytes) !== expectedDigest) throw new ConflictException("Clinical media integrity check failed.");
    return {
      bytes: Buffer.from(bytes),
      mediaType,
      variant,
      fileName: this.fileName(media.id, mediaType, variant),
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

  private requiredPurpose(value: unknown): string {
    if (typeof value !== "string" || value.trim().toUpperCase() !== CLINICAL_MEDIA_PURPOSE) {
      throw new BadRequestException(`purpose must be ${CLINICAL_MEDIA_PURPOSE}.`);
    }
    return CLINICAL_MEDIA_PURPOSE;
  }

  private variant(value: unknown): MediaVariant {
    if (value === undefined || value === null || value === "") return "ORIGINAL";
    if (value === "ORIGINAL" || value === "THUMBNAIL") return value;
    throw new BadRequestException("variant must be ORIGINAL or THUMBNAIL.");
  }

  private signGrant(payload: GrantPayload): string {
    const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const signature = createHmac("sha256", this.signingSecret()).update(encoded, "utf8").digest("base64url");
    return `${encoded}.${signature}`;
  }

  private verifyGrant(token: string): GrantPayload {
    const parts = token.split(".");
    if (parts.length !== 2) throw new ForbiddenException("Clinical media access grant is invalid.");
    const encoded = parts[0];
    const supplied = parts[1];
    if (!encoded || !supplied) throw new ForbiddenException("Clinical media access grant is invalid.");
    const expected = createHmac("sha256", this.signingSecret()).update(encoded, "utf8").digest("base64url");
    const suppliedBytes = Buffer.from(supplied, "utf8");
    const expectedBytes = Buffer.from(expected, "utf8");
    if (suppliedBytes.byteLength !== expectedBytes.byteLength || !timingSafeEqual(suppliedBytes, expectedBytes)) {
      throw new ForbiddenException("Clinical media access grant signature is invalid.");
    }
    let raw: unknown;
    try {
      raw = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    } catch {
      throw new ForbiddenException("Clinical media access grant payload is invalid.");
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ForbiddenException("Clinical media access grant payload is invalid.");
    const value = raw as Record<string, unknown>;
    if (
      typeof value.g !== "string"
      || typeof value.m !== "string"
      || typeof value.a !== "string"
      || (value.v !== "ORIGINAL" && value.v !== "THUMBNAIL")
      || typeof value.e !== "number"
      || !Number.isSafeInteger(value.e)
    ) throw new ForbiddenException("Clinical media access grant payload is invalid.");
    return { g: value.g, m: value.m, a: value.a, v: value.v, e: value.e };
  }

  private signingSecret(): string {
    const secret = process.env.CLINICAL_MEDIA_ACCESS_SIGNING_SECRET?.trim();
    if (secret && Buffer.byteLength(secret, "utf8") >= 32) return secret;
    if (process.env.NODE_ENV === "production") {
      throw new InternalServerErrorException("CLINICAL_MEDIA_ACCESS_SIGNING_SECRET must contain at least 32 bytes in production.");
    }
    return "carepoint-clinical-media-nonproduction-signing-secret-v1";
  }

  private requiredToken(value: unknown): string {
    if (typeof value !== "string") throw new BadRequestException("token is required.");
    const token = value.trim();
    if (token.length < 80 || token.length > 1200 || !/^[A-Za-z0-9_.-]+$/.test(token)) {
      throw new BadRequestException("Clinical media access token is invalid.");
    }
    return token;
  }

  private hashToken(token: string): string {
    return createHash("sha256").update(token, "utf8").digest("hex");
  }

  private digest(bytes: Uint8Array): string {
    return createHash("sha256").update(bytes).digest("hex");
  }

  private metadataEnvelope(media: ClinicalMedia): EncryptedEnvelope {
    if (media.metadataAlgorithm !== "AES-256-GCM") throw new ConflictException("Unsupported clinical media metadata encryption algorithm.");
    return {
      version: 1,
      algorithm: "AES-256-GCM",
      keyId: media.metadataKeyId,
      wrappedKey: media.metadataWrappedKey,
      iv: media.metadataIv,
      ciphertext: media.metadataCiphertext,
    };
  }

  private blobEnvelope(algorithm: string, keyId: string, wrappedKey: string, iv: string, ciphertext: string): EncryptedEnvelope {
    if (algorithm !== "AES-256-GCM") throw new ConflictException("Unsupported clinical media encryption algorithm.");
    return { version: 1, algorithm: "AES-256-GCM", keyId, wrappedKey, iv, ciphertext };
  }

  private fileName(mediaId: string, mediaType: string, variant: MediaVariant): string {
    const extension = mediaType === "image/jpeg" ? "jpg" : mediaType === "image/png" ? "png" : mediaType === "video/mp4" ? "mp4" : "bin";
    return `carepoint-media-${mediaId}${variant === "THUMBNAIL" ? "-thumbnail" : ""}.${extension}`;
  }

  private requiredId(value: unknown, field: string): string {
    if (typeof value !== "string") throw new BadRequestException(`${field} is required.`);
    const id = value.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(id)) throw new BadRequestException(`${field} is invalid.`);
    return id;
  }

  private optionalText(value: unknown, max: number, field: string): string | null {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string") throw new BadRequestException(`${field} must be a string.`);
    const text = value.trim();
    if (!text || text.length > max) throw new BadRequestException(`${field} exceeds ${max} characters.`);
    return text;
  }

  private async requirePatientForPrincipal(principal: AuthPrincipal) {
    const patient = await this.prisma.patientProfile.findUnique({
      where: { userId: principal.accountId },
      select: { id: true },
    });
    if (!patient) throw new NotFoundException("Patient profile not found.");
    return patient;
  }

  private async requirePatientById(patientId: string): Promise<void> {
    const patient = await this.prisma.patientProfile.findUnique({ where: { id: patientId }, select: { id: true } });
    if (!patient) throw new NotFoundException("Patient profile not found.");
  }

  private async requireActiveProvider(principal: AuthPrincipal): Promise<ProviderContext> {
    if (principal.role !== "DOCTOR" && principal.role !== "OTHER_PROVIDER") {
      throw new ForbiddenException("Clinical media provider access requires a provider account.");
    }
    const provider = await this.prisma.provider.findUnique({
      where: { userId: principal.accountId },
      select: { id: true, class: true, status: true },
    });
    if (!provider || provider.status !== "ACTIVE") throw new ForbiddenException("An active provider profile is required.");
    return provider as ProviderContext;
  }

  private async auditGrantDenied(principal: AuthPrincipal, mediaId: string, reason: string): Promise<void> {
    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "CLINICAL_MEDIA_ACCESS_DENIED",
      objectType: "CLINICAL_MEDIA",
      objectId: mediaId,
      purpose: principal.role === "PATIENT" ? "PATIENT_ACCESS" : CLINICAL_MEDIA_PURPOSE,
      result: "DENIED",
      metadata: { reason },
    });
  }
}
