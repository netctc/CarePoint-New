import { Body, Controller, Get, Header, Module, Param, Patch, Post, Query } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { ClinicalModule } from "../clinical/clinical.module";
import {
  ClinicalProfileService,
  type CreateClinicalProfileEntryInput,
  type ReconcileMedicationInput,
  type UpdateClinicalProfileEntryInput,
  type VerifyClinicalProfileEntryInput,
} from "./clinical-profile.service";

@Controller("patient/clinical-profile/entries")
class PatientClinicalProfileController {
  constructor(private readonly profile: ClinicalProfileService) {}

  @RequirePermissions("PATIENT_MANAGE_CLINICAL_PROFILE")
  @Get()
  @Header("Cache-Control", "no-store")
  list(@CurrentPrincipal() principal: AuthPrincipal, @Query("kind") kind?: string) {
    return this.profile.listMine(principal, kind);
  }

  @RequirePermissions("PATIENT_MANAGE_CLINICAL_PROFILE")
  @Post()
  @Header("Cache-Control", "no-store")
  create(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: CreateClinicalProfileEntryInput) {
    return this.profile.createMine(principal, body);
  }

  @RequirePermissions("PATIENT_MANAGE_CLINICAL_PROFILE")
  @Patch(":entryId")
  @Header("Cache-Control", "no-store")
  update(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("entryId") entryId: string,
    @Body() body: UpdateClinicalProfileEntryInput,
  ) {
    return this.profile.updateMine(principal, entryId, body);
  }
}

@Controller("doctor/patients")
class DoctorClinicalProfileController {
  constructor(private readonly profile: ClinicalProfileService) {}

  @RequirePermissions("CLINICAL_PROFILE_READ")
  @Get(":patientId/clinical-profile/entries")
  @Header("Cache-Control", "no-store")
  list(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("patientId") patientId: string,
    @Query("kind") kind?: string,
  ) {
    return this.profile.listForDoctor(principal, patientId, kind);
  }

  @RequirePermissions("CLINICAL_PROFILE_WRITE")
  @Post(":patientId/clinical-profile/entries")
  @Header("Cache-Control", "no-store")
  create(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("patientId") patientId: string,
    @Body() body: CreateClinicalProfileEntryInput,
  ) {
    return this.profile.createForDoctor(principal, patientId, body);
  }

  @RequirePermissions("CLINICAL_PROFILE_WRITE")
  @Patch(":patientId/clinical-profile/entries/:entryId")
  @Header("Cache-Control", "no-store")
  update(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("patientId") patientId: string,
    @Param("entryId") entryId: string,
    @Body() body: UpdateClinicalProfileEntryInput,
  ) {
    return this.profile.updateForDoctor(principal, patientId, entryId, body);
  }

  @RequirePermissions("CLINICAL_PROFILE_WRITE")
  @Post(":patientId/clinical-profile/entries/:entryId/verify")
  @Header("Cache-Control", "no-store")
  verify(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("patientId") patientId: string,
    @Param("entryId") entryId: string,
    @Body() body: VerifyClinicalProfileEntryInput,
  ) {
    return this.profile.verifyForDoctor(principal, patientId, entryId, body);
  }

  @RequirePermissions("CLINICAL_PROFILE_WRITE")
  @Post(":patientId/clinical-profile/medications/reconcile")
  @Header("Cache-Control", "no-store")
  reconcile(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("patientId") patientId: string,
    @Body() body: ReconcileMedicationInput,
  ) {
    return this.profile.reconcileMedications(principal, patientId, body);
  }
}

@Module({
  imports: [ClinicalModule],
  controllers: [PatientClinicalProfileController, DoctorClinicalProfileController],
  providers: [ClinicalProfileService],
  exports: [ClinicalProfileService],
})
export class ClinicalProfileModule {}
