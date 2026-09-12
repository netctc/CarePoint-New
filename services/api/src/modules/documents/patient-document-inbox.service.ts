import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { Buffer } from "node:buffer";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { NotificationsService } from "../communications/notifications.service";
import { DocumentsService } from "./documents.service";
import { PatientDocumentCentreService } from "./patient-document-centre.service";

type JsonObject = Record<string, unknown>;

const GENERIC_RELEASE_NOTIFICATION_KINDS = new Set([
  "CLINICAL_ATTACHMENT",
  "IMAGING_REFERENCE",
  "OTHER",
]);

@Injectable()
export class PatientDocumentInboxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly notifications: NotificationsService,
    private readonly documents: DocumentsService,
    private readonly patientCentre: PatientDocumentCentreService,
  ) {}

  async list(
    principal: AuthPrincipal,
    input: { kind?: string; q?: string; limit?: string; focusDocumentId?: string },
  ) {
    this.requirePatientRole(principal);
    const base = await this.patientCentre.list(principal, input);
    const rows = Array.isArray(base.items) ? base.items as Array<Record<string, unknown>> : [];
    const ids = rows.map((row) => String(row.id ?? "")).filter(Boolean);
    const [receipts, internals] = ids.length === 0
      ? [[], []]
      : await Promise.all([
          this.prisma.patientClinicalDocumentReceipt.findMany({
            where: { accountId: principal.accountId, documentId: { in: ids } },
          }),
          this.prisma.clinicalDocument.findMany({
            where: { id: { in: ids } },
            select: { id: true, kind: true, providerId: true, createdByAccountId: true },
          }),
        ]);
    const receiptById = new Map(receipts.map((row) => [row.documentId, row]));
    const internalById = new Map(internals.map((row) => [row.id, row]));
    const focus = this.optionalText(input.focusDocumentId, 128);
    const items = rows.map((row) => {
      const documentId = String(row.id ?? "");
      const receipt = receiptById.get(documentId);
      const internal = internalById.get(documentId);
      return {
        ...row,
        firstOpenedAt: receipt?.firstOpenedAt ?? null,
        acknowledgedAt: receipt?.acknowledgedAt ?? null,
        opened: receipt?.firstOpenedAt != null,
        acknowledged: receipt?.acknowledgedAt != null,
        patientRemovable: internal?.kind === "PATIENT_UPLOAD"
          && internal.providerId == null
          && internal.createdByAccountId === principal.accountId,
      };
    });
    if (focus) {
      items.sort((left, right) => left.id === focus ? -1 : right.id === focus ? 1 : 0);
    }
    await this.audit.write({
      actorId: principal.accountId,
      action: "PATIENT_DOCUMENT_INBOX_READ",
      objectType: "PATIENT_DOCUMENT_INBOX",
      objectId: principal.accountId,
      purpose: "PATIENT_ACCESS",
      result: "SUCCESS",
      metadata: { itemCount: items.length, focused: Boolean(focus) },
    });
    return { ...base, items, focusDocumentId: focus ?? null };
  }

  async consumeDownloadGrant(principal: AuthPrincipal, documentId: string, input: JsonObject) {
    this.requirePatientRole(principal);
    const content = await this.patientCentre.consumeDownloadGrant(principal, documentId, input);
    const now = new Date();
    await this.prisma.patientClinicalDocumentReceipt.upsert({
      where: { documentId_accountId: { documentId, accountId: principal.accountId } },
      create: { documentId, accountId: principal.accountId, firstOpenedAt: now },
      update: {},
    });
    await this.prisma.patientClinicalDocumentReceipt.updateMany({
      where: { documentId, accountId: principal.accountId, firstOpenedAt: null },
      data: { firstOpenedAt: now },
    });
    await this.audit.write({
      actorId: principal.accountId,
      action: "PATIENT_DOCUMENT_OPENED",
      objectType: "CLINICAL_DOCUMENT",
      objectId: documentId,
      purpose: "PATIENT_ACCESS",
      result: "SUCCESS",
    });
    return content;
  }

  async acknowledge(principal: AuthPrincipal, documentId: string) {
    this.requirePatientRole(principal);
    await this.requirePatientDocument(principal, documentId);
    const now = new Date();
    await this.prisma.patientClinicalDocumentReceipt.upsert({
      where: { documentId_accountId: { documentId, accountId: principal.accountId } },
      create: { documentId, accountId: principal.accountId, firstOpenedAt: now, acknowledgedAt: now },
      update: { acknowledgedAt: now },
    });
    await this.prisma.patientClinicalDocumentReceipt.updateMany({
      where: { documentId, accountId: principal.accountId, firstOpenedAt: null },
      data: { firstOpenedAt: now },
    });
    const receipt = await this.prisma.patientClinicalDocumentReceipt.findUnique({
      where: { documentId_accountId: { documentId, accountId: principal.accountId } },
    });
    await this.audit.write({
      actorId: principal.accountId,
      action: "PATIENT_DOCUMENT_ACKNOWLEDGED",
      objectType: "CLINICAL_DOCUMENT",
      objectId: documentId,
      purpose: "PATIENT_ACCESS",
      result: "SUCCESS",
    });
    return {
      documentId,
      firstOpenedAt: receipt?.firstOpenedAt ?? now,
      acknowledgedAt: receipt?.acknowledgedAt ?? now,
    };
  }

  async uploadPersonalText(principal: AuthPrincipal, input: JsonObject) {
    this.requirePatientRole(principal);
    const title = this.requiredText(input.title, "title", 500);
    const content = this.requiredText(input.content, "content", 250_000);
    const description = this.optionalText(input.description, 2_000);
    const category = this.optionalText(input.category, 120);
    const byteLength = Buffer.byteLength(content, "utf8");
    if (byteLength > 512 * 1024) throw new BadRequestException("Patient text document is too large.");
    const metadataDescription = [
      category ? `Category: ${category}` : null,
      description ?? null,
    ].filter((value): value is string => Boolean(value)).join("\n");
    const result = await this.documents.patientUpload(principal, {
      fileName: `patient-note-${new Date().toISOString().slice(0, 10)}.txt`,
      title,
      ...(metadataDescription ? { description: metadataDescription } : {}),
      mediaType: "text/plain",
      contentBase64: Buffer.from(content, "utf8").toString("base64"),
    });
    await this.audit.write({
      actorId: principal.accountId,
      action: "PATIENT_DOCUMENT_NOTE_CREATED",
      objectType: "CLINICAL_DOCUMENT",
      objectId: String((result as Record<string, unknown>).id ?? ""),
      purpose: "PATIENT_ACCESS",
      result: "SUCCESS",
      metadata: { byteLength, hasCategory: Boolean(category), hasDescription: Boolean(description) },
    });
    return { ...(result as Record<string, unknown>), patientProvided: true, providerVerified: false };
  }

  async removeOwnUpload(principal: AuthPrincipal, documentId: string) {
    this.requirePatientRole(principal);
    const document = await this.requirePatientDocument(principal, documentId);
    if (
      document.kind !== "PATIENT_UPLOAD"
      || document.providerId != null
      || document.createdByAccountId !== principal.accountId
    ) {
      throw new ForbiddenException("Only your own patient-provided document can be removed here.");
    }
    return this.documents.removeDocument(principal, documentId);
  }

  async releaseProviderDocument(principal: AuthPrincipal, documentId: string) {
    const before = await this.prisma.clinicalDocument.findUnique({
      where: { id: documentId },
      select: { id: true, patientId: true, kind: true, releasedToPatient: true },
    });
    const result = await this.documents.releaseDocument(principal, documentId);
    if (!before || before.releasedToPatient || !GENERIC_RELEASE_NOTIFICATION_KINDS.has(before.kind)) return result;

    try {
      const patient = await this.prisma.patientProfile.findUnique({
        where: { id: before.patientId },
        select: { userId: true },
      });
      if (!patient?.userId) return result;
      await this.notifications.notifyAccount({
        accountId: patient.userId,
        dedupeKey: `clinical:${documentId}:document-released`,
        type: "CLINICAL_UPDATE",
        entityType: "CLINICAL_DOCUMENT",
        entityId: documentId,
        safeTitleKey: "notification.clinical.document.title",
        safeBodyKey: "notification.clinical.document.body",
      });
    } catch (error) {
      await this.audit.write({
        actorId: principal.accountId,
        action: "CLINICAL_DOCUMENT_RELEASE_NOTIFICATION_FAILED",
        objectType: "CLINICAL_DOCUMENT",
        objectId: documentId,
        purpose: "SYSTEM_ACCESS",
        result: "FAILED",
        metadata: { errorCode: this.safeErrorCode(error) },
      }).catch(() => undefined);
    }
    return result;
  }

  private requirePatientRole(principal: AuthPrincipal): void {
    if (principal.role !== "PATIENT") throw new ForbiddenException("Patient document inbox requires a patient account.");
  }

  private async requirePatientDocument(principal: AuthPrincipal, documentId: string) {
    const patient = await this.prisma.patientProfile.findUnique({
      where: { userId: principal.accountId },
      select: { id: true },
    });
    if (!patient) throw new NotFoundException("Patient profile not found.");
    const document = await this.prisma.clinicalDocument.findFirst({
      where: {
        id: documentId,
        patientId: patient.id,
        status: "AVAILABLE",
        releasedToPatient: true,
      },
      select: { id: true, kind: true, providerId: true, createdByAccountId: true },
    });
    if (!document) throw new NotFoundException("Clinical document not found.");
    return document;
  }

  private requiredText(value: unknown, name: string, maxLength: number): string {
    if (typeof value !== "string" || !value.trim()) throw new BadRequestException(`${name} is required.`);
    const normalized = value.trim();
    if (normalized.length > maxLength) throw new BadRequestException(`${name} is too long.`);
    return normalized;
  }

  private optionalText(value: unknown, maxLength: number): string | undefined {
    if (value == null) return undefined;
    if (typeof value !== "string") throw new BadRequestException("Invalid text value.");
    const normalized = value.trim();
    if (!normalized) return undefined;
    if (normalized.length > maxLength) throw new BadRequestException("Text value is too long.");
    return normalized;
  }

  private safeErrorCode(error: unknown): string {
    const name = error instanceof Error ? error.constructor.name : "NotificationError";
    return name.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 80) || "NotificationError";
  }
}
