import { Module } from "@nestjs/common";
import { DocumentsModule } from "./documents.module";
import { DocumentVersioningController } from "./document-versioning.controller";
import { DocumentVersioningService } from "./document-versioning.service";
import { DocumentsEnvelopeService } from "./documents-envelope.service";
import { DocumentMalwareScannerService } from "./document-malware-scanner.service";
import { DicomWebService } from "./dicomweb.service";

@Module({
  imports: [DocumentsModule],
  controllers: [DocumentVersioningController],
  providers: [
    DocumentVersioningService,
    DocumentsEnvelopeService,
    DocumentMalwareScannerService,
    DicomWebService,
  ],
})
export class DocumentVersioningModule {}
