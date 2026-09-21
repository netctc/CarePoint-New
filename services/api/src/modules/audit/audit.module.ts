import { Body, Controller, Get, Module, Patch, Query } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { AuditIntegrityService } from "./audit-integrity.service";

@RequirePermissions("IAM_READ_AUDIT")
@Controller("audit")
class AuditController {
  constructor(
    private readonly audit: DatabaseAuditService,
    private readonly integrity: AuditIntegrityService,
  ) {}

  @Get()
  list(@Query("limit") rawLimit?: string) {
    const limit = rawLimit ? Number(rawLimit) : 100;
    return this.audit.list(Number.isFinite(limit) ? limit : 100);
  }

  @Get("integrity")
  integrityStatus(@CurrentPrincipal() principal: AuthPrincipal, @Query("limit") limit?: string) {
    return this.integrity.status(principal, limit);
  }

  @Get("retention")
  retentionStatus(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.integrity.retention(principal);
  }

  @RequirePermissions("DATA_GOVERNANCE_MANAGE")
  @Patch("retention")
  updateRetention(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: any) {
    return this.integrity.updateRetention(principal, body ?? {});
  }
}

@Module({
  controllers: [AuditController],
  providers: [AuditIntegrityService],
})
export class AuditModule {}
