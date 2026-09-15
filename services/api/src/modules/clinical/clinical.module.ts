import { Body, Controller, Get, Module, Param, Post } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { DocumentsModule } from "../documents/documents.module";
import { OrdersModule } from "../orders/orders.module";
import { ClinicalEnvelopeService } from "./clinical-envelope.service";
import { ClinicalService } from "./clinical.service";
import { ClinicalSystemExportService } from "./clinical-system-export.service";
import { ClinicalWorkspaceService } from "./clinical-workspace.service";

@Controller("clinical")
class ClinicalController {
  constructor(
    private readonly clinical: ClinicalService,
    private readonly workspace: ClinicalWorkspaceService,
  ) {}

  @RequirePermissions("PATIENT_READ_CLINICAL_RECORD")
  @Get("timeline")
  timeline(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.clinical.patientTimeline(principal);
  }

  @RequirePermissions("CLINICAL_RECORD_READ")
  @Get("patients/roster")
  providerRoster(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.workspace.providerRoster(principal);
  }

  @RequirePermissions("CLINICAL_RECORD_READ")
  @Get("patients/:patientId/workspace")
  providerWorkspace(@CurrentPrincipal() principal: AuthPrincipal, @Param("patientId") patientId: string) {
    return this.workspace.providerWorkspace(principal, patientId);
  }

  @RequirePermissions("CLINICAL_RECORD_READ")
  @Get("patients/:patientId/timeline")
  providerTimeline(@CurrentPrincipal() principal: AuthPrincipal, @Param("patientId") patientId: string) {
    return this.clinical.providerPatientTimeline(principal, patientId);
  }

  @RequirePermissions("PATIENT_READ_CLINICAL_RECORD", "CLINICAL_RECORD_READ")
  @Get("appointments/:appointmentId")
  encounter(@CurrentPrincipal() principal: AuthPrincipal, @Param("appointmentId") appointmentId: string) {
    return this.clinical.getEncounter(principal, appointmentId);
  }

  @RequirePermissions("CLINICAL_RECORD_WRITE")
  @Post("appointments/:appointmentId/records")
  write(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("appointmentId") appointmentId: string,
    @Body() body: any,
  ) {
    return this.clinical.writeRecord(principal, appointmentId, body);
  }

  @RequirePermissions("CLINICAL_RECORD_WRITE")
  @Post("appointments/:appointmentId/finalize")
  finalize(@CurrentPrincipal() principal: AuthPrincipal, @Param("appointmentId") appointmentId: string) {
    return this.clinical.finalizeEncounter(principal, appointmentId);
  }
}

@Module({
  imports: [OrdersModule, DocumentsModule],
  controllers: [ClinicalController],
  providers: [ClinicalService, ClinicalEnvelopeService, ClinicalSystemExportService, ClinicalWorkspaceService],
  exports: [ClinicalService, ClinicalSystemExportService],
})
export class ClinicalModule {}
