import { Body, Controller, Get, Header, Param, Patch, Post } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import {
  AllergyReconciliationService,
  type CreateAllergyInput,
  type UpdateAllergyInput,
  type VerifyAllergyInput,
} from "./allergy-reconciliation.service";

@Controller("provider/patients")
export class ProviderAllergyReconciliationController {
  constructor(private readonly allergies: AllergyReconciliationService) {}

  @RequirePermissions("CLINICAL_PROFILE_READ")
  @Get(":patientId/allergies")
  @Header("Cache-Control", "no-store")
  list(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("patientId") patientId: string,
  ) {
    return this.allergies.listForDoctor(principal, patientId);
  }

  @RequirePermissions("CLINICAL_PROFILE_WRITE")
  @Post(":patientId/allergies")
  @Header("Cache-Control", "no-store")
  create(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("patientId") patientId: string,
    @Body() body: CreateAllergyInput,
  ) {
    return this.allergies.createForDoctor(principal, patientId, body);
  }

  @RequirePermissions("CLINICAL_PROFILE_WRITE")
  @Patch(":patientId/allergies/:entryId")
  @Header("Cache-Control", "no-store")
  update(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("patientId") patientId: string,
    @Param("entryId") entryId: string,
    @Body() body: UpdateAllergyInput,
  ) {
    return this.allergies.updateForDoctor(principal, patientId, entryId, body);
  }

  @RequirePermissions("CLINICAL_PROFILE_WRITE")
  @Post(":patientId/allergies/:entryId/verify")
  @Header("Cache-Control", "no-store")
  verify(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("patientId") patientId: string,
    @Param("entryId") entryId: string,
    @Body() body: VerifyAllergyInput,
  ) {
    return this.allergies.verifyForDoctor(principal, patientId, entryId, body);
  }
}
