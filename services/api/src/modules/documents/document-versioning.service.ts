import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, type ClinicalDocument } from "@prisma/client";
import type { AuthPrincipal } from "@carepoint/identity";
import { createHash, randomUUID } from "node:crypto";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { DocumentStorageService } from "./document-storage.service";
import { DocumentsEnvelopeService } from "./documents-envelope.service";
import { DocumentMalwareScannerService } from "./document-malware-scanner.service";
import { DicomWebService } from "./dicomweb.service";

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const ALLOWED_MEDIA_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "application/dicom", "text/plain"]);
const DOCUMENT_CONSENT_SCOPE = "CLINICAL_DOCUMENT_READ";
const DOCUMENT_CONSENT_VERSION = "clinical-documents-v1";
const TREATMENT_LOOKBACK_DAYS = 365;
const TREATMENT_LOOKAHEAD_DAYS = 30;

type JsonObject = Record<string, unknown>;
type VersionPayload = {
  storageMode: "ENCRYPTED_BLOB" | "EXTERNAL_REFERENCE";
  storageProvider: string;
  objectKey: string | null;
  mediaType: string | null;
  byteLength: number | null;
  contentDigest: string;
  blobAlgorithm: string | null;
  blobKeyId: string | null;
  blobWrappedKey: string | null;
  blobIv: string | null;
  metadataAlgorithm: string;
  metadataKeyId: string;
  metadataWrappedKey: string;
  metadataIv: string;
  metadataCiphertext: string;
};

@Injectable()
export class DocumentVersioningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly storage: DocumentStorageService,
    private readonly envelope: DocumentsEnvelopeService,
    private readonly scanner: DocumentMalwareScannerService,
    private readonly dicomweb: DicomWebService,
  ) {}

  async listVersions(principal: AuthPrincipal, documentId: string) {
    const requested = await this.requireDocument(documentId);
    await this.assertCanRead(principal, requested);
    const versions = await this.prisma.documentVersion.findMany({
      where: { logicalDocumentId: requested.logicalDocumentId },
      orderBy: { version: "desc" },
      take: 100,
    });
    const current = await this.prisma.clinicalDocument.findFirst({
      where: { logicalDocumentId: requested.logicalDocumentId },
      select: { id: true, documentVersion: true, status: true },
      orderBy: { documentVersion: "desc" },
    });
    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "CLINICAL_DOCUMENT_VERSION_HISTORY_READ",
      objectType: "CLINICAL_DOCUMENT",
      objectId: requested.logicalDocumentId,
      purpose: principal.role === "PATIENT" ? "PATIENT_ACCESS" : "TREATMENT",
      result: "SUCCESS",
      metadata: { versionCount: versions.length },
    });
    return {
      logicalDocumentId: requested.logicalDocumentId,
      currentDocumentId: current?.id ?? null,
      currentVersion: current?.documentVersion ?? null,
      items: versions.map((version) => ({
        id: version.id,
        documentId: version.documentId,
        version: version.version,
        documentType: version.documentType,
        effectiveDate: version.effectiveDate,
        sourceType: version.sourceType,
        sourceRef: version.sourceRef,
        hashAlgorithm: version.hashAlgorithm,
        versionHash: version.versionHash,
        encounterRef: version.encounterRef,
        orderId: version.orderId,
        supersedesDocumentId: version.supersedesDocumentId,
        createdAt: version.createdAt,
        current: version.documentId === current?.id,
      })),
    };
  }

  async createVersion(principal: AuthPrincipal, documentId: string, input: JsonObject) {
    const requested = await this.requireDocument(documentId);
    await this.assertCanVersion(principal, requested);
    const expectedVersion = this.positiveInteger(input.expectedVersion, "expectedVersion");
    const effectiveDate = this.effectiveDate(input.effectiveDate);
    const payload = requested.storageMode === "EXTERNAL_REFERENCE"
      ? await this.prepareReferencePayload(input)
      : await this.prepareBinaryPayload(input);
    const sourceType = principal.role === "PATIENT" ? "PATIENT_UPLOAD" : "PROVIDER_UPLOAD";
    const sourceRef = requested.encounterRef ?? requested.orderId ?? null;
    let storedObjectKey: string | null = null;
    if (payload.objectKey) {
      await this.storage.put(payload.objectKey, (payload as VersionPayload & { blobCiphertext?: string }).blobCiphertext ?? "");
      storedObjectKey = payload.objectKey;
    }

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        await this.audit.reserveIntegrityChainForSerializableTransaction(tx);
        const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT "id"
          FROM "ClinicalDocument"
          WHERE "logicalDocumentId" = ${requested.logicalDocumentId}
          ORDER BY "documentVersion" DESC
          LIMIT 1
          FOR UPDATE
        `);
        const latestId = locked[0]?.id;
        if (!latestId) throw new NotFoundException("Clinical document version chain not found.");
        const latest = await tx.clinicalDocument.findUnique({ where: { id: latestId } });
        if (!latest) throw new NotFoundException("Clinical document version chain not found.");
        if (latest.id !== requested.id) throw new ConflictException("A newer clinical document version already exists.");
        if (latest.documentVersion !== expectedVersion) throw new ConflictException("Clinical document version conflict.");
        if (latest.status !== "AVAILABLE") throw new ConflictException("Only the current available document can be versioned.");
        await this.assertCanVersionInTransaction(tx, principal, latest);

        const newDocumentId = randomUUID();
        const nextVersion = latest.documentVersion + 1;
        const createdDocument = await tx.clinicalDocument.create({
          data: {
            id: newDocumentId,
            patientId: latest.patientId,
            providerId: latest.providerId,
            encounterRef: latest.encounterRef,
            orderId: latest.orderId,
            kind: latest.kind,
            status: "AVAILABLE",
            logicalDocumentId: latest.logicalDocumentId,
            documentVersion: nextVersion,
            effectiveDate,
            sourceType,
            sourceRef,
            supersedesDocumentId: latest.id,
            storageMode: payload.storageMode,
            storageProvider: payload.storageProvider,
            objectKey: payload.objectKey,
            mediaType: payload.mediaType,
            byteLength: payload.byteLength,
            contentDigest: payload.contentDigest,
            blobAlgorithm: payload.blobAlgorithm,
            blobKeyId: payload.blobKeyId,
            blobWrappedKey: payload.blobWrappedKey,
            blobIv: payload.blobIv,
            metadataAlgorithm: payload.metadataAlgorithm,
            metadataKeyId: payload.metadataKeyId,
            metadataWrappedKey: payload.metadataWrappedKey,
            metadataIv: payload.metadataIv,
            metadataCiphertext: payload.metadataCiphertext,
            releasedToPatient: principal.role === "PATIENT",
            releasedAt: principal.role === "PATIENT" ? new Date() : null,
            createdByAccountId: principal.accountId,
          },
        });
        await tx.clinicalDocument.update({
          where: { id: latest.id },
          data: { status: "SUPERSEDED" },
        });
        await this.audit.writeClinicalInTransaction(tx, {
          actorId: principal.accountId,
          action: "CLINICAL_DOCUMENT_VERSION_CREATED",
          objectType: "CLINICAL_DOCUMENT",
          objectId: createdDocument.id,
          purpose: principal.role === "PATIENT" ? "PATIENT_ACCESS" : "TREATMENT",
          result: "SUCCESS",
          metadata: {
            logicalDocumentId: latest.logicalDocumentId,
            version: nextVersion,
            supersedesDocumentId: latest.id,
            sourceType,
            storageMode: payload.storageMode,
          },
        });
        return createdDocument;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

      return this.presentVersion(created);
    } catch (error) {
      if (storedObjectKey) await this.storage.remove(storedObjectKey).catch(() => undefined);
      throw error;
    }
  }

  private async prepareBinaryPayload(input: JsonObject): Promise<VersionPayload & { blobCiphertext: string }> {
    const mediaType = this.requiredText(input.mediaType, 200, "mediaType").toLowerCase();
    if (!ALLOWED_MEDIA_TYPES.has(mediaType)) throw new BadRequestException("Unsupported clinical document mediaType.");
    const bytes = this.decodeBase64(input.contentBase64);
    if (bytes.byteLength < 1 || bytes.byteLength > MAX_FILE_BYTES) {
      throw new BadRequestException(`Clinical document must contain between 1 and ${MAX_FILE_BYTES} bytes.`);
    }
    const scan = await this.scanner.assertClean(bytes, mediaType);
    const metadata = await this.envelope.encryptMetadata({
      schemaVersion: 2,
      fileName: this.requiredText(input.fileName, 500, "fileName"),
      title: this.optionalText(input.title, 500),
      description: this.optionalText(input.description, 4000),
    });
    const encryptedBlob = await this.envelope.encryptBytes(bytes);
    const objectKey = `clinical/${randomUUID()}.cpenc`;
    return {
      storageMode: "ENCRYPTED_BLOB",
      storageProvider: this.storage.storageProviderName(),
      objectKey,
      mediaType: scan.detectedMediaType,
      byteLength: bytes.byteLength,
      contentDigest: scan.contentDigest,
      blobAlgorithm: encryptedBlob.envelope.algorithm,
      blobKeyId: encryptedBlob.envelope.keyId,
      blobWrappedKey: encryptedBlob.envelope.wrappedKey,
      blobIv: encryptedBlob.envelope.iv,
      metadataAlgorithm: metadata.algorithm,
      metadataKeyId: metadata.keyId,
      metadataWrappedKey: metadata.wrappedKey,
      metadataIv: metadata.iv,
      metadataCiphertext: metadata.ciphertext,
      blobCiphertext: encryptedBlob.ciphertext,
    };
  }

  private async prepareReferencePayload(input: JsonObject): Promise<VersionPayload> {
    const title = this.requiredText(input.title, 500, "title");
    const description = this.optionalText(input.description, 4000);
    const externalReference = this.dicomweb.normalizeReference(input);
    const canonical = JSON.stringify({ schemaVersion: 2, title, description, externalReference });
    const metadata = await this.envelope.encryptMetadata({ schemaVersion: 2, title, description, externalReference });
    return {
      storageMode: "EXTERNAL_REFERENCE",
      storageProvider: "DICOMWEB_REFERENCE",
      objectKey: null,
      mediaType: null,
      byteLength: null,
      contentDigest: createHash("sha256").update(canonical).digest("hex"),
      blobAlgorithm: null,
      blobKeyId: null,
      blobWrappedKey: null,
      blobIv: null,
      metadataAlgorithm: metadata.algorithm,
      metadataKeyId: metadata.keyId,
      metadataWrappedKey: metadata.wrappedKey,
      metadataIv: metadata.iv,
      metadataCiphertext: metadata.ciphertext,
    };
  }

  private async assertCanVersion(principal: AuthPrincipal, document: ClinicalDocument): Promise<void> {
    if (principal.role === "PATIENT") {
      const patient = await this.prisma.patientProfile.findUnique({ where: { userId: principal.accountId }, select: { id: true } });
      if (!patient || patient.id !== document.patientId || document.createdByAccountId !== principal.accountId || document.kind !== "PATIENT_UPLOAD") {
        throw new ForbiddenException("Patients can version only their own uploaded documents.");
      }
      return;
    }
    if (principal.role === "DOCTOR" || principal.role === "OTHER_PROVIDER") {
      const provider = await this.prisma.provider.findUnique({ where: { userId: principal.accountId }, select: { id: true, status: true } });
      if (!provider || provider.status !== "ACTIVE" || provider.id !== document.providerId) {
        throw new ForbiddenException("Only the active authoring provider can version this document.");
      }
      return;
    }
    throw new ForbiddenException("Clinical document versioning is not available to this role.");
  }

  private async assertCanVersionInTransaction(tx: Prisma.TransactionClient, principal: AuthPrincipal, document: ClinicalDocument): Promise<void> {
    if (principal.role === "PATIENT") {
      const patient = await tx.patientProfile.findUnique({ where: { userId: principal.accountId }, select: { id: true } });
      if (!patient || patient.id !== document.patientId || document.createdByAccountId !== principal.accountId || document.kind !== "PATIENT_UPLOAD") {
        throw new ForbiddenException("Patients can version only their own uploaded documents.");
      }
      return;
    }
    if (principal.role === "DOCTOR" || principal.role === "OTHER_PROVIDER") {
      const provider = await tx.provider.findUnique({ where: { userId: principal.accountId }, select: { id: true, status: true } });
      if (!provider || provider.status !== "ACTIVE" || provider.id !== document.providerId) {
        throw new ForbiddenException("Only the active authoring provider can version this document.");
      }
      return;
    }
    throw new ForbiddenException("Clinical document versioning is not available to this role.");
  }

  private async assertCanRead(principal: AuthPrincipal, document: ClinicalDocument): Promise<void> {
    if (principal.role === "PATIENT") {
      const patient = await this.prisma.patientProfile.findUnique({ where: { userId: principal.accountId }, select: { id: true } });
      if (!patient || patient.id !== document.patientId || (!document.releasedToPatient && document.createdByAccountId !== principal.accountId)) {
        throw new ForbiddenException("Clinical document version history access denied.");
      }
      return;
    }
    if (principal.role !== "DOCTOR" && principal.role !== "OTHER_PROVIDER") {
      throw new ForbiddenException("Clinical document version history access denied.");
    }
    const provider = await this.prisma.provider.findUnique({ where: { userId: principal.accountId }, select: { id: true, status: true } });
    if (!provider || provider.status !== "ACTIVE") throw new ForbiddenException("An active provider profile is required.");
    if (provider.id === document.providerId) return;
    const now = new Date();
    const relationship = await this.prisma.appointment.findFirst({
      where: {
        providerId: provider.id,
        patientId: document.patientId,
        status: { in: ["CONFIRMED", "COMPLETED"] },
        startsAt: {
          gte: new Date(now.getTime() - TREATMENT_LOOKBACK_DAYS * 86_400_000),
          lte: new Date(now.getTime() + TREATMENT_LOOKAHEAD_DAYS * 86_400_000),
        },
      },
      select: { id: true },
    });
    if (relationship) return;
    const consent = await this.prisma.consent.findFirst({
      where: {
        patientId: document.patientId,
        scope: DOCUMENT_CONSENT_SCOPE,
        state: "GRANTED",
        AND: [
          { OR: [{ providerId: provider.id }, { providerId: null }] },
          { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        ],
      },
      select: { version: true },
      orderBy: { grantedAt: "desc" },
    });
    if (consent?.version !== DOCUMENT_CONSENT_VERSION) throw new ForbiddenException("Clinical document version history access denied.");
  }

  private async requireDocument(documentId: string): Promise<ClinicalDocument> {
    const document = await this.prisma.clinicalDocument.findUnique({ where: { id: this.identifier(documentId, "documentId") } });
    if (!document) throw new NotFoundException("Clinical document not found.");
    return document;
  }

  private presentVersion(document: ClinicalDocument) {
    return {
      id: document.id,
      logicalDocumentId: document.logicalDocumentId,
      version: document.documentVersion,
      effectiveDate: document.effectiveDate,
      sourceType: document.sourceType,
      sourceRef: document.sourceRef,
      supersedesDocumentId: document.supersedesDocumentId,
      kind: document.kind,
      status: document.status,
      storageMode: document.storageMode,
      contentDigest: document.contentDigest,
      releasedToPatient: document.releasedToPatient,
      createdAt: document.createdAt,
    };
  }

  private effectiveDate(value: unknown): Date {
    if (value === undefined || value === null || value === "") return new Date();
    if (typeof value !== "string") throw new BadRequestException("effectiveDate must be an ISO datetime.");
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) throw new BadRequestException("effectiveDate must be an ISO datetime.");
    if (parsed.getTime() > Date.now() + 24 * 60 * 60 * 1000) throw new BadRequestException("effectiveDate cannot be more than 24 hours in the future.");
    return parsed;
  }

  private decodeBase64(value: unknown): Uint8Array {
    if (typeof value !== "string" || !value.trim()) throw new BadRequestException("contentBase64 is required.");
    const compact = value.replace(/\s+/g, "");
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact) || compact.length % 4 !== 0) throw new BadRequestException("contentBase64 is invalid.");
    const bytes = Buffer.from(compact, "base64");
    if (bytes.byteLength === 0) throw new BadRequestException("contentBase64 is empty.");
    return Uint8Array.from(bytes);
  }

  private positiveInteger(value: unknown, field: string): number {
    if (!Number.isInteger(value) || Number(value) < 1) throw new BadRequestException(`${field} must be a positive integer.`);
    return Number(value);
  }

  private requiredText(value: unknown, max: number, field: string): string {
    if (typeof value !== "string" || !value.trim()) throw new BadRequestException(`${field} is required.`);
    const normalized = value.trim();
    if (normalized.length > max) throw new BadRequestException(`${field} is too long.`);
    return normalized;
  }

  private optionalText(value: unknown, max: number): string | null {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string") throw new BadRequestException("Optional text fields must be strings.");
    const normalized = value.trim();
    if (normalized.length > max) throw new BadRequestException("Optional text field is too long.");
    return normalized || null;
  }

  private identifier(value: string, field: string): string {
    const normalized = value.trim();
    if (!/^[A-Za-z0-9_.:-]{1,180}$/.test(normalized)) throw new BadRequestException(`${field} is invalid.`);
    return normalized;
  }
}
