import { Body, Controller, Get, Header, Module, Param, Post, Query } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import {
  RetentionService,
  type CreateLegalHoldInput,
  type CreateRetentionPolicyInput,
  type DryRunRetentionInput,
  type ExecuteRetentionJobInput,
  type PublishRetentionPolicyVersionInput,
  type ReleaseLegalHoldInput,
} from "./retention.service";

@Controller("admin/retention")
@RequirePermissions("DATA_GOVERNANCE_MANAGE")
class RetentionController {
  constructor(private readonly retention: RetentionService) {}

  @Get("policies")
  @Header("Cache-Control", "no-store")
  policies() {
    return this.retention.listPolicies();
  }

  @Post("policies")
  @Header("Cache-Control", "no-store")
  createPolicy(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: CreateRetentionPolicyInput) {
    return this.retention.createPolicy(principal, body);
  }

  @Post("policies/:policyId/versions")
  @Header("Cache-Control", "no-store")
  publishPolicyVersion(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("policyId") policyId: string,
    @Body() body: PublishRetentionPolicyVersionInput,
  ) {
    return this.retention.publishPolicyVersion(principal, policyId, body);
  }

  @Post("policies/:policyId/dry-run")
  @Header("Cache-Control", "no-store")
  dryRun(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("policyId") policyId: string,
    @Body() body: DryRunRetentionInput,
  ) {
    return this.retention.dryRun(principal, policyId, body);
  }

  @Get("legal-holds")
  @Header("Cache-Control", "no-store")
  legalHolds(@Query("domain") domain?: string) {
    return this.retention.listLegalHolds(domain);
  }

  @Post("legal-holds")
  @Header("Cache-Control", "no-store")
  createLegalHold(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: CreateLegalHoldInput) {
    return this.retention.createLegalHold(principal, body);
  }

  @Post("legal-holds/:holdId/release")
  @Header("Cache-Control", "no-store")
  releaseLegalHold(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("holdId") holdId: string,
    @Body() body: ReleaseLegalHoldInput,
  ) {
    return this.retention.releaseLegalHold(principal, holdId, body);
  }

  @Get("jobs")
  @Header("Cache-Control", "no-store")
  jobs(@Query("limit") limit?: string) {
    return this.retention.listJobs(limit);
  }

  @Post("jobs/:jobId/execute")
  @Header("Cache-Control", "no-store")
  execute(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("jobId") jobId: string,
    @Body() body: ExecuteRetentionJobInput,
  ) {
    return this.retention.execute(principal, jobId, body);
  }
}

@Module({
  controllers: [RetentionController],
  providers: [RetentionService],
  exports: [RetentionService],
})
export class RetentionModule {}
