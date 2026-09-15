import { Controller, Get, Module, Query } from "@nestjs/common";
import { RequirePermissions } from "../../security/api-security.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";

@RequirePermissions("IAM_READ_AUDIT")
@Controller("audit")
class AuditController {
  constructor(private readonly audit: DatabaseAuditService) {}

  @Get()
  list(@Query("limit") rawLimit?: string) {
    const limit = rawLimit ? Number(rawLimit) : 100;
    return this.audit.list(Number.isFinite(limit) ? limit : 100);
  }
}

@Module({ controllers: [AuditController] })
export class AuditModule {}
