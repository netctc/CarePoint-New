import { Controller, Get, Header, Module } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { ClinicalModule } from "../clinical/clinical.module";
import { DependentsModule } from "../dependents/dependents.module";
import { PatientHealthSummaryService } from "./patient-health-summary.service";

@Controller("patient/health-summary")
class PatientHealthSummaryController {
  constructor(private readonly summary: PatientHealthSummaryService) {}

  @RequirePermissions("PATIENT_READ_CLINICAL_RECORD")
  @Get()
  @Header("Cache-Control", "no-store")
  get(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.summary.get(principal);
  }
}

@Module({
  imports: [ClinicalModule, DependentsModule],
  controllers: [PatientHealthSummaryController],
  providers: [PatientHealthSummaryService],
  exports: [PatientHealthSummaryService],
})
export class PatientHealthSummaryModule {}
