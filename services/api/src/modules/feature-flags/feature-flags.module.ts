import { Body, Controller, Get, Header, Module, Param, Post } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import {
  FeaturePolicyService,
  type CreateFeatureFlagInput,
  type UpsertFeatureAssignmentInput,
} from "../../security/feature-policy.service";

@Controller("admin/feature-flags")
@RequirePermissions("FEATURE_FLAG_MANAGE")
class FeatureFlagsController {
  constructor(private readonly policy: FeaturePolicyService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  list() {
    return this.policy.listForAdmin();
  }

  @Post()
  @Header("Cache-Control", "no-store")
  create(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: CreateFeatureFlagInput) {
    return this.policy.createFlag(principal, body);
  }

  @Post(":flagId/assignments")
  @Header("Cache-Control", "no-store")
  assign(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("flagId") flagId: string,
    @Body() body: UpsertFeatureAssignmentInput,
  ) {
    return this.policy.upsertAssignment(principal, flagId, body);
  }
}

@Module({ controllers: [FeatureFlagsController] })
export class FeatureFlagsModule {}
