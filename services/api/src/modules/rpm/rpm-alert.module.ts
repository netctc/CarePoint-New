import { Body, Controller, Get, Header, Module, Param, Patch, Post, Query } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { ClinicalModule } from "../clinical/clinical.module";
import {
  RpmAlertService,
  type AlertActionInput,
  type CreateAlertPolicyInput,
  type CreateAlertPolicyVersionInput,
  type CreateAlertRuleInput,
  type UpdateAlertRuleInput,
} from "./rpm-alert.service";

@Controller("admin/rpm")
class AdminRpmController {
  constructor(private readonly rpm: RpmAlertService) {}

  @RequirePermissions("CATALOG_MANAGE")
  @Get("policies")
  policies() { return this.rpm.adminPolicies(); }

  @RequirePermissions("CATALOG_MANAGE")
  @Post("policies")
  createPolicy(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: CreateAlertPolicyInput) {
    return this.rpm.createPolicy(principal, body);
  }

  @RequirePermissions("CATALOG_MANAGE")
  @Post("policies/:policyId/versions")
  version(@CurrentPrincipal() principal: AuthPrincipal, @Param("policyId") policyId: string, @Body() body: CreateAlertPolicyVersionInput) {
    return this.rpm.createPolicyVersion(principal, policyId, body);
  }

  @RequirePermissions("CATALOG_MANAGE")
  @Post("policies/:policyId/versions/:version/activate")
  activate(@CurrentPrincipal() principal: AuthPrincipal, @Param("policyId") policyId: string, @Param("version") version: string) {
    return this.rpm.activatePolicyVersion(principal, policyId, Number(version));
  }

  @RequirePermissions("APPOINTMENT_OPERATE")
  @Get("workspace")
  workspace() { return this.rpm.adminDashboard(); }

  @RequirePermissions("APPOINTMENT_OPERATE")
  @Get("alerts")
  queue() { return this.rpm.adminQueue(); }
}

@Controller("provider")
class ProviderRpmController {
  constructor(private readonly rpm: RpmAlertService) {}

  @RequirePermissions("CARE_COORDINATION_MANAGE")
  @Post("care-plans/:carePlanId/alert-rules")
  createRule(@CurrentPrincipal() principal: AuthPrincipal, @Param("carePlanId") carePlanId: string, @Body() body: CreateAlertRuleInput) {
    return this.rpm.createRule(principal, carePlanId, body);
  }

  @RequirePermissions("CARE_COORDINATION_MANAGE")
  @Get("care-plans/:carePlanId/alert-rules")
  rules(@CurrentPrincipal() principal: AuthPrincipal, @Param("carePlanId") carePlanId: string) {
    return this.rpm.listRules(principal, carePlanId);
  }

  @RequirePermissions("CARE_COORDINATION_MANAGE")
  @Patch("care-plans/:carePlanId/alert-rules/:ruleId")
  updateRule(@CurrentPrincipal() principal: AuthPrincipal, @Param("carePlanId") carePlanId: string, @Param("ruleId") ruleId: string, @Body() body: UpdateAlertRuleInput) {
    return this.rpm.updateRule(principal, carePlanId, ruleId, body);
  }

  @RequirePermissions("CARE_COORDINATION_MANAGE")
  @Get("monitoring-queue")
  @Header("Cache-Control", "no-store")
  inbox(@CurrentPrincipal() principal: AuthPrincipal, @Query("severity") severity?: string) {
    return this.rpm.providerInbox(principal, severity);
  }

  @RequirePermissions("CARE_COORDINATION_MANAGE")
  @Post("clinical-alerts/:alertId/actions")
  @Header("Cache-Control", "no-store")
  action(@CurrentPrincipal() principal: AuthPrincipal, @Param("alertId") alertId: string, @Body() body: AlertActionInput) {
    return this.rpm.act(principal, alertId, body);
  }
}

@Controller("patient/clinical-alerts")
class PatientRpmController {
  constructor(private readonly rpm: RpmAlertService) {}

  @RequirePermissions("PATIENT_READ_CLINICAL_RECORD")
  @Get()
  @Header("Cache-Control", "no-store")
  list(@CurrentPrincipal() principal: AuthPrincipal) { return this.rpm.patientAlerts(principal); }

  @RequirePermissions("PATIENT_READ_CLINICAL_RECORD")
  @Post(":alertId/viewed")
  @Header("Cache-Control", "no-store")
  viewed(@CurrentPrincipal() principal: AuthPrincipal, @Param("alertId") alertId: string) {
    return this.rpm.markPatientViewed(principal, alertId);
  }
}

@Module({
  imports: [ClinicalModule],
  controllers: [AdminRpmController, ProviderRpmController, PatientRpmController],
  providers: [RpmAlertService],
  exports: [RpmAlertService],
})
export class RpmAlertModule {}
