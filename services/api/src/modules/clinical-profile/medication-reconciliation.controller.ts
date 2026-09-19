import { Body, Controller, Get, Header, Param, Post } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import {
  MedicationReconciliationService,
  type CreateMedicationReconciliationInput,
} from "./medication-reconciliation.service";

@Controller("provider/patients")
export class ProviderMedicationReconciliationController {
  constructor(private readonly reconciliation: MedicationReconciliationService) {}

  @RequirePermissions("CLINICAL_PROFILE_READ")
  @Get(":patientId/medication-reconciliation")
  @Header("Cache-Control", "no-store")
  comparison(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("patientId") patientId: string,
  ) {
    return this.reconciliation.comparisonForDoctor(principal, patientId);
  }

  @RequirePermissions("CLINICAL_PROFILE_WRITE")
  @Post(":patientId/medication-reconciliation")
  @Header("Cache-Control", "no-store")
  create(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("patientId") patientId: string,
    @Body() body: CreateMedicationReconciliationInput,
  ) {
    return this.reconciliation.createForDoctor(principal, patientId, body);
  }
}

@Controller("patient/medications")
export class PatientMedicationReconciliationController {
  constructor(private readonly reconciliation: MedicationReconciliationService) {}

  @RequirePermissions("PATIENT_MANAGE_CLINICAL_PROFILE")
  @Get("reconciliation-status")
  @Header("Cache-Control", "no-store")
  status(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.reconciliation.statusForPatient(principal);
  }
}
