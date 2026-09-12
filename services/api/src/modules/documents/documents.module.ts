import { BadRequestException, Body, Controller, Get, Header, Module, Param, Post, Query, StreamableFile } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { CommunicationsModule } from "../communications/communications.module";
import { DocumentsService } from "./documents.service";
import { DocumentStorageService } from "./document-storage.service";
import { DocumentsEnvelopeService } from "./documents-envelope.service";
import { DocumentsAttestationService } from "./documents-attestation.service";
import { DocumentMalwareScannerService } from "./document-malware-scanner.service";
import { DicomWebService } from "./dicomweb.service";
import { DocumentsImagingInteropService } from "./documents-imaging-interop.service";
import { DocumentsSystemExportService } from "./documents-system-export.service";
import { PatientDocumentCentreService } from "./patient-document-centre.service";

@Controller("clinical-documents")
class ClinicalDocumentsController {
  constructor(
    private readonly documents: DocumentsService,
    private readonly patientCentre: PatientDocumentCentreService,
  ) {}

  @RequirePermissions("CLINICAL_DOCUMENT_WRITE")
  @Post("appointments/:appointmentId/upload")
  upload(@CurrentPrincipal() principal: AuthPrincipal, @Param("appointmentId") appointmentId: string, @Body() body: any) {
    return this.documents.uploadForEncounter(principal, appointmentId, body);
  }

  @RequirePermissions("CLINICAL_DOCUMENT_WRITE")
  @Post("appointments/:appointmentId/reference")
  reference(@CurrentPrincipal() principal: AuthPrincipal, @Param("appointmentId") appointmentId: string, @Body() body: any) {
    return this.documents.createEncounterReference(principal, appointmentId, body);
  }

  @RequirePermissions("PATIENT_WRITE_CLINICAL_DOCUMENTS")
  @Post("me/upload")
  patientUpload(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: any) {
    return this.documents.patientUpload(principal, body);
  }

  @RequirePermissions("PATIENT_READ_CLINICAL_DOCUMENTS")
  @Get("me")
  patientDocuments(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.documents.patientDocuments(principal);
  }

  @RequirePermissions("PATIENT_READ_CLINICAL_DOCUMENTS")
  @Get("me/centre")
  patientDocumentCentre(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Query("kind") kind?: string,
    @Query("q") q?: string,
    @Query("limit") limit?: string,
  ) {
    return this.patientCentre.list(principal, { kind, q, limit });
  }

  @RequirePermissions("PATIENT_READ_CLINICAL_DOCUMENTS")
  @Post("me/:documentId/download-token")
  patientDownloadToken(@CurrentPrincipal() principal: AuthPrincipal, @Param("documentId") documentId: string) {
    return this.patientCentre.issueDownloadGrant(principal, documentId);
  }

  @RequirePermissions("PATIENT_READ_CLINICAL_DOCUMENTS")
  @Post("me/:documentId/download")
  @Header("Cache-Control", "private, no-store, max-age=0")
  @Header("Pragma", "no-cache")
  @Header("X-Content-Type-Options", "nosniff")
  async patientSecureDownload(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("documentId") documentId: string,
    @Body() body: any,
  ) {
    const content = await this.patientCentre.consumeDownloadGrant(principal, documentId, body ?? {});
    return new StreamableFile(content.bytes, {
      type: content.mediaType,
      disposition: `attachment; filename="${this.safeFileName(content.fileName)}"`,
    });
  }

  @RequirePermissions("CLINICAL_DOCUMENT_READ")
  @Get("patients/:patientId")
  providerDocuments(@CurrentPrincipal() principal: AuthPrincipal, @Param("patientId") patientId: string) {
    return this.documents.providerPatientDocuments(principal, patientId);
  }

  @RequirePermissions("PATIENT_READ_CLINICAL_DOCUMENTS", "CLINICAL_DOCUMENT_READ")
  @Get(":documentId/content")
  content(@CurrentPrincipal() principal: AuthPrincipal, @Param("documentId") documentId: string) {
    return this.documents.documentContent(principal, documentId);
  }

  @RequirePermissions("PATIENT_READ_CLINICAL_DOCUMENTS", "CLINICAL_DOCUMENT_READ")
  @Get(":documentId/download")
  @Header("Cache-Control", "private, no-store, max-age=0")
  @Header("Pragma", "no-cache")
  @Header("X-Content-Type-Options", "nosniff")
  async download(@CurrentPrincipal() principal: AuthPrincipal, @Param("documentId") documentId: string) {
    const content = await this.documents.documentContent(principal, documentId) as Record<string, any>;
    if (content.storageMode !== "ENCRYPTED_BLOB" || typeof content.contentBase64 !== "string") {
      throw new BadRequestException("This clinical document does not contain downloadable binary content.");
    }
    const metadata = content.metadata && typeof content.metadata === "object" ? content.metadata as Record<string, unknown> : {};
    const fileName = this.safeFileName(typeof metadata.fileName === "string" ? metadata.fileName : `carepoint-document-${documentId}`);
    return new StreamableFile(Buffer.from(content.contentBase64, "base64"), {
      type: typeof content.mediaType === "string" ? content.mediaType : "application/octet-stream",
      disposition: `attachment; filename="${fileName}"`,
    });
  }

  @RequirePermissions("CLINICAL_DOCUMENT_WRITE")
  @Post(":documentId/release")
  release(@CurrentPrincipal() principal: AuthPrincipal, @Param("documentId") documentId: string) {
    return this.documents.releaseDocument(principal, documentId);
  }

  @RequirePermissions("PATIENT_WRITE_CLINICAL_DOCUMENTS", "CLINICAL_DOCUMENT_WRITE")
  @Post(":documentId/remove")
  remove(@CurrentPrincipal() principal: AuthPrincipal, @Param("documentId") documentId: string) {
    return this.documents.removeDocument(principal, documentId);
  }

  private safeFileName(value: string): string {
    const cleaned = value.replace(/[\r\n"\\/<>:*?\u0000-\u001F]/g, "_").trim();
    return (cleaned || "carepoint-document").slice(0, 180);
  }
}

@Controller("diagnostic-reports")
class DiagnosticReportsController {
  constructor(private readonly documents: DocumentsService) {}

  @RequirePermissions("DIAGNOSTIC_REPORT_WRITE")
  @Post("appointments/:appointmentId")
  create(@CurrentPrincipal() principal: AuthPrincipal, @Param("appointmentId") appointmentId: string, @Body() body: any) {
    return this.documents.createDiagnosticReport(principal, appointmentId, body);
  }

  @RequirePermissions("DIAGNOSTIC_REPORT_WRITE")
  @Post(":reportId/finalize")
  finalize(@CurrentPrincipal() principal: AuthPrincipal, @Param("reportId") reportId: string) {
    return this.documents.finalizeDiagnosticReport(principal, reportId);
  }

  @RequirePermissions("DIAGNOSTIC_REPORT_WRITE")
  @Post(":reportId/release")
  release(@CurrentPrincipal() principal: AuthPrincipal, @Param("reportId") reportId: string) {
    return this.documents.releaseDiagnosticReport(principal, reportId);
  }

  @RequirePermissions("PATIENT_READ_CLINICAL_DOCUMENTS")
  @Get("me")
  patientReports(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.documents.patientDiagnosticReports(principal);
  }

  @RequirePermissions("CLINICAL_DOCUMENT_READ")
  @Get("patients/:patientId")
  providerReports(@CurrentPrincipal() principal: AuthPrincipal, @Param("patientId") patientId: string) {
    return this.documents.providerPatientDiagnosticReports(principal, patientId);
  }

  @RequirePermissions("PATIENT_READ_CLINICAL_DOCUMENTS", "CLINICAL_DOCUMENT_READ")
  @Get(":reportId")
  report(@CurrentPrincipal() principal: AuthPrincipal, @Param("reportId") reportId: string) {
    return this.documents.getDiagnosticReport(principal, reportId);
  }
}

@Module({
  imports: [CommunicationsModule],
  controllers: [ClinicalDocumentsController, DiagnosticReportsController],
  providers: [
    DocumentsService,
    DocumentStorageService,
    DocumentsEnvelopeService,
    DocumentsAttestationService,
    DocumentMalwareScannerService,
    DicomWebService,
    DocumentsImagingInteropService,
    DocumentsSystemExportService,
    PatientDocumentCentreService,
  ],
  exports: [DocumentsService, DocumentStorageService, DocumentsImagingInteropService, DocumentsSystemExportService],
})
export class DocumentsModule {}
