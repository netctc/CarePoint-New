import { Body, Controller, Get, Header, Module, Param, Patch, Post } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { ClinicalModule } from "../clinical/clinical.module";
import {
  ClinicalHistoryService,
  type CreateHospitalizationInput,
  type CreateImmunizationInput,
  type UpdateHospitalizationInput,
  type UpdateImmunizationInput,
} from "./clinical-history.service";

@Controller("patient/clinical-history")
class PatientClinicalHistoryController {
  constructor(private readonly history: ClinicalHistoryService) {}

  @RequirePermissions("PATIENT_MANAGE_CLINICAL_PROFILE")
  @Get("hospitalizations")
  @Header("Cache-Control", "no-store")
  hospitalizations(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.history.listHospitalizationsMine(principal);
  }

  @RequirePermissions("PATIENT_MANAGE_CLINICAL_PROFILE")
  @Post("hospitalizations")
  @Header("Cache-Control", "no-store")
  createHospitalization(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: CreateHospitalizationInput) {
    return this.history.createHospitalizationMine(principal, body);
  }

  @RequirePermissions("PATIENT_MANAGE_CLINICAL_PROFILE")
  @Patch("hospitalizations/:id")
  @Header("Cache-Control", "no-store")
  updateHospitalization(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("id") id: string,
    @Body() body: UpdateHospitalizationInput,
  ) {
    return this.history.updateHospitalizationMine(principal, id, body);
  }

  @RequirePermissions("PATIENT_MANAGE_CLINICAL_PROFILE")
  @Get("immunizations")
  @Header("Cache-Control", "no-store")
  immunizations(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.history.listImmunizationsMine(principal);
  }

  @RequirePermissions("PATIENT_MANAGE_CLINICAL_PROFILE")
  @Post("immunizations")
  @Header("Cache-Control", "no-store")
  createImmunization(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: CreateImmunizationInput) {
    return this.history.createImmunizationMine(principal, body);
  }

  @RequirePermissions("PATIENT_MANAGE_CLINICAL_PROFILE")
  @Patch("immunizations/:id")
  @Header("Cache-Control", "no-store")
  updateImmunization(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("id") id: string,
    @Body() body: UpdateImmunizationInput,
  ) {
    return this.history.updateImmunizationMine(principal, id, body);
  }
}

@Controller("doctor/patients/:patientId/clinical-history")
class DoctorClinicalHistoryController {
  constructor(private readonly history: ClinicalHistoryService) {}

  @RequirePermissions("CLINICAL_PROFILE_READ")
  @Get("hospitalizations")
  @Header("Cache-Control", "no-store")
  hospitalizations(@CurrentPrincipal() principal: AuthPrincipal, @Param("patientId") patientId: string) {
    return this.history.listHospitalizationsForDoctor(principal, patientId);
  }

  @RequirePermissions("CLINICAL_PROFILE_WRITE")
  @Post("hospitalizations")
  @Header("Cache-Control", "no-store")
  createHospitalization(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("patientId") patientId: string,
    @Body() body: CreateHospitalizationInput,
  ) {
    return this.history.createHospitalizationForDoctor(principal, patientId, body);
  }

  @RequirePermissions("CLINICAL_PROFILE_WRITE")
  @Patch("hospitalizations/:id")
  @Header("Cache-Control", "no-store")
  updateHospitalization(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("patientId") patientId: string,
    @Param("id") id: string,
    @Body() body: UpdateHospitalizationInput,
  ) {
    return this.history.updateHospitalizationForDoctor(principal, patientId, id, body);
  }

  @RequirePermissions("CLINICAL_PROFILE_READ")
  @Get("immunizations")
  @Header("Cache-Control", "no-store")
  immunizations(@CurrentPrincipal() principal: AuthPrincipal, @Param("patientId") patientId: string) {
    return this.history.listImmunizationsForDoctor(principal, patientId);
  }

  @RequirePermissions("CLINICAL_PROFILE_WRITE")
  @Post("immunizations")
  @Header("Cache-Control", "no-store")
  createImmunization(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("patientId") patientId: string,
    @Body() body: CreateImmunizationInput,
  ) {
    return this.history.createImmunizationForDoctor(principal, patientId, body);
  }

  @RequirePermissions("CLINICAL_PROFILE_WRITE")
  @Patch("immunizations/:id")
  @Header("Cache-Control", "no-store")
  updateImmunization(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("patientId") patientId: string,
    @Param("id") id: string,
    @Body() body: UpdateImmunizationInput,
  ) {
    return this.history.updateImmunizationForDoctor(principal, patientId, id, body);
  }
}

@Module({
  imports: [ClinicalModule],
  controllers: [PatientClinicalHistoryController, DoctorClinicalHistoryController],
  providers: [ClinicalHistoryService],
  exports: [ClinicalHistoryService],
})
export class ClinicalHistoryModule {}
