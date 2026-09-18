import { Body, Controller, Get, Header, Module, Param, Patch, Post } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { ClinicalModule } from "../clinical/clinical.module";
import {
  ClinicalFactsService,
  type CreateClinicalFactInput,
  type DoctorProblemInput,
  type UpdateClinicalFactInput,
  type VerifyClinicalFactInput,
} from "./clinical-facts.service";

@Controller("patient/clinical-facts")
class PatientClinicalFactsController {
  constructor(private readonly facts: ClinicalFactsService) {}

  @RequirePermissions("PATIENT_MANAGE_CLINICAL_FACTS")
  @Get()
  @Header("Cache-Control", "no-store")
  list(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.facts.listMine(principal);
  }

  @RequirePermissions("PATIENT_MANAGE_CLINICAL_FACTS")
  @Post()
  @Header("Cache-Control", "no-store")
  create(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: CreateClinicalFactInput) {
    return this.facts.createMine(principal, body);
  }

  @RequirePermissions("PATIENT_MANAGE_CLINICAL_FACTS")
  @Patch(":factId")
  @Header("Cache-Control", "no-store")
  update(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("factId") factId: string,
    @Body() body: UpdateClinicalFactInput,
  ) {
    return this.facts.updateMine(principal, factId, body);
  }
}

@Controller("doctor/patients")
class DoctorClinicalFactsController {
  constructor(private readonly facts: ClinicalFactsService) {}

  @RequirePermissions("CLINICAL_FACT_READ")
  @Get(":patientId/clinical-snapshot")
  @Header("Cache-Control", "no-store")
  snapshot(@CurrentPrincipal() principal: AuthPrincipal, @Param("patientId") patientId: string) {
    return this.facts.snapshotForDoctor(principal, patientId);
  }

  @RequirePermissions("CLINICAL_FACT_WRITE")
  @Post(":patientId/problems")
  @Header("Cache-Control", "no-store")
  problem(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("patientId") patientId: string,
    @Body() body: DoctorProblemInput,
  ) {
    return this.facts.doctorProblem(principal, patientId, body);
  }

  @RequirePermissions("CLINICAL_FACT_VERIFY")
  @Post(":patientId/clinical-facts/:factId/verify")
  @Header("Cache-Control", "no-store")
  verify(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("patientId") patientId: string,
    @Param("factId") factId: string,
    @Body() body: VerifyClinicalFactInput,
  ) {
    return this.facts.verifyFact(principal, patientId, factId, body);
  }
}

@Module({
  imports: [ClinicalModule],
  controllers: [PatientClinicalFactsController, DoctorClinicalFactsController],
  providers: [ClinicalFactsService],
  exports: [ClinicalFactsService],
})
export class ClinicalFactsModule {}
