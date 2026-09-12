import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import type { ClinicalDocument } from "@prisma/client";
import type { EncryptedEnvelope } from "@carepoint/security";
import { createHash, randomBytes } from "node:crypto";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { DocumentStorageService } from "./document-storage.service";
import { DocumentsEnvelopeService } from "./documents-envelope.service";

const DOWNLOAD_GRANT_TTL_MS = 5 * 60 * 1000;
const MAX_SCAN = 200;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 100;
const DOCUMENT_KINDS = new Set([
  "CLINICAL_ATTACHMENT",
  "LAB_REPORT",
  "IMAGING_REPORT",
  "IMAGING_REFERENCE",
  "PATHOLOGY_REPORT",
  "PATIENT_UPLOAD",
  "OTHER",
]);

type JsonObject = Record<string, unknown>;

@Injectable()
export class PatientDocumentCentreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly storage: DocumentStorageService,
    private readonly envelope: DocumentsEnvelopeService,
  ) {}

  async list(principal: AuthPrincipal, input: { kind?: unknown; q?: unknown; limit?: unknown }) {
    const patient = await this.requirePatient(principal);
    const kind = this.optionalKind(input.kind);
    const q = this.optionalQuery(input.q);
    const limit = this.limit(input.limit);
    const documents = await this.prisma.clinicalDocument.findMany({
      where: {
        patientId: patient.id,
        status: "AVAILABLE",
        releasedToPatient: true,
        ...(kind ? { kind } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: MAX_SCAN + 1,
    });
    const scan = documents.slice(0, MAX_SCAN);
    const presented = await Promise.all(scan.map((document) => this.presentPatientDocument(document)));
    const filtered = q
      ? presented.filter((document) => this.searchMaterial(document).includes(q))
      : presented;
    const items = filtered.slice(0, limit);
    await this.audit.write({
      actorId: principal.accountId,
      action: "PATIENT_DOCUMENT_CENTRE_READ",
      objectType: "PATIENT",
      objectId: patient.id,
      purpose: "PATIENT_ACCESS",
      result: "SUCCESS",
      metadata: { itemCount: items.length, filtered: Boolean(kind || q), truncated: documents.length > MAX_SCAN || filtered.length > limit },
    });
    return {
      accessBasis: "PATIENT_SELF" as const,
      filter: { kind: kind ?? null, q: q || null },
      truncated: documents.length > MAX_SCAN || filtered.length > limit,
      items,
    };
  }

  async issueDownloadGrant(principal: AuthPrincipal, documentId: string) {
    const { document } = await this.requirePatientDocument(principal, documentId);
    if (document.storageMode !== "ENCRYPTED_BLOB") {
      throw new BadRequestException("This clinical document does not contain downloadable binary content.");
    }
    const token = randomBytes(32).toString("base64url");
    const tokenHash = this.hashToken(token);
    const expiresAt = new Date(Date.now() + DOWNLOAD_GRANT_TTL_MS);
    await this.prisma.clinicalDocumentDownloadGrant.create({
      data: { tokenHash, documentId: document.id, accountId: principal.accountId, expiresAt },
    });
    await this.audit.write({
      actorId: principal.accountId,
      action: "CLINICAL_DOCUMENT_DOWNLOAD_GRANT_ISSUED",
      objectType: "CLINICAL_DOCUMENT",
      objectId: document.id,
      purpose: "PATIENT_ACCESS",
      result: "SUCCESS",
      metadata: { expiresInSeconds: DOWNLOAD_GRANT_TTL_MS / 1000 },
    });
    return { documentId: document.id, token, expiresAt, expiresInSeconds: DOWNLOAD_GRANT_TTL_MS / 1000 };
  }

  async consumeDownloadGrant(principal: AuthPrincipal, documentId: string, input: JsonObject) {
    const { document } = await this.requirePatientDocument(principal, documentId);
    if (document.storageMode !== "ENCRYPTED_BLOB") {
      throw new BadRequestException("This clinical document does not contain downloadable binary content.");
    }
    const token = this.requiredToken(input.token);
    const now = new Date();
    const claimed = await this.prisma.clinicalDocumentDownloadGrant.updateMany({
      where: {
        tokenHash: this.hashToken(token),
        documentId: document.id,
        accountId: principal.accountId,
        consumedAt: null,
        expiresAt: { gt: now },
      },
      data: { consumedAt: now },
    });
    if (claimed.count !== 1) {
      await this.audit.write({
        actorId: principal.accountId,
        action: "CLINICAL_DOCUMENT_DOWNLOAD_DENIED",
        objectType: "CLINICAL_DOCUMENT",
        objectId: document.id,
        purpose: "PATIENT_ACCESS",
        result: "DENIED",
        metadata: { reason: "INVALID_EXPIRED_OR_CONSUMED_GRANT" },
      });
      throw new ForbiddenException("Clinical document download grant is invalid, expired or already consumed.");
    }

    try {
      if (!document.objectKey || !document.blobAlgorithm || !document.blobKeyId || !document.blobWrappedKey || !document.blobIv || !document.contentDigest) {
        throw new ConflictException("Document storage envelope is incomplete.");
      }
      const ciphertext = await this.storage.get(document.objectKey);
      const bytes = await this.envelope.decryptBytes(this.blobEnvelope(document, ciphertext));
      const digest = createHash("sha256").update(bytes).digest("hex");
      if (digest !== document.contentDigest) throw new ConflictException("Document integrity check failed.");
      const metadata = await this.safeMetadata(document);
      const fileName = typeof metadata.fileName === "string" && metadata.fileName.trim()
        ? metadata.fileName.trim()
        : `carepoint-document-${document.id}`;
      await this.audit.write({
        actorId: principal.accountId,
        action: "CLINICAL_DOCUMENT_SECURE_DOWNLOAD",
        objectType: "CLINICAL_DOCUMENT",
        objectId: document.id,
        purpose: "PATIENT_ACCESS",
        result: "SUCCESS",
        metadata: { byteLength: bytes.byteLength },
      });
      return {
        bytes: Buffer.from(bytes),
        mediaType: document.mediaType ?? "application/octet-stream",
        fileName,
      };
    } catch (error) {
      await this.audit.write({
        actorId: principal.accountId,
        action: "CLINICAL_DOCUMENT_SECURE_DOWNLOAD",
        objectType: "CLINICAL_DOCUMENT",
        objectId: document.id,
        purpose: "PATIENT_ACCESS",
        result: "FAILED",
        metadata: { reason: "CONTENT_READ_FAILED" },
      });
      throw error;
    }
  }

  private async presentPatientDocument(document: ClinicalDocument) {
    const metadata = await this.safeMetadata(document);
    return {
      id: document.id,
      kind: document.kind,
      status: document.status,
      mediaType: document.mediaType,
      byteLength: document.byteLength,
      releasedAt: document.releasedAt,
      createdAt: document.createdAt,
      accessBasis: "PATIENT_SELF" as const,
      source: document.providerId ? "CARE_TEAM" as const : "PATIENT" as const,
      downloadable: document.storageMode === "ENCRYPTED_BLOB",
      metadata,
    };
  }

  private async safeMetadata(document: ClinicalDocument): Promise<JsonObject> {
    const raw = await this.envelope.decryptMetadata<JsonObject>(this.metadataEnvelope(document));
    const safe: JsonObject = {};
    for (const key of ["fileName", "title", "description"]) {
      const value = raw[key];
      if (typeof value === "string" && value.trim()) safe[key] = value.trim();
    }
    return safe;
  }

  private searchMaterial(document: Record<string, unknown>): string {
    const metadata = document.metadata && typeof document.metadata === "object" && !Array.isArray(document.metadata)
      ? document.metadata as JsonObject
      : {};
    return [document.kind, metadata.fileName, metadata.title, metadata.description]
      .filter((value): value is string => typeof value === "string")
      .join(" ")
      .toLocaleLowerCase();
  }

  private async requirePatientDocument(principal: AuthPrincipal, documentId: string) {
    const patient = await this.requirePatient(principal);
    const document = await this.prisma.clinicalDocument.findFirst({
      where: { id: documentId, patientId: patient.id, status: "AVAILABLE", releasedToPatient: true },
    });
    if (!document) throw new NotFoundException("Clinical document not found.");
    return { patient, document };
  }

  private async requirePatient(principal: AuthPrincipal) {
    if (principal.role !== "PATIENT") throw new ForbiddenException("Patient document centre requires a patient account.");
    const patient = await this.prisma.patientProfile.findUnique({ where: { userId: principal.accountId }, select: { id: true } });
    if (!patient) throw new NotFoundException("Patient profile not found.");
    return patient;
  }

  private metadataEnvelope(document: ClinicalDocument): EncryptedEnvelope {
    if (document.metadataAlgorithm !== "AES-256-GCM") throw new ConflictException("Unsupported document metadata encryption algorithm.");
    return {
      version: 1,
      algorithm: "AES-256-GCM",
      keyId: document.metadataKeyId,
      wrappedKey: document.metadataWrappedKey,
      iv: document.metadataIv,
      ciphertext: document.metadataCiphertext,
    };
  }

  private blobEnvelope(document: ClinicalDocument, ciphertext: string): EncryptedEnvelope {
    if (document.blobAlgorithm !== "AES-256-GCM" || !document.blobKeyId || !document.blobWrappedKey || !document.blobIv) {
      throw new ConflictException("Unsupported document blob encryption envelope.");
    }
    return {
      version: 1,
      algorithm: "AES-256-GCM",
      keyId: document.blobKeyId,
      wrappedKey: document.blobWrappedKey,
      iv: document.blobIv,
      ciphertext,
    };
  }

  private optionalKind(value: unknown): string | null {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string") throw new BadRequestException("kind must be a string.");
    const kind = value.trim().toUpperCase();
    if (!DOCUMENT_KINDS.has(kind)) throw new BadRequestException("Unsupported clinical document kind.");
    return kind;
  }

  private optionalQuery(value: unknown): string {
    if (value === undefined || value === null || value === "") return "";
    if (typeof value !== "string") throw new BadRequestException("q must be a string.");
    const q = value.trim().toLocaleLowerCase();
    if (q.length > 120) throw new BadRequestException("q exceeds 120 characters.");
    return q;
  }

  private limit(value: unknown): number {
    if (value === undefined || value === null || value === "") return DEFAULT_LIMIT;
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) throw new BadRequestException(`limit must be between 1 and ${MAX_LIMIT}.`);
    return parsed;
  }

  private requiredToken(value: unknown): string {
    if (typeof value !== "string") throw new BadRequestException("download token is required.");
    const token = value.trim();
    if (!/^[A-Za-z0-9_-]{40,200}$/.test(token)) throw new BadRequestException("download token is invalid.");
    return token;
  }

  private hashToken(token: string): string {
    return createHash("sha256").update(token, "utf8").digest("hex");
  }
}
