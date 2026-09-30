import { Body, Controller, Get, Header, Module, Param, Post, Query } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { ClinicalModule } from "../clinical/clinical.module";
import {
  SymptomReportService,
  type CreateSymptomReportInput,
  type ListSymptomReportQuery,
} from "./symptom-report.service";

@Controller("patient/symptoms")
class PatientSymptomReportController {
  constructor(private readonly symptoms: SymptomReportService) {}

  @RequirePermissions("PATIENT_MANAGE_CLINICAL_PROFILE")
  @Post()
  @Header("Cache-Control", "no-store")
  create(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: CreateSymptomReportInput) {
    return this.symptoms.createMine(principal, body);
  }

  @RequirePermissions("PATIENT_MANAGE_CLINICAL_PROFILE")
  @Get()
  @Header("Cache-Control", "no-store")
  list(@CurrentPrincipal() principal: AuthPrincipal, @Query() query: ListSymptomReportQuery) {
    return this.symptoms.listMine(principal, query);
  }
}

@Controller("doctor/patients/:patientId/symptoms")
class DoctorSymptomReportController {
  constructor(private readonly symptoms: SymptomReportService) {}

  @RequirePermissions("CLINICAL_PROFILE_READ")
  @Get()
  @Header("Cache-Control", "no-store")
  list(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("patientId") patientId: string,
    @Query() query: ListSymptomReportQuery,
  ) {
    return this.symptoms.listForDoctor(principal, patientId, query);
  }
}

@Module({
  imports: [ClinicalModule],
  controllers: [PatientSymptomReportController, DoctorSymptomReportController],
  providers: [SymptomReportService],
  exports: [SymptomReportService],
})
export class SymptomReportModule {}
