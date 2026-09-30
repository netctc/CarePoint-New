import { Body, Controller, Get, Header, Module, Param, Post, Query, StreamableFile } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { DocumentStorageService } from "../documents/document-storage.service";
import { DocumentsEnvelopeService } from "../documents/documents-envelope.service";
import { AuditExportService, type CreateAuditExportInput } from "./audit-export.service";
import { ClinicalOperationsService } from "./clinical-operations.service";
import { DuplicatePatientService } from "./duplicate-patient.service";
import { IntegrationCenterService } from "./integration-center.service";

@Controller("admin/patient-duplicates")
@RequirePermissions("DATA_GOVERNANCE_MANAGE")
class DuplicatePatientController {
  constructor(private readonly duplicates: DuplicatePatientService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  list(@Query("limit") limit?: string) {
    return this.duplicates.candidates(limit);
  }
}

@Controller("admin/integrations")
@RequirePermissions("DATA_GOVERNANCE_MANAGE")
class IntegrationCenterController {
  constructor(private readonly integrations: IntegrationCenterService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  snapshot() {
    return this.integrations.snapshot();
  }
}

@Controller("admin/clinical-operations")
@RequirePermissions("DATA_GOVERNANCE_MANAGE")
class ClinicalOperationsController {
  constructor(private readonly operations: ClinicalOperationsService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  snapshot(@Query("limit") limit?: string) {
    return this.operations.snapshot(limit);
  }
}

@Controller("admin/audit-exports")
@RequirePermissions("IAM_READ_AUDIT")
class AuditExportController {
  constructor(private readonly exports: AuditExportService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  list(@CurrentPrincipal() principal: AuthPrincipal, @Query("limit") limit?: string) {
    return this.exports.list(principal, limit);
  }

  @Post()
  @Header("Cache-Control", "no-store")
  create(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: CreateAuditExportInput) {
    return this.exports.create(principal, body ?? {});
  }

  @Get(":jobId")
  @Header("Cache-Control", "no-store")
  get(@CurrentPrincipal() principal: AuthPrincipal, @Param("jobId") jobId: string) {
    return this.exports.get(principal, jobId);
  }

  @Post(":jobId/download-token")
  @Header("Cache-Control", "no-store")
  token(@CurrentPrincipal() principal: AuthPrincipal, @Param("jobId") jobId: string) {
    return this.exports.issueDownloadGrant(principal, jobId);
  }

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
      disposition: 'attachment; filename="' + content.fileName + '"',
    });
  }
}

@Module({
  controllers: [
    DuplicatePatientController,
    IntegrationCenterController,
    ClinicalOperationsController,
    AuditExportController,
  ],
  providers: [
    DuplicatePatientService,
    IntegrationCenterService,
    ClinicalOperationsService,
    AuditExportService,
    DocumentStorageService,
    DocumentsEnvelopeService,
  ],
})
export class AdminB6OperationsModule {}
