import { Body, Controller, Get, Header, Module, Param, Post, Query } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import {
  DataQualityService,
  type DataQualityIssueActionInput,
  type DataQualityIssueQuery,
} from "./data-quality.service";

@Controller("admin/data-quality")
@RequirePermissions("DATA_GOVERNANCE_MANAGE")
class DataQualityController {
  constructor(private readonly dataQuality: DataQualityService) {}

  @Get("rules")
  @Header("Cache-Control", "no-store")
  rules() {
    return this.dataQuality.listRules();
  }

  @Get("runs")
  @Header("Cache-Control", "no-store")
  runs(@Query("limit") limit?: string) {
    return this.dataQuality.listRuns(limit);
  }

  @Get("issues")
  @Header("Cache-Control", "no-store")
  issues(@Query() query: DataQualityIssueQuery) {
    return this.dataQuality.listIssues(query);
  }

  @Post("run")
  @Header("Cache-Control", "no-store")
  run(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.dataQuality.run(principal, "MANUAL");
  }

  @Post("issues/:issueId/status")
  @Header("Cache-Control", "no-store")
  act(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("issueId") issueId: string,
    @Body() body: DataQualityIssueActionInput,
  ) {
    return this.dataQuality.act(principal, issueId, body);
  }
}

@Module({
  controllers: [DataQualityController],
  providers: [DataQualityService],
  exports: [DataQualityService],
})
export class DataQualityModule {}
