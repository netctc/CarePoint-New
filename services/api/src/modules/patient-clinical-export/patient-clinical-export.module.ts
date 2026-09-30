import { Body, Controller, Get, Header, Module, Param, Post, Query, StreamableFile } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, Public, RequirePermissions } from "../../security/api-security.module";
import { DependentsModule } from "../dependents/dependents.module";
import { DocumentStorageService } from "../documents/document-storage.service";
import { DocumentsEnvelopeService } from "../documents/documents-envelope.service";
import { PatientHealthSummaryModule } from "../patient-health-summary/patient-health-summary.module";
import { PatientClinicalExportAdminService } from "./patient-clinical-export-admin.service";
import {
  PatientClinicalExportService,
  type CreatePatientClinicalExportInput,
} from "./patient-clinical-export.service";
import {
  PatientClinicalShareService,
  type CreatePatientClinicalShareInput,
} from "./patient-clinical-share.service";

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


@Controller("patient/clinical-summary-shares")
class PatientClinicalShareController {
  constructor(private readonly shares: PatientClinicalShareService) {}

  @RequirePermissions("PATIENT_READ_CLINICAL_RECORD")
  @Get()
  @Header("Cache-Control", "no-store")
  list(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.shares.list(principal);
  }

  @RequirePermissions("PATIENT_READ_CLINICAL_RECORD")
  @Post("temporary-link")
  @Header("Cache-Control", "no-store")
  create(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: CreatePatientClinicalShareInput) {
    return this.shares.create(principal, body ?? {});
  }

  @RequirePermissions("PATIENT_READ_CLINICAL_RECORD")
  @Post(":shareId/revoke")
  @Header("Cache-Control", "no-store")
  revoke(@CurrentPrincipal() principal: AuthPrincipal, @Param("shareId") shareId: string) {
    return this.shares.revoke(principal, shareId);
  }
}

@Public()
@Controller("s")
class PublicPatientClinicalShareController {
  constructor(private readonly shares: PatientClinicalShareService) {}

  @Get(":token")
  @Header("Cache-Control", "no-store, max-age=0")
  @Header("Pragma", "no-cache")
  @Header("Referrer-Policy", "no-referrer")
  @Header("X-Content-Type-Options", "nosniff")
  get(@Param("token") token: string) {
    return this.shares.readPublic(token);
  }
}

@Controller("admin/patient-exports")
@RequirePermissions("DATA_GOVERNANCE_MANAGE")
class PatientClinicalExportAdminController {
  constructor(private readonly exports: PatientClinicalExportAdminService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  list(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Query("status") status?: string,
    @Query("limit") limit?: string,
  ) {
    return this.exports.list(principal, status, limit);
  }
}

@Module({
  imports: [DependentsModule, PatientHealthSummaryModule],
  controllers: [
    PatientClinicalExportController,
    PatientClinicalShareController,
    PublicPatientClinicalShareController,
    PatientClinicalExportAdminController,
  ],
  providers: [
    PatientClinicalExportService,
    PatientClinicalExportAdminService,
    PatientClinicalShareService,
    DocumentStorageService,
    DocumentsEnvelopeService,
  ],
})
export class PatientClinicalExportModule {}
