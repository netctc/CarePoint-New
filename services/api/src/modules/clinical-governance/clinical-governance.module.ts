import { Body, Controller, Get, Header, Module, Param, Post, Query } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import {
  ClinicalGovernanceService,
  type CreateTemporaryClinicalShareInput,
} from "./clinical-governance.service";
import {
  ConsentPolicyGovernanceService,
  type CreateConsentPolicyDefinitionInput,
  type CreateConsentPolicyVersionInput,
} from "./consent-policy-governance.service";

@Controller("admin/consent-policies")
class AdminConsentPolicyController {
  constructor(private readonly policies: ConsentPolicyGovernanceService) {}

  @RequirePermissions("DATA_GOVERNANCE_MANAGE")
  @Get()
  @Header("Cache-Control", "no-store")
  list() { return this.policies.catalog(); }

  @RequirePermissions("DATA_GOVERNANCE_MANAGE")
  @Post()
  @Header("Cache-Control", "no-store")
  create(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: CreateConsentPolicyDefinitionInput) {
    return this.policies.createDefinition(principal, body);
  }

  @RequirePermissions("DATA_GOVERNANCE_MANAGE")
  @Post(":policyId/versions")
  @Header("Cache-Control", "no-store")
  version(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("policyId") policyId: string,
    @Body() body: CreateConsentPolicyVersionInput,
  ) {
    return this.policies.createVersion(principal, policyId, body);
  }

  @RequirePermissions("DATA_GOVERNANCE_MANAGE")
  @Post(":policyId/versions/:version/activate")
  @Header("Cache-Control", "no-store")
  activate(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("policyId") policyId: string,
    @Param("version") version: string,
  ) {
    return this.policies.activate(principal, policyId, version);
  }
}

@Controller("patient/clinical-shares")
class PatientClinicalShareController {
  constructor(private readonly governance: ClinicalGovernanceService) {}

  @RequirePermissions("PATIENT_MANAGE_CONSENT")
  @Post()
  @Header("Cache-Control", "no-store")
  create(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() body: CreateTemporaryClinicalShareInput,
  ) {
    return this.governance.createTemporaryShare(principal, body);
  }

  @RequirePermissions("PATIENT_MANAGE_CONSENT")
  @Get()
  @Header("Cache-Control", "no-store")
  list(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.governance.listTemporaryShares(principal);
  }

  @RequirePermissions("PATIENT_MANAGE_CONSENT")
  @Post(":shareId/revoke")
  @Header("Cache-Control", "no-store")
  revoke(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("shareId") shareId: string,
  ) {
    return this.governance.revokeTemporaryShare(principal, shareId);
  }
}

@Controller("admin/clinical-access")
class AdminClinicalAccessController {
  constructor(private readonly governance: ClinicalGovernanceService) {}

  @RequirePermissions("DATA_GOVERNANCE_MANAGE")
  @Get("policies")
  policies() {
    return this.governance.policies();
  }

  @RequirePermissions("DATA_GOVERNANCE_MANAGE")
  @Get("matrix")
  matrix() {
    return this.governance.accessMatrix();
  }

  @RequirePermissions("DATA_GOVERNANCE_MANAGE")
  @Get("provenance")
  @Header("Cache-Control", "no-store")
  provenance(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Query("patientId") patientId: string,
    @Query("domain") domain?: string,
    @Query("limit") limit?: string,
  ) {
    return this.governance.provenanceExplorer(principal, {
      patientId,
      ...(domain ? { domain } : {}),
      ...(limit !== undefined ? { limit: Number(limit) } : {}),
    });
  }

  @RequirePermissions("IAM_READ_AUDIT")
  @Get("audit")
  @Header("Cache-Control", "no-store")
  audit(
    @Query("actorId") actorId?: string,
    @Query("objectType") objectType?: string,
    @Query("objectId") objectId?: string,
    @Query("action") action?: string,
    @Query("purpose") purpose?: string,
    @Query("result") result?: string,
    @Query("patientId") patientId?: string,
    @Query("providerId") providerId?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("limit") limit?: string,
  ) {
    return this.governance.auditExplorer({
      ...(actorId ? { actorId } : {}),
      ...(objectType ? { objectType } : {}),
      ...(objectId ? { objectId } : {}),
      ...(action ? { action } : {}),
      ...(purpose ? { purpose } : {}),
      ...(result ? { result } : {}),
      ...(patientId ? { patientId } : {}),
      ...(providerId ? { providerId } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(limit !== undefined ? { limit: Number(limit) } : {}),
    });
  }
}

@Module({
  controllers: [AdminConsentPolicyController, PatientClinicalShareController, AdminClinicalAccessController],
  providers: [ClinicalGovernanceService, ConsentPolicyGovernanceService],
  exports: [ClinicalGovernanceService, ConsentPolicyGovernanceService],
})
export class ClinicalGovernanceModule {}
