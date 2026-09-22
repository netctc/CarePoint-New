import { Body, Controller, Get, Header, Module, Param, Post, Query, StreamableFile } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { DependentsModule } from "../dependents/dependents.module";
import { DocumentStorageService } from "../documents/document-storage.service";
import { DocumentsEnvelopeService } from "../documents/documents-envelope.service";
import { PatientHealthSummaryModule } from "../patient-health-summary/patient-health-summary.module";
import {
  PatientClinicalExportService,
  type CreatePatientClinicalExportInput,
} from "./patient-clinical-export.service";

@Controller("patient/exports")
class PatientClinicalExportController {
  constructor(private readonly exports: PatientClinicalExportService) {}

  @RequirePermissions("PATIENT_READ_CLINICAL_RECORD")
  @Post()
  @Header("Cache-Control", "no-store")
  create(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: CreatePatientClinicalExportInput) {
    return this.exports.create(principal, body ?? {});
  }

  @RequirePermissions("PATIENT_READ_CLINICAL_RECORD")
  @Get(":jobId")
  @Header("Cache-Control", "no-store")
  get(@CurrentPrincipal() principal: AuthPrincipal, @Param("jobId") jobId: string) {
    return this.exports.get(principal, jobId);
  }

  @RequirePermissions("PATIENT_READ_CLINICAL_RECORD")
  @Post(":jobId/download-token")
  @Header("Cache-Control", "no-store")
  grant(@CurrentPrincipal() principal: AuthPrincipal, @Param("jobId") jobId: string) {
    return this.exports.issueDownloadGrant(principal, jobId);
  }

  @RequirePermissions("PATIENT_READ_CLINICAL_RECORD")
  @Get(":jobId/download")
  @Header("Cache-Control", "private, no-store, max-age=0")
  @Header("Pragma", "no-cache")
  @Header("X-Content-Type-Options", "nosniff")
  async download(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("jobId") jobId: string,
    @Query("token") token: string,
  ) {
    const content = await this.exports.download(principal, jobId, token);
    return new StreamableFile(content.bytes, {
      type: content.mediaType,
      disposition: `attachment; filename="${content.fileName}"`,
    });
  }
}

@Module({
  imports: [DependentsModule, PatientHealthSummaryModule],
  controllers: [PatientClinicalExportController],
  providers: [PatientClinicalExportService, DocumentStorageService, DocumentsEnvelopeService],
})
export class PatientClinicalExportModule {}
