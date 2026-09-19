import { Body, Controller, Get, Header, Module, Param, Patch, Post } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import {
  DependentsService,
  PatientContextService,
  type CreateDependentRelationInput,
  type EvidenceReviewInput,
  type GrantDependentConsentInput,
  type RelationReviewInput,
  type SwitchPatientContextInput,
  type UpdateDependentRelationInput,
} from "./dependents.service";

@Controller("patient/dependents")
class PatientDependentsController {
  constructor(private readonly dependents: DependentsService) {}

  @RequirePermissions("PATIENT_MANAGE_DEPENDENTS")
  @Get()
  @Header("Cache-Control", "no-store")
  list(@CurrentPrincipal() principal: AuthPrincipal) { return this.dependents.listMine(principal); }

  @RequirePermissions("PATIENT_MANAGE_DEPENDENTS")
  @Post()
  @Header("Cache-Control", "no-store")
  request(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: CreateDependentRelationInput) { return this.dependents.request(principal, body); }

  @RequirePermissions("PATIENT_MANAGE_DEPENDENTS")
  @Patch(":relationId")
  @Header("Cache-Control", "no-store")
  update(@CurrentPrincipal() principal: AuthPrincipal, @Param("relationId") relationId: string, @Body() body: UpdateDependentRelationInput) { return this.dependents.updateRequest(principal, relationId, body); }

  @RequirePermissions("PATIENT_MANAGE_DEPENDENTS")
  @Post(":relationId/revoke")
  @Header("Cache-Control", "no-store")
  revoke(@CurrentPrincipal() principal: AuthPrincipal, @Param("relationId") relationId: string) { return this.dependents.revoke(principal, relationId); }

  @RequirePermissions("PATIENT_MANAGE_DEPENDENTS")
  @Get("patient/:patientId/consents")
  @Header("Cache-Control", "no-store")
  consents(@CurrentPrincipal() principal: AuthPrincipal, @Param("patientId") patientId: string) { return this.dependents.dependentConsents(principal, patientId); }

  @RequirePermissions("PATIENT_MANAGE_DEPENDENTS")
  @Post("patient/:patientId/consents")
  @Header("Cache-Control", "no-store")
  grantConsent(@CurrentPrincipal() principal: AuthPrincipal, @Param("patientId") patientId: string, @Body() body: GrantDependentConsentInput) { return this.dependents.grantDependentConsent(principal, patientId, body); }

  @RequirePermissions("PATIENT_MANAGE_DEPENDENTS")
  @Post("patient/:patientId/consents/:consentId/revoke")
  @Header("Cache-Control", "no-store")
  revokeConsent(@CurrentPrincipal() principal: AuthPrincipal, @Param("patientId") patientId: string, @Param("consentId") consentId: string) { return this.dependents.revokeDependentConsent(principal, patientId, consentId); }
}

@Controller("patient/context")
class PatientContextController {
  constructor(private readonly contexts: PatientContextService) {}

  @RequirePermissions("PATIENT_MANAGE_DEPENDENTS")
  @Get()
  @Header("Cache-Control", "no-store")
  current(@CurrentPrincipal() principal: AuthPrincipal) { return this.contexts.current(principal); }

  @RequirePermissions("PATIENT_MANAGE_DEPENDENTS")
  @Post("switch")
  @Header("Cache-Control", "no-store")
  switch(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: SwitchPatientContextInput) { return this.contexts.switch(principal, body); }
}

@Controller("admin/dependents")
class AdminDependentsController {
  constructor(private readonly dependents: DependentsService) {}

  @RequirePermissions("IAM_MANAGE_ACCOUNTS")
  @Get("review")
  @Header("Cache-Control", "no-store")
  queue() { return this.dependents.adminQueue(); }

  @RequirePermissions("IAM_MANAGE_ACCOUNTS")
  @Post(":relationId/evidence/:evidenceId/review")
  reviewEvidence(@CurrentPrincipal() principal: AuthPrincipal, @Param("relationId") relationId: string, @Param("evidenceId") evidenceId: string, @Body() body: EvidenceReviewInput) { return this.dependents.reviewEvidence(principal, relationId, evidenceId, body); }

  @RequirePermissions("IAM_MANAGE_ACCOUNTS")
  @Post(":relationId/review")
  reviewRelation(@CurrentPrincipal() principal: AuthPrincipal, @Param("relationId") relationId: string, @Body() body: RelationReviewInput) { return this.dependents.reviewRelation(principal, relationId, body); }
}

@Module({
  controllers: [PatientDependentsController, PatientContextController, AdminDependentsController],
  providers: [DependentsService, PatientContextService],
  exports: [PatientContextService, DependentsService],
})
export class DependentsModule {}
