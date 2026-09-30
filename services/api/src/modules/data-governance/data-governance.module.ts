import { Body, Controller, Get, Module, Param, Post } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { DocumentsModule } from "../documents/documents.module";
import { DataGovernanceService } from "./data-governance.service";

@RequirePermissions("DATA_GOVERNANCE_MANAGE")
@Controller("data-governance")
class DataGovernanceController {
  constructor(private readonly governance: DataGovernanceService) {}

  @Get("status")
  status() {
    return this.governance.status();
  }

  @Get("holds")
  holds() {
    return this.governance.listHolds();
  }

  @Post("holds")
  createHold(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: Record<string, unknown>) {
    return this.governance.createHold(principal, body);
  }

  @Post("holds/:holdId/release")
  releaseHold(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("holdId") holdId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.governance.releaseHold(principal, holdId, body);
  }

  @Post("retention/run")
  runRetention(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: Record<string, unknown>) {
    return this.governance.runRetention(principal, body);
  }
}

@Module({
  imports: [DocumentsModule],
  controllers: [DataGovernanceController],
  providers: [DataGovernanceService],
  exports: [DataGovernanceService],
})
export class DataGovernanceModule {}
