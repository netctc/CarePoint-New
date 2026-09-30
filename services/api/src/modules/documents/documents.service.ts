import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { ClinicalDocument, DiagnosticReport } from "@prisma/client";
import type { EncryptedEnvelope } from "@carepoint/security";
import type { AuthPrincipal } from "@carepoint/identity";
import { createHash, randomUUID } from "node:crypto";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { NotificationsService } from "../communications/notifications.service";
import { DocumentStorageService } from "./document-storage.service";
import { DocumentsEnvelopeService } from "./documents-envelope.service";
import { DocumentsAttestationService } from "./documents-attestation.service";
import { DocumentMalwareScannerService } from "./document-malware-scanner.service";
import { DicomWebService } from "./dicomweb.service";

const DOCUMENT_CONSENT_SCOPE = "CLINICAL_DOCUMENT_READ";
const DOCUMENT_CONSENT_VERSION = "clinical-documents-v1";
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const TREATMENT_LOOKBACK_DAYS = 365;
const TREATMENT_LOOKAHEAD_DAYS = 30;
const ALLOWED_MEDIA_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "application/dicom", "text/plain"]);

type JsonObject = Record<string, unknown>;
type AccessBasis = "PATIENT_SELF" | "OWN_AUTHORSHIP" | "TREATMENT_RELATIONSHIP" | "PATIENT_CONSENT";
type ProviderContext = { id: string; class: "DOCTOR" | "OTHER_PROVIDER"; status: string };
type DocumentKind = "CLINICAL_ATTACHMENT" | "LAB_REPORT" | "IMAGING_REPORT" | "IMAGING_REFERENCE" | "PATHOLOGY_REPORT" | "PATIENT_UPLOAD" | "OTHER";
type DiagnosticType = "IMAGING" | "PATHOLOGY" | "OTHER";

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly storage: DocumentStorageService,
    private readonly envelope: DocumentsEnvelopeService,
    private readonly attestation: DocumentsAttestationService,
    private readonly scanner: DocumentMalwareScannerService,
    private readonly dicomweb: DicomWebService,
    private readonly notifications: NotificationsService,
  ) {}

  async uploadForEncounter(principal: AuthPrincipal, appointmentId: string, input: JsonObject) {
    const provider = await this.requireActiveProvider(principal);
    const appointment = await this.requireAppointment(appointmentId);
    if (appointment.providerId !== provider.id) throw new ForbiddenException("Only the appointment provider can attach documents to this encounter.");
    if (!["CONFIRMED", "COMPLETED"].includes(appointment.status)) throw new ConflictException("Documents require a confirmed or completed encounter.");
    const kind = this.documentKind(input.kind, false);
    if (kind === "IMAGING_REFERENCE") throw new BadRequestException("Use the reference endpoint for imaging references.");
    const document = await this.createBinaryDocument({
      patientId: appointment.patientId,
      providerId: provider.id,
      encounterRef: appointment.id,
      orderId: this.optionalText(input.orderId, 100),
      kind,
      createdByAccountId: principal.accountId,
      releasedToPatient: false,
      input,
    });
    await this.audit.write({ actorId: principal.accountId, action: "CLINICAL_DOCUMENT_UPLOADED", objectType: "CLINICAL_DOCUMENT", objectId: document.id, purpose: "TREATMENT", result: "SUCCESS", metadata: { kind, appointmentId } });
    return this.presentDocument(document, "OWN_AUTHORSHIP");
  }

  async createEncounterReference(principal: AuthPrincipal, appointmentId: string, input: JsonObject) {
    const provider = await this.requireActiveProvider(principal);
    const appointment = await this.requireAppointment(appointmentId);
    if (appointment.providerId !== provider.id) throw new ForbiddenException("Only the appointment provider can attach references to this encounter.");
    if (!["CONFIRMED", "COMPLETED"].includes(appointment.status)) throw new ConflictException("References require a confirmed or completed encounter.");
    const title = this.requiredText(input.title, 500, "title");
    const externalReference = this.dicomweb.normalizeReference(input);
    const metadata = await this.envelope.encryptMetadata({ schemaVersion: 1, title, externalReference, description: this.optionalText(input.description, 4000) });
    const document = await this.prisma.clinicalDocument.create({
      data: {
        patientId: appointment.patientId,
        providerId: provider.id,
        encounterRef: appointment.id,
        orderId: this.optionalText(input.orderId, 100),
        kind: "IMAGING_REFERENCE",
        storageMode: "EXTERNAL_REFERENCE",
        storageProvider: "DICOMWEB_REFERENCE",
        metadataAlgorithm: metadata.algorithm,
        metadataKeyId: metadata.keyId,
        metadataWrappedKey: metadata.wrappedKey,
        metadataIv: metadata.iv,
        metadataCiphertext: metadata.ciphertext,
        createdByAccountId: principal.accountId,
      },
    });
    await this.audit.write({ actorId: principal.accountId, action: "CLINICAL_DOCUMENT_REFERENCE_CREATED", objectType: "CLINICAL_DOCUMENT", objectId: document.id, purpose: "TREATMENT", result: "SUCCESS", metadata: { appointmentId, provider: "DICOMWEB" } });
    return this.presentDocument(document, "OWN_AUTHORSHIP");
  }

  async patientUpload(principal: AuthPrincipal, input: JsonObject) {
    if (principal.role !== "PATIENT") throw new ForbiddenException("Patient upload requires a patient account.");
    const patient = await this.requirePatient(principal);
    const document = await this.createBinaryDocument({
      patientId: patient.id,
      providerId: null,
      encounterRef: null,
      orderId: null,
      kind: "PATIENT_UPLOAD",
      createdByAccountId: principal.accountId,
      releasedToPatient: true,
      input,
    });
    await this.audit.write({ actorId: principal.accountId, action: "PATIENT_DOCUMENT_UPLOADED", objectType: "CLINICAL_DOCUMENT", objectId: document.id, purpose: "PATIENT_ACCESS", result: "SUCCESS", metadata: { kind: document.kind } });
    return this.presentDocument(document, "PATIENT_SELF");
  }

  async patientDocuments(principal: AuthPrincipal) {
    if (principal.role !== "PATIENT") throw new ForbiddenException("Patient document access requires a patient account.");
    const patient = await this.requirePatient(principal);
    const documents = await this.prisma.clinicalDocument.findMany({ where: { patientId: patient.id, status: "AVAILABLE", releasedToPatient: true }, orderBy: { createdAt: "desc" }, take: 500 });
    const items = await Promise.all(documents.map((document) => this.presentDocument(document, "PATIENT_SELF")));
    await this.audit.write({ actorId: principal.accountId, action: "CLINICAL_DOCUMENTS_READ", objectType: "PATIENT", objectId: patient.id, purpose: "PATIENT_ACCESS", result: "SUCCESS", metadata: { itemCount: items.length } });
    return { patientId: patient.id, accessBasis: "PATIENT_SELF" as const, items };
  }

  async providerPatientDocuments(principal: AuthPrincipal, patientId: string) {
    const provider = await this.requireActiveProvider(principal);
    await this.requirePatientById(patientId);
    const basis = await this.providerPatientAccessBasis(provider.id, patientId);
    if (!basis) {
      await this.audit.write({ actorId: principal.accountId, action: "CLINICAL_DOCUMENTS_READ_DENIED", objectType: "PATIENT", objectId: patientId, purpose: "TREATMENT", result: "DENIED" });
      throw new ForbiddenException("No clinical document access basis exists for this patient.");
    }
    const documents = await this.prisma.clinicalDocument.findMany({
      where: { patientId, status: "AVAILABLE", ...(basis === "OWN_AUTHORSHIP" ? { providerId: provider.id } : {}) },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    const items = await Promise.all(documents.map((document) => this.presentDocument(document, basis)));
    await this.audit.write({ actorId: principal.accountId, action: "CLINICAL_DOCUMENTS_READ", objectType: "PATIENT", objectId: patientId, purpose: "TREATMENT", result: "SUCCESS", metadata: { basis, itemCount: items.length } });
    return { patientId, accessBasis: basis, items };
  }

  async documentContent(principal: AuthPrincipal, documentId: string) {
    const document = await this.requireDocument(documentId);
    const access = await this.documentAccessBasis(principal, document);
    if (!access) {
      await this.audit.write({ actorId: principal.accountId, action: "CLINICAL_DOCUMENT_READ_DENIED", objectType: "CLINICAL_DOCUMENT", objectId: document.id, purpose: "TREATMENT", result: "DENIED" });
      throw new ForbiddenException("Clinical document access denied.");
    }
    if (document.storageMode === "EXTERNAL_REFERENCE") {
      const result = await this.presentDocument(document, access);
      await this.audit.write({ actorId: principal.accountId, action: "CLINICAL_DOCUMENT_READ", objectType: "CLINICAL_DOCUMENT", objectId: document.id, purpose: access === "PATIENT_SELF" ? "PATIENT_ACCESS" : "TREATMENT", result: "SUCCESS", metadata: { basis: access, storageMode: document.storageMode } });
      return result;
    }
    if (!document.objectKey || !document.blobAlgorithm || !document.blobKeyId || !document.blobWrappedKey || !document.blobIv || !document.contentDigest) throw new ConflictException("Document storage envelope is incomplete.");
    const ciphertext = await this.storage.get(document.objectKey);
    const bytes = await this.envelope.decryptBytes(this.blobEnvelope(document, ciphertext));
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== document.contentDigest) throw new ConflictException("Document integrity check failed.");
    await this.audit.write({ actorId: principal.accountId, action: "CLINICAL_DOCUMENT_CONTENT_READ", objectType: "CLINICAL_DOCUMENT", objectId: document.id, purpose: access === "PATIENT_SELF" ? "PATIENT_ACCESS" : "TREATMENT", result: "SUCCESS", metadata: { basis: access, byteLength: bytes.byteLength } });
    return { ...(await this.presentDocument(document, access)), contentBase64: Buffer.from(bytes).toString("base64") };
  }

  async releaseDocument(principal: AuthPrincipal, documentId: string) {
    const provider = await this.requireActiveProvider(principal);
    const document = await this.requireDocument(documentId);
    if (document.providerId !== provider.id) throw new ForbiddenException("Only the authoring provider can release this document.");
    if (document.status !== "AVAILABLE") throw new ConflictException("Only an available document can be released.");
    if (document.releasedToPatient) return this.presentDocument(document, "OWN_AUTHORSHIP");
    const updated = await this.prisma.clinicalDocument.update({ where: { id: document.id }, data: { releasedToPatient: true, releasedAt: new Date() } });
    await this.audit.write({ actorId: principal.accountId, action: "CLINICAL_DOCUMENT_RELEASED", objectType: "CLINICAL_DOCUMENT", objectId: document.id, purpose: "TREATMENT", result: "SUCCESS" });
    return this.presentDocument(updated, "OWN_AUTHORSHIP");
  }

  async removeDocument(principal: AuthPrincipal, documentId: string) {
    const document = await this.requireDocument(documentId);
    let allowed = false;
    if (principal.role === "PATIENT") {
      const patient = await this.requirePatient(principal);
      allowed = document.patientId === patient.id && document.createdByAccountId === principal.accountId;
    } else if (principal.role === "DOCTOR" || principal.role === "OTHER_PROVIDER") {
      const provider = await this.requireActiveProvider(principal);
      allowed = document.providerId === provider.id;
    }
    if (!allowed) throw new ForbiddenException("Document removal denied.");
    if (document.status === "REMOVED") return { id: document.id, status: document.status };
    if (document.objectKey) await this.storage.remove(document.objectKey);
    const updated = await this.prisma.clinicalDocument.update({ where: { id: document.id }, data: { status: "REMOVED", removedAt: new Date(), objectKey: null } });
    await this.audit.write({ actorId: principal.accountId, action: "CLINICAL_DOCUMENT_REMOVED", objectType: "CLINICAL_DOCUMENT", objectId: document.id, purpose: principal.role === "PATIENT" ? "PATIENT_ACCESS" : "TREATMENT", result: "SUCCESS" });
    return { id: updated.id, status: updated.status };
  }

  async createDiagnosticReport(principal: AuthPrincipal, appointmentId: string, input: JsonObject) {
    const provider = await this.requireActiveProvider(principal);
    const appointment = await this.requireAppointment(appointmentId);
    if (appointment.providerId !== provider.id) throw new ForbiddenException("Only the appointment provider can author a diagnostic report for this encounter.");
    if (!["CONFIRMED", "COMPLETED"].includes(appointment.status)) throw new ConflictException("Diagnostic reports require a confirmed or completed encounter.");
    const type = this.diagnosticType(input.type);
    const documentId = this.optionalText(input.documentId, 100);
    if (documentId) {
      const document = await this.requireDocument(documentId);
      if (document.patientId !== appointment.patientId || document.providerId !== provider.id || document.encounterRef !== appointment.id) throw new ConflictException("Attached document does not belong to this encounter/provider.");
    }
    const payload = this.validateDiagnosticPayload(input);
    const encrypted = await this.envelope.encryptMetadata({ schemaVersion: 1, type, ...payload });
    const report = await this.prisma.diagnosticReport.create({
      data: {
        patientId: appointment.patientId,
        providerId: provider.id,
        encounterRef: appointment.id,
        documentId,
        type,
        status: "DRAFT",
        algorithm: encrypted.algorithm,
        keyId: encrypted.keyId,
        wrappedKey: encrypted.wrappedKey,
        iv: encrypted.iv,
        ciphertext: encrypted.ciphertext,
        payloadDigest: this.attestation.digest(this.reportMaterial(type, appointment.patientId, provider.id, appointment.id, documentId, encrypted)),
      },
    });
    await this.audit.write({ actorId: principal.accountId, action: "DIAGNOSTIC_REPORT_CREATED", objectType: "DIAGNOSTIC_REPORT", objectId: report.id, purpose: "TREATMENT", result: "SUCCESS", metadata: { type, appointmentId } });
    return this.presentReport(report, "OWN_AUTHORSHIP", false);
  }

  async finalizeDiagnosticReport(principal: AuthPrincipal, reportId: string) {
    const provider = await this.requireActiveProvider(principal);
    const report = await this.requireReport(reportId);
    if (report.providerId !== provider.id) throw new ForbiddenException("Only the authoring provider can finalize this report.");
    if (report.status !== "DRAFT") throw new ConflictException("Only a draft diagnostic report can be finalized.");
    const envelope = this.reportEnvelope(report);
    const material = this.reportMaterial(report.type as DiagnosticType, report.patientId, report.providerId, report.encounterRef, report.documentId, envelope);
    const signature = await this.attestation.attest(material);
    if (signature.payloadDigest !== report.payloadDigest) throw new ConflictException("Diagnostic report integrity check failed before finalization.");
    const updated = await this.prisma.diagnosticReport.update({ where: { id: report.id }, data: { status: "FINAL", signatureAlgorithm: signature.algorithm, signatureKeyId: signature.keyId, signature: signature.signature, finalizedAt: signature.signedAt } });
    await this.audit.write({ actorId: principal.accountId, action: "DIAGNOSTIC_REPORT_FINALIZED", objectType: "DIAGNOSTIC_REPORT", objectId: report.id, purpose: "TREATMENT", result: "SUCCESS" });
    return this.presentReport(updated, "OWN_AUTHORSHIP", false);
  }

  async releaseDiagnosticReport(principal: AuthPrincipal, reportId: string) {
    const provider = await this.requireActiveProvider(principal);
    const report = await this.requireReport(reportId);
    if (report.providerId !== provider.id) throw new ForbiddenException("Only the authoring provider can release this report.");
    if (report.status !== "FINAL") throw new ConflictException("Only a final diagnostic report can be released.");
    await this.assertReportIntegrity(report);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const patient = await tx.patientProfile.findUnique({ where: { id: report.patientId }, select: { userId: true } });
      if (!patient?.userId) throw new NotFoundException("Patient profile not found.");
      const released = await tx.diagnosticReport.updateMany({
        where: { id: report.id, status: "FINAL" },
        data: { status: "RELEASED", releasedAt: now },
      });
      if (released.count !== 1) throw new ConflictException("Diagnostic report changed concurrently. Refresh and retry.");
      if (report.documentId) {
        await tx.clinicalDocument.updateMany({
          where: { id: report.documentId, status: "AVAILABLE" },
          data: { releasedToPatient: true, releasedAt: now },
        });
      }
      await this.notifications.enqueueAccountInTransaction(tx, {
        accountId: patient.userId,
        dedupeKey: `clinical:${report.id}:diagnostic-report-released`,
        type: "CLINICAL_UPDATE",
        entityType: "DIAGNOSTIC_REPORT",
        entityId: report.id,
        safeTitleKey: "notification.clinical.diagnostic-report.title",
        safeBodyKey: "notification.clinical.diagnostic-report.body",
      });
    });
    this.notifications.wakeOutbox();
    await this.audit.write({ actorId: principal.accountId, action: "DIAGNOSTIC_REPORT_RELEASED", objectType: "DIAGNOSTIC_REPORT", objectId: report.id, purpose: "TREATMENT", result: "SUCCESS", metadata: { documentId: report.documentId } });
    return this.presentReport(await this.requireReport(report.id), "OWN_AUTHORSHIP", false);
  }

  async patientDiagnosticReports(principal: AuthPrincipal) {
    if (principal.role !== "PATIENT") throw new ForbiddenException("Patient diagnostic report access requires a patient account.");
    const patient = await this.requirePatient(principal);
    const reports = await this.prisma.diagnosticReport.findMany({ where: { patientId: patient.id, status: "RELEASED" }, orderBy: { createdAt: "desc" }, take: 500 });
    const items = await Promise.all(reports.map((report) => this.presentReport(report, "PATIENT_SELF", true)));
    await this.audit.write({ actorId: principal.accountId, action: "DIAGNOSTIC_REPORTS_READ", objectType: "PATIENT", objectId: patient.id, purpose: "PATIENT_ACCESS", result: "SUCCESS", metadata: { itemCount: items.length } });
    return { patientId: patient.id, accessBasis: "PATIENT_SELF" as const, items };
  }

  async providerPatientDiagnosticReports(principal: AuthPrincipal, patientId: string) {
    const provider = await this.requireActiveProvider(principal);
    await this.requirePatientById(patientId);
    const basis = await this.providerPatientAccessBasis(provider.id, patientId);
    if (!basis) throw new ForbiddenException("No diagnostic report access basis exists for this patient.");
    const reports = await this.prisma.diagnosticReport.findMany({
      where: basis === "OWN_AUTHORSHIP"
        ? { patientId, providerId: provider.id }
        : { patientId, status: { in: ["FINAL", "RELEASED"] } },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    const items = await Promise.all(reports.map((report) => this.presentReport(report, basis, false)));
    return { patientId, accessBasis: basis, items };
  }

  async getDiagnosticReport(principal: AuthPrincipal, reportId: string) {
    const report = await this.requireReport(reportId);
    if (principal.role === "PATIENT") {
      const patient = await this.requirePatient(principal);
      if (patient.id !== report.patientId || report.status !== "RELEASED") throw new ForbiddenException("Diagnostic report access denied.");
      return this.presentReport(report, "PATIENT_SELF", true);
    }
    if (principal.role === "DOCTOR" || principal.role === "OTHER_PROVIDER") {
      const provider = await this.requireActiveProvider(principal);
      const own = provider.id === report.providerId;
      if (!own && report.status === "DRAFT") throw new ForbiddenException("Draft diagnostic reports are visible only to the authoring provider.");
      const basis = own ? "OWN_AUTHORSHIP" : await this.providerPatientAccessBasis(provider.id, report.patientId);
      if (!basis) throw new ForbiddenException("Diagnostic report access denied.");
      return this.presentReport(report, basis, false);
    }
    throw new ForbiddenException("Diagnostic report access denied.");
  }

  private async createBinaryDocument(args: { patientId: string; providerId: string | null; encounterRef: string | null; orderId: string | null; kind: DocumentKind; createdByAccountId: string; releasedToPatient: boolean; input: JsonObject }) {
    const mediaType = this.requiredText(args.input.mediaType, 200, "mediaType").toLowerCase();
    if (!ALLOWED_MEDIA_TYPES.has(mediaType)) throw new BadRequestException("Unsupported clinical document mediaType.");
    const bytes = this.decodeBase64(args.input.contentBase64);
    if (bytes.byteLength < 1 || bytes.byteLength > MAX_FILE_BYTES) throw new BadRequestException(`Clinical document must contain between 1 and ${MAX_FILE_BYTES} bytes.`);
    await this.scanner.assertClean(bytes);
    const metadata = await this.envelope.encryptMetadata({
      schemaVersion: 1,
      fileName: this.requiredText(args.input.fileName, 500, "fileName"),
      title: this.optionalText(args.input.title, 500),
      description: this.optionalText(args.input.description, 4000),
    });
    const encryptedBlob = await this.envelope.encryptBytes(bytes);
    const objectKey = `clinical/${randomUUID()}.cpenc`;
    await this.storage.put(objectKey, encryptedBlob.ciphertext);
    try {
      return await this.prisma.clinicalDocument.create({
        data: {
          patientId: args.patientId,
          providerId: args.providerId,
          encounterRef: args.encounterRef,
          orderId: args.orderId,
          kind: args.kind,
          storageMode: "ENCRYPTED_BLOB",
          storageProvider: this.storage.storageProviderName(),
          objectKey,
          mediaType,
          byteLength: bytes.byteLength,
          contentDigest: createHash("sha256").update(bytes).digest("hex"),
          blobAlgorithm: encryptedBlob.envelope.algorithm,
          blobKeyId: encryptedBlob.envelope.keyId,
          blobWrappedKey: encryptedBlob.envelope.wrappedKey,
          blobIv: encryptedBlob.envelope.iv,
          metadataAlgorithm: metadata.algorithm,
          metadataKeyId: metadata.keyId,
          metadataWrappedKey: metadata.wrappedKey,
          metadataIv: metadata.iv,
          metadataCiphertext: metadata.ciphertext,
          releasedToPatient: args.releasedToPatient,
          releasedAt: args.releasedToPatient ? new Date() : null,
          createdByAccountId: args.createdByAccountId,
        },
      });
    } catch (error) {
      await this.storage.remove(objectKey);
      throw error;
    }
  }

  private async presentDocument(document: ClinicalDocument, basis: AccessBasis) {
    const rawMetadata = await this.envelope.decryptMetadata<JsonObject>(this.metadataEnvelope(document));
    const metadata = document.kind === "IMAGING_REFERENCE"
      ? Object.fromEntries(Object.entries(rawMetadata).filter(([key]) => key !== "externalReference"))
      : rawMetadata;
    return {
      id: document.id,
      patientId: document.patientId,
      providerId: document.providerId,
      encounterRef: document.encounterRef,
      orderId: document.orderId,
      kind: document.kind,
      status: document.status,
      storageMode: document.storageMode,
      mediaType: document.mediaType,
      byteLength: document.byteLength,
      contentDigest: document.contentDigest,
      releasedToPatient: document.releasedToPatient,
      releasedAt: document.releasedAt,
      createdAt: document.createdAt,
      accessBasis: basis,
      metadata,
      ...(document.kind === "IMAGING_REFERENCE" ? { dicomweb: this.dicomweb.descriptor() } : {}),
    };
  }

  private async presentReport(report: DiagnosticReport, basis: AccessBasis, patientView: boolean) {
    if (patientView && report.status !== "RELEASED") throw new ForbiddenException("Diagnostic report has not been released to the patient.");
    if (report.status === "FINAL" || report.status === "RELEASED") await this.assertReportIntegrity(report);
    const data = await this.envelope.decryptMetadata<JsonObject>(this.reportEnvelope(report));
    return {
      id: report.id,
      patientId: report.patientId,
      providerId: report.providerId,
      encounterRef: report.encounterRef,
      documentId: report.documentId,
      type: report.type,
      status: report.status,
      finalizedAt: report.finalizedAt,
      releasedAt: report.releasedAt,
      createdAt: report.createdAt,
      accessBasis: basis,
      attestation: report.signature ? { algorithm: report.signatureAlgorithm, keyId: report.signatureKeyId, payloadDigest: report.payloadDigest } : null,
      data,
    };
  }

  private async assertReportIntegrity(report: DiagnosticReport) {
    if (!report.signature || !report.signatureAlgorithm || !report.signatureKeyId) throw new ConflictException("Final diagnostic report attestation is incomplete.");
    const envelope = this.reportEnvelope(report);
    const material = this.reportMaterial(report.type as DiagnosticType, report.patientId, report.providerId, report.encounterRef, report.documentId, envelope);
    const verified = await this.attestation.verify(material, report.signature, report.signatureKeyId, report.signatureAlgorithm);
    if (this.attestation.digest(material) !== report.payloadDigest || !verified) throw new ConflictException("Diagnostic report attestation verification failed.");
  }

  private async documentAccessBasis(principal: AuthPrincipal, document: ClinicalDocument): Promise<AccessBasis | null> {
    if (document.status !== "AVAILABLE") return null;
    if (principal.role === "PATIENT") {
      const patient = await this.requirePatient(principal);
      return patient.id === document.patientId && document.releasedToPatient ? "PATIENT_SELF" : null;
    }
    if (principal.role === "DOCTOR" || principal.role === "OTHER_PROVIDER") {
      const provider = await this.requireActiveProvider(principal);
      if (provider.id === document.providerId) return "OWN_AUTHORSHIP";
      return this.providerPatientAccessBasis(provider.id, document.patientId);
    }
    return null;
  }

  private async providerPatientAccessBasis(providerId: string, patientId: string): Promise<Exclude<AccessBasis, "PATIENT_SELF"> | null> {
    const now = new Date();
    const from = new Date(now.getTime() - TREATMENT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const to = new Date(now.getTime() + TREATMENT_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);
    const relationship = await this.prisma.appointment.findFirst({ where: { providerId, patientId, status: { in: ["CONFIRMED", "COMPLETED"] }, startsAt: { gte: from, lte: to } }, select: { id: true } });
    if (relationship) return "TREATMENT_RELATIONSHIP";
    const consent = await this.prisma.consent.findFirst({
      where: {
        patientId,
        scope: DOCUMENT_CONSENT_SCOPE,
        state: "GRANTED",
        AND: [{ OR: [{ providerId }, { providerId: null }] }, { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }],
      },
      select: { version: true },
      orderBy: { grantedAt: "desc" },
    });
    if (consent?.version === DOCUMENT_CONSENT_VERSION) return "PATIENT_CONSENT";
    const ownDocument = await this.prisma.clinicalDocument.findFirst({ where: { providerId, patientId, status: "AVAILABLE" }, select: { id: true } });
    const ownReport = await this.prisma.diagnosticReport.findFirst({ where: { providerId, patientId }, select: { id: true } });
    return ownDocument || ownReport ? "OWN_AUTHORSHIP" : null;
  }

  private async requireActiveProvider(principal: AuthPrincipal): Promise<ProviderContext> {
    if (principal.role !== "DOCTOR" && principal.role !== "OTHER_PROVIDER") throw new ForbiddenException("An active healthcare provider account is required.");
    const provider = await this.prisma.provider.findUnique({ where: { userId: principal.accountId }, select: { id: true, class: true, status: true } });
    if (!provider || provider.status !== "ACTIVE") throw new ForbiddenException("An active healthcare provider profile is required.");
    return provider;
  }

  private async requireAppointment(appointmentId: string) {
    const appointment = await this.prisma.appointment.findUnique({ where: { id: appointmentId }, select: { id: true, patientId: true, providerId: true, status: true } });
    if (!appointment) throw new NotFoundException("Appointment not found.");
    return appointment;
  }

  private async requirePatient(principal: AuthPrincipal) {
    const patient = await this.prisma.patientProfile.findUnique({ where: { userId: principal.accountId }, select: { id: true } });
    if (!patient) throw new NotFoundException("Patient profile not found.");
    return patient;
  }

  private async requirePatientById(patientId: string) {
    const patient = await this.prisma.patientProfile.findUnique({ where: { id: patientId }, select: { id: true } });
    if (!patient) throw new NotFoundException("Patient not found.");
    return patient;
  }

  private async requireDocument(documentId: string): Promise<ClinicalDocument> {
    const document = await this.prisma.clinicalDocument.findUnique({ where: { id: documentId } });
    if (!document) throw new NotFoundException("Clinical document not found.");
    return document;
  }

  private async requireReport(reportId: string): Promise<DiagnosticReport> {
    const report = await this.prisma.diagnosticReport.findUnique({ where: { id: reportId } });
    if (!report) throw new NotFoundException("Diagnostic report not found.");
    return report;
  }

  private metadataEnvelope(document: ClinicalDocument): EncryptedEnvelope {
    if (document.metadataAlgorithm !== "AES-256-GCM") throw new ConflictException("Unsupported document metadata encryption algorithm.");
    return { version: 1, algorithm: "AES-256-GCM", keyId: document.metadataKeyId, wrappedKey: document.metadataWrappedKey, iv: document.metadataIv, ciphertext: document.metadataCiphertext };
  }

  private blobEnvelope(document: ClinicalDocument, ciphertext: string): EncryptedEnvelope {
    if (document.blobAlgorithm !== "AES-256-GCM" || !document.blobKeyId || !document.blobWrappedKey || !document.blobIv) throw new ConflictException("Unsupported document blob encryption envelope.");
    return { version: 1, algorithm: "AES-256-GCM", keyId: document.blobKeyId, wrappedKey: document.blobWrappedKey, iv: document.blobIv, ciphertext };
  }

  private reportEnvelope(report: DiagnosticReport): EncryptedEnvelope {
    if (report.algorithm !== "AES-256-GCM") throw new ConflictException("Unsupported diagnostic report encryption algorithm.");
    return { version: 1, algorithm: "AES-256-GCM", keyId: report.keyId, wrappedKey: report.wrappedKey, iv: report.iv, ciphertext: report.ciphertext };
  }

  private reportMaterial(type: DiagnosticType, patientId: string, providerId: string, encounterRef: string, documentId: string | null, envelope: EncryptedEnvelope): string {
    return JSON.stringify({ schemaVersion: 1, type, patientId, providerId, encounterRef, documentId, envelope });
  }

  private validateDiagnosticPayload(input: JsonObject): JsonObject {
    const result: JsonObject = { findings: this.requiredText(input.findings, 20000, "findings") };
    for (const key of ["impression", "recommendation", "method", "comparison"]) {
      const value = this.optionalText(input[key], 10000);
      if (value) result[key] = value;
    }
    if (input.codes !== undefined) {
      if (!Array.isArray(input.codes) || input.codes.length > 100) throw new BadRequestException("codes must contain at most 100 items.");
      result.codes = input.codes.map((item, index) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) throw new BadRequestException(`codes[${index}] must be an object.`);
        const raw = item as JsonObject;
        return { system: this.optionalText(raw.system, 100), code: this.requiredText(raw.code, 100, `codes[${index}].code`), display: this.optionalText(raw.display, 500) };
      });
    }
    if (Buffer.byteLength(JSON.stringify(result), "utf8") > 64 * 1024) throw new BadRequestException("Diagnostic report payload is too large.");
    return result;
  }

  private documentKind(value: unknown, allowPatientUpload: boolean): DocumentKind {
    const kind = this.requiredText(value, 50, "kind").toUpperCase() as DocumentKind;
    const allowed: DocumentKind[] = ["CLINICAL_ATTACHMENT", "LAB_REPORT", "IMAGING_REPORT", "IMAGING_REFERENCE", "PATHOLOGY_REPORT", "OTHER", ...(allowPatientUpload ? ["PATIENT_UPLOAD" as const] : [])];
    if (!allowed.includes(kind)) throw new BadRequestException("Unsupported clinical document kind.");
    return kind;
  }

  private diagnosticType(value: unknown): DiagnosticType {
    const type = this.requiredText(value, 30, "type").toUpperCase() as DiagnosticType;
    if (!["IMAGING", "PATHOLOGY", "OTHER"].includes(type)) throw new BadRequestException("Diagnostic report type must be IMAGING, PATHOLOGY or OTHER.");
    return type;
  }

  private decodeBase64(value: unknown): Uint8Array {
    if (typeof value !== "string" || value.length < 1) throw new BadRequestException("contentBase64 is required.");
    const normalized = value.replace(/\s/g, "");
    if (normalized.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) throw new BadRequestException("contentBase64 is invalid.");
    return Uint8Array.from(Buffer.from(normalized, "base64"));
  }

  private requiredText(value: unknown, max: number, field: string): string {
    if (typeof value !== "string" || !value.trim()) throw new BadRequestException(`${field} is required.`);
    const result = value.trim();
    if (result.length > max) throw new BadRequestException(`${field} exceeds ${max} characters.`);
    return result;
  }

  private optionalText(value: unknown, max: number): string | null {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string") throw new BadRequestException("Optional text field must be a string.");
    const result = value.trim();
    if (result.length > max) throw new BadRequestException(`Optional text field exceeds ${max} characters.`);
    return result || null;
  }
}
