import { Module } from "@nestjs/common";
import { ClinicalMediaController } from "./clinical-media.controller";
import { ClinicalMediaService } from "./clinical-media.service";
import { assertProductionClinicalMediaBodyCapacity } from "./clinical-media-runtime";
import { DocumentMalwareScannerService } from "./document-malware-scanner.service";
import { DocumentStorageService } from "./document-storage.service";
import { DocumentsEnvelopeService } from "./documents-envelope.service";

assertProductionClinicalMediaBodyCapacity();

@Module({
  controllers: [ClinicalMediaController],
  providers: [
    ClinicalMediaService,
    DocumentStorageService,
    DocumentsEnvelopeService,
    DocumentMalwareScannerService,
  ],
  exports: [ClinicalMediaService],
})
export class ClinicalMediaModule {}
