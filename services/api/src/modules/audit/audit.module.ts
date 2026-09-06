import { Controller, Get, Module, Query } from "@nestjs/common";
import { IdentityCoreService } from "../../core/identity-core.module";

@Controller("audit")
class AuditController {
  constructor(private readonly identity: IdentityCoreService) {}

  @Get()
  list(@Query("limit") rawLimit?: string) {
    const limit = rawLimit ? Number(rawLimit) : 100;
    return { items: this.identity.audit.list(Number.isFinite(limit) ? limit : 100) };
  }
}

@Module({ controllers: [AuditController] })
export class AuditModule {}
