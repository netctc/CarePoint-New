import { Injectable } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { DocumentsService } from "../documents/documents.service";
import { DocumentsImagingInteropService, type AuthorizedImagingStudyView } from "../documents/documents-imaging-interop.service";

const FHIR_VERSION = "4.0.1";

type FhirResource = Record<string, unknown>;
type JsonObject = Record<string, unknown>;

type DocumentView = {
  id: string;
  patientId: string;
  providerId: string | null;
  encounterRef: string | null;
  orderId: string | null;
  kind: string;
  status: string;
  storageMode: string;
  mediaType: string | null;
  byteLength: number | null;
  releasedToPatient: boolean;
  releasedAt: Date | string | null;
  createdAt: Date | string;
  accessBasis: string;
  metadata: JsonObject;
};

type DiagnosticReportView = {
  id: string;
  patientId: string;
  providerId: string;
  encounterRef: string;
  documentId: string | null;
  type: string;
  status: string;
  finalizedAt: Date | string | null;
  releasedAt: Date | string | null;
  createdAt: Date | string;
  accessBasis: string;
  data: JsonObject;
};

@Injectable()
export class FhirDocumentsService {
  constructor(
    private readonly documents: DocumentsService,
    private readonly imaging: DocumentsImagingInteropService,
    private readonly audit: DatabaseAuditService,
  ) {}

  augmentCapability(statement: FhirResource): FhirResource {
    const rest = Array.isArray(statement.rest) ? [...statement.rest] : [];
    const server: JsonObject = rest.length > 0 && this.isObject(rest[0]) ? { ...rest[0] } : { mode: "server" };
    const resources = Array.isArray(server.resource) ? [...server.resource] : [];
    this.appendCapability(resources, { type: "DiagnosticReport", interaction: [{ code: "read" }] });
    this.appendCapability(resources, { type: "DocumentReference", interaction: [{ code: "read" }] });
    this.appendCapability(resources, { type: "ImagingStudy", interaction: [{ code: "read" }] });
    server.resource = resources;
    if (rest.length > 0) rest[0] = server;
    else rest.push(server);

    const software = this.isObject(statement.software) ? statement.software : {};
    return {
      ...statement,
      software: { ...software, version: "slice-10.4" },
      rest,
    };
  }

  async diagnosticReport(principal: AuthPrincipal, reportId: string): Promise<FhirResource> {
    const report = await this.documents.getDiagnosticReport(principal, reportId) as DiagnosticReportView;
    const resource = this.toDiagnosticReport(report);
    await this.audit.write({
      actorId: principal.accountId,
      action: "FHIR_DIAGNOSTIC_REPORT_READ",
      objectType: "DIAGNOSTIC_REPORT",
      objectId: report.id,
      purpose: this.purpose(report.accessBasis),
      result: "SUCCESS",
      metadata: { basis: report.accessBasis, fhirVersion: FHIR_VERSION },
    });
    return resource;
  }

  async documentReference(principal: AuthPrincipal, documentId: string): Promise<FhirResource> {
    const document = await this.documents.documentContent(principal, documentId) as DocumentView;
    const resource = this.toDocumentReference(document);
    await this.audit.write({
      actorId: principal.accountId,
      action: "FHIR_DOCUMENT_REFERENCE_READ",
      objectType: "CLINICAL_DOCUMENT",
      objectId: document.id,
      purpose: this.purpose(document.accessBasis),
      result: "SUCCESS",
      metadata: {
        basis: document.accessBasis,
        storageMode: document.storageMode,
        releasedToPatient: document.releasedToPatient,
        fhirVersion: FHIR_VERSION,
      },
    });
    return resource;
  }

  async imagingStudy(principal: AuthPrincipal, documentId: string): Promise<FhirResource> {
    const study = await this.imaging.imagingStudy(principal, documentId);
    const resource = this.toImagingStudy(study);
    await this.audit.write({
      actorId: principal.accountId,
      action: "FHIR_IMAGING_STUDY_READ",
      objectType: "CLINICAL_DOCUMENT",
      objectId: study.id,
      purpose: this.purpose(study.accessBasis),
      result: "SUCCESS",
      metadata: {
        basis: study.accessBasis,
        dicomScope: study.dicom.scope,
        proxyRequired: study.dicom.proxyRequired,
        fhirVersion: FHIR_VERSION,
      },
    });
    return resource;
  }

  private toDiagnosticReport(report: DiagnosticReportView): FhirResource {
    const conclusion = this.diagnosticConclusion(report.data);
    const conclusionCode = this.diagnosticCodes(report.data.codes);
    return {
      resourceType: "DiagnosticReport",
      id: report.id,
      status: report.status === "DRAFT" ? "preliminary" : "final",
      code: {
        coding: [{
          system: "urn:carepoint:diagnostic-report-type",
          code: report.type,
          display: diagnosticTypeDisplay(report.type),
        }],
        text: diagnosticTypeDisplay(report.type),
      },
      subject: { reference: `Patient/${report.patientId}` },
      encounter: { reference: `Encounter/${report.encounterRef}` },
      effectiveDateTime: this.iso(report.createdAt),
      issued: this.iso(report.finalizedAt ?? report.releasedAt ?? report.createdAt),
      performer: [{ reference: `Practitioner/${report.providerId}` }],
      resultsInterpreter: [{ reference: `Practitioner/${report.providerId}` }],
      ...(conclusion ? { conclusion } : {}),
      ...(conclusionCode.length > 0 ? { conclusionCode } : {}),
      ...(report.documentId
        ? {
            presentedForm: [{
              url: `DocumentReference/${report.documentId}`,
              title: "Associated clinical document",
            }],
          }
        : {}),
    };
  }

  private toDocumentReference(document: DocumentView): FhirResource {
    const metadata = this.isObject(document.metadata) ? document.metadata : {};
    const title = this.firstText(metadata.title, metadata.fileName, metadata.description) ?? diagnosticDocumentDisplay(document.kind);
    const attachment: JsonObject = { title };
    if (document.mediaType) attachment.contentType = document.mediaType;
    if (typeof document.byteLength === "number") attachment.size = document.byteLength;
    if (document.storageMode === "ENCRYPTED_BLOB") {
      attachment.url = `/api/v1/clinical-documents/${encodeURIComponent(document.id)}/download`;
    }

    return {
      resourceType: "DocumentReference",
      id: document.id,
      status: "current",
      docStatus: document.releasedToPatient ? "final" : "preliminary",
      type: {
        coding: [{
          system: "urn:carepoint:clinical-document-kind",
          code: document.kind,
          display: diagnosticDocumentDisplay(document.kind),
        }],
        text: diagnosticDocumentDisplay(document.kind),
      },
      subject: { reference: `Patient/${document.patientId}` },
      date: this.iso(document.createdAt),
      ...(document.providerId ? { author: [{ reference: `Practitioner/${document.providerId}` }] } : {}),
      description: title,
      content: [{
        attachment,
        format: {
          system: "urn:carepoint:document-storage-mode",
          code: document.storageMode,
          display: document.storageMode === "EXTERNAL_REFERENCE" ? "External reference" : "Encrypted document",
        },
      }],
      ...(document.encounterRef
        ? { context: { encounter: [{ reference: `Encounter/${document.encounterRef}` }] } }
        : {}),
    };
  }

  private toImagingStudy(study: AuthorizedImagingStudyView): FhirResource {
    const description = this.firstText(study.title, study.description);
    return {
      resourceType: "ImagingStudy",
      id: study.id,
      identifier: [{
        system: "urn:dicom:uid",
        value: `urn:oid:${study.dicom.studyInstanceUid}`,
      }],
      status: "available",
      subject: { reference: `Patient/${study.patientId}` },
      ...(study.encounterRef ? { encounter: { reference: `Encounter/${study.encounterRef}` } } : {}),
      ...(description ? { description } : {}),
    };
  }

  private diagnosticConclusion(data: JsonObject): string | null {
    const findings = this.text(data.findings);
    const impression = this.text(data.impression);
    const recommendation = this.text(data.recommendation);
    const sections = [
      findings ? `Findings: ${findings}` : null,
      impression ? `Impression: ${impression}` : null,
      recommendation ? `Recommendation: ${recommendation}` : null,
    ].filter((value): value is string => Boolean(value));
    return sections.length > 0 ? sections.join("\n\n") : null;
  }

  private diagnosticCodes(value: unknown): JsonObject[] {
    if (!Array.isArray(value)) return [];
    const concepts: JsonObject[] = [];
    for (const item of value) {
      if (!this.isObject(item)) continue;
      const code = this.text(item.code);
      if (!code) continue;
      const coding: JsonObject = { code };
      const system = this.text(item.system);
      const display = this.text(item.display);
      if (system) coding.system = system;
      if (display) coding.display = display;
      concepts.push({ coding: [coding], ...(display ? { text: display } : {}) });
    }
    return concepts;
  }

  private appendCapability(resources: unknown[], resource: JsonObject): void {
    const type = resource.type;
    const exists = resources.some((candidate) => this.isObject(candidate) && candidate.type === type);
    if (!exists) resources.push(resource);
  }

  private purpose(accessBasis: string): "PATIENT_ACCESS" | "TREATMENT" {
    return accessBasis === "PATIENT_SELF" ? "PATIENT_ACCESS" : "TREATMENT";
  }

  private iso(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  }

  private firstText(...values: unknown[]): string | null {
    for (const value of values) {
      const text = this.text(value);
      if (text) return text;
    }
    return null;
  }

  private text(value: unknown): string | null {
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }

  private isObject(value: unknown): value is JsonObject {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }
}

function diagnosticTypeDisplay(type: string): string {
  switch (type) {
    case "IMAGING": return "Imaging diagnostic report";
    case "PATHOLOGY": return "Pathology diagnostic report";
    default: return "Diagnostic report";
  }
}

function diagnosticDocumentDisplay(kind: string): string {
  switch (kind) {
    case "IMAGING_REPORT": return "Imaging report";
    case "IMAGING_REFERENCE": return "Imaging reference";
    case "PATHOLOGY_REPORT": return "Pathology report";
    case "LAB_REPORT": return "Laboratory report";
    case "PATIENT_UPLOAD": return "Patient-provided document";
    case "CLINICAL_ATTACHMENT": return "Clinical attachment";
    default: return "Clinical document";
  }
}
