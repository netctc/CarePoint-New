import { Body, Controller, Get, Header, Module, Param, Post, Query } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import {
  ClinicalGovernanceService,
  type CreateTemporaryClinicalShareInput,
} from "./clinical-governance.service";

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
  controllers: [PatientClinicalShareController, AdminClinicalAccessController],
  providers: [ClinicalGovernanceService],
  exports: [ClinicalGovernanceService],
})
export class ClinicalGovernanceModule {}
