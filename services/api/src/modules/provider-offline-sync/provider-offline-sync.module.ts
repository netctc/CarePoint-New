import {
  Body,
  ConflictException,
  Controller,
  Get,
  Header,
  Module,
  Param,
  Post,
} from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { ClinicalModule } from "../clinical/clinical.module";
import { ProvidersModule } from "../providers/providers.module";
import {
  ProviderOfflineSyncService,
  type ResolveOfflineFieldConflictInput,
  type SyncOfflineFieldDraftInput,
} from "./provider-offline-sync.service";

@Controller("provider/offline-sync")
class ProviderOfflineSyncController {
  constructor(private readonly offline: ProviderOfflineSyncService) {}

  @RequirePermissions("OTHER_PROVIDER_WORKFLOW_EXECUTE")
  @Post()
  @Header("Cache-Control", "no-store")
  async sync(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() body: SyncOfflineFieldDraftInput,
  ) {
    const result = await this.offline.sync(principal, body);
    if (result.outcome === "CONFLICT") throw new ConflictException(result);
    return result;
  }

  @RequirePermissions("OTHER_PROVIDER_WORKFLOW_EXECUTE")
  @Get("conflicts")
  @Header("Cache-Control", "no-store")
  conflicts(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.offline.listConflicts(principal);
  }

  @RequirePermissions("OTHER_PROVIDER_WORKFLOW_EXECUTE")
  @Get("conflicts/:conflictId")
  @Header("Cache-Control", "no-store")
  conflict(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("conflictId") conflictId: string,
  ) {
    return this.offline.conflict(principal, conflictId);
  }

  @RequirePermissions("OTHER_PROVIDER_WORKFLOW_EXECUTE")
  @Post("conflicts/:conflictId/resolve")
  @Header("Cache-Control", "no-store")
  resolve(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("conflictId") conflictId: string,
    @Body() body: ResolveOfflineFieldConflictInput,
  ) {
    return this.offline.resolve(principal, conflictId, body);
  }
}

@Module({
  imports: [ProvidersModule, ClinicalModule],
  controllers: [ProviderOfflineSyncController],
  providers: [ProviderOfflineSyncService],
})
export class ProviderOfflineSyncModule {}
