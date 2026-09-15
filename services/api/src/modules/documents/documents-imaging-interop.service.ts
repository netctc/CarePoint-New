import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { ClinicalDocument } from "@prisma/client";
import type { EncryptedEnvelope } from "@carepoint/security";
import type { AuthPrincipal } from "@carepoint/identity";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DocumentsService } from "./documents.service";
import { DocumentsEnvelopeService } from "./documents-envelope.service";
import { DicomWebService, type DicomWebReferenceDescriptor } from "./dicomweb.service";

type JsonObject = Record<string, unknown>;
type AuthorizedDocumentView = {
  id: string;
  patientId: string;
  providerId: string | null;
  encounterRef: string | null;
  orderId: string | null;
  kind: string;
  status: string;
  storageMode: string;
  releasedToPatient: boolean;
  releasedAt: Date | string | null;
  createdAt: Date | string;
  accessBasis: string;
  metadata: JsonObject;
};

export type AuthorizedImagingStudyView = {
  id: string;
  patientId: string;
  providerId: string | null;
  encounterRef: string | null;
  orderId: string | null;
  releasedToPatient: boolean;
  releasedAt: Date | string | null;
  createdAt: Date | string;
  accessBasis: string;
  title: string | null;
  description: string | null;
  dicom: DicomWebReferenceDescriptor;
};

@Injectable()
export class DocumentsImagingInteropService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
    private readonly envelope: DocumentsEnvelopeService,
    private readonly dicomweb: DicomWebService,
  ) {}

  async imagingStudy(principal: AuthPrincipal, documentId: string): Promise<AuthorizedImagingStudyView> {
    // Reuse the canonical document access path first. This preserves patient release
    // gates, provider treatment relationships, consent and the existing access audit.
    const authorized = await this.documents.documentContent(principal, documentId) as AuthorizedDocumentView;
    if (authorized.kind !== "IMAGING_REFERENCE" || authorized.storageMode !== "EXTERNAL_REFERENCE") {
      throw new NotFoundException("Imaging study not found.");
    }

    const document = await this.prisma.clinicalDocument.findUnique({ where: { id: documentId } });
    if (!document || document.status !== "AVAILABLE") throw new NotFoundException("Imaging study not found.");

    const metadata = await this.envelope.decryptMetadata<JsonObject>(this.metadataEnvelope(document));
    const externalReference = this.text(metadata.externalReference);
    if (!externalReference) throw new ConflictException("Stored imaging reference is incomplete.");

    let descriptor: DicomWebReferenceDescriptor;
    try {
      descriptor = this.dicomweb.inspectReference(externalReference);
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw new ConflictException("Stored imaging reference cannot be represented as a DICOM ImagingStudy.");
      }
      throw error;
    }

    // Slice 10.4 intentionally maps only study-level DICOMweb references. Series and
    // instance resources require modality/SOP-class metadata before they can be mapped
    // without inventing clinical facts.
    if (descriptor.scope !== "STUDY") {
      throw new ConflictException("FHIR ImagingStudy currently requires a study-level DICOMweb reference.");
    }

    const publicMetadata = authorized.metadata && typeof authorized.metadata === "object" ? authorized.metadata : {};
    return {
      id: authorized.id,
      patientId: authorized.patientId,
      providerId: authorized.providerId,
      encounterRef: authorized.encounterRef,
      orderId: authorized.orderId,
      releasedToPatient: authorized.releasedToPatient,
      releasedAt: authorized.releasedAt,
      createdAt: authorized.createdAt,
      accessBasis: authorized.accessBasis,
      title: this.text(publicMetadata.title),
      description: this.text(publicMetadata.description),
      dicom: descriptor,
    };
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

  private text(value: unknown): string | null {
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }
}
