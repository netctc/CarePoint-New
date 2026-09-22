import { Module } from "@nestjs/common";
import { ClinicalMediaController } from "./clinical-media.controller";
import { ClinicalMediaService } from "./clinical-media.service";
import { ClinicalMediaVersioningController } from "./clinical-media-versioning.controller";
import { ClinicalMediaVersioningService } from "./clinical-media-versioning.service";
import { assertProductionClinicalMediaBodyCapacity } from "./clinical-media-runtime";
import { DocumentMalwareScannerService } from "./document-malware-scanner.service";
import { DocumentStorageService } from "./document-storage.service";
import { DocumentsEnvelopeService } from "./documents-envelope.service";

assertProductionClinicalMediaBodyCapacity();

@Module({
  controllers: [ClinicalMediaController, ClinicalMediaVersioningController],
  providers: [
    ClinicalMediaService,
    ClinicalMediaVersioningService,
    DocumentStorageService,
    DocumentsEnvelopeService,
    DocumentMalwareScannerService,
  ],
  exports: [ClinicalMediaService, ClinicalMediaVersioningService],
})
export class ClinicalMediaModule {}
