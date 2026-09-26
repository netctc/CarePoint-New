import { Body, Controller, Get, Header, Module, Param, Patch, Post, Query } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { ClinicalModule } from "../clinical/clinical.module";
import { QuestionnaireTriggersModule } from "../questionnaire-triggers/questionnaire-triggers.module";
import { OrdersModule } from "../orders/orders.module";
import {
  ClinicalProfileService,
  type CreateClinicalProfileEntryInput,
  type UpdateClinicalProfileEntryInput,
  type VerifyClinicalProfileEntryInput,
} from "./clinical-profile.service";
import { DataCorrectionService } from "./data-correction.service";
import {
  MedicationReconciliationService,
  type SignedMedicationReconciliationInput,
} from "./medication-reconciliation.service";

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

@Controller("patient/clinical-profile/medications")
class PatientMedicationReconciliationController {
  constructor(private readonly reconciliation: MedicationReconciliationService) {}

  @RequirePermissions("PATIENT_MANAGE_CLINICAL_PROFILE")
  @Get("reconciliation")
  @Header("Cache-Control", "no-store")
  get(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.reconciliation.mine(principal);
  }
}

@Controller("patient/data-correction-requests")
class PatientDataCorrectionController {
  constructor(private readonly corrections: DataCorrectionService) {}

  @RequirePermissions("PATIENT_MANAGE_CLINICAL_PROFILE")
  @Get()
  @Header("Cache-Control", "no-store")
  list(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.corrections.listMine(principal);
  }

  @RequirePermissions("PATIENT_MANAGE_CLINICAL_PROFILE")
  @Post()
  @Header("Cache-Control", "no-store")
  create(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() body: Record<string, unknown>,
  ) {
    return this.corrections.createMine(principal, body);
  }
}

@Controller("doctor/patients")
class DoctorClinicalProfileController {
  constructor(
    private readonly profile: ClinicalProfileService,
    private readonly reconciliation: MedicationReconciliationService,
  ) {}

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

  @RequirePermissions("CLINICAL_PROFILE_READ")
  @Get(":patientId/clinical-profile/medications/reconciliation")
  @Header("Cache-Control", "no-store")
  medicationReconciliation(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("patientId") patientId: string,
  ) {
    return this.reconciliation.forDoctor(principal, patientId);
  }

  @RequirePermissions("CLINICAL_PROFILE_WRITE")
  @Post(":patientId/clinical-profile/medications/reconcile")
  @Header("Cache-Control", "no-store")
  reconcile(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("patientId") patientId: string,
    @Body() body: SignedMedicationReconciliationInput,
  ) {
    return this.reconciliation.reconcile(principal, patientId, body);
  }
}

@Controller("provider")
class ProviderDataCorrectionController {
  constructor(private readonly corrections: DataCorrectionService) {}

  @RequirePermissions("CLINICAL_PROFILE_READ")
  @Get("patients/:patientId/data-correction-requests")
  @Header("Cache-Control", "no-store")
  list(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("patientId") patientId: string,
  ) {
    return this.corrections.listForDoctor(principal, patientId);
  }

  @RequirePermissions("CLINICAL_PROFILE_WRITE")
  @Post("patient-data/:entryId/verification")
  @Header("Cache-Control", "no-store")
  decide(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("entryId") entryId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.corrections.decide(principal, entryId, body);
  }
}

@Module({
  imports: [ClinicalModule, QuestionnaireTriggersModule, OrdersModule],
  controllers: [
    PatientClinicalProfileController,
    PatientMedicationReconciliationController,
    PatientDataCorrectionController,
    DoctorClinicalProfileController,
    ProviderDataCorrectionController,
  ],
  providers: [ClinicalProfileService, DataCorrectionService, MedicationReconciliationService],
  exports: [ClinicalProfileService, DataCorrectionService, MedicationReconciliationService],
})
export class ClinicalProfileModule {}
