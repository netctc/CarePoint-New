import { Body, Controller, Get, Header, Module, Param, Post, Query } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { AvailabilityRequestsService } from "./availability-requests.service";
import { ProviderAvailabilityDemandService } from "./provider-availability-demand.service";

@Controller("availability-requests")
export class AvailabilityRequestsController {
  constructor(private readonly requests: AvailabilityRequestsService) {}
  @RequirePermissions("PATIENT_BOOK_APPOINTMENT") @Post() @Header("Cache-Control", "no-store")
  join(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: unknown) { return this.requests.join(principal, body); }
  @RequirePermissions("PATIENT_MANAGE_APPOINTMENT") @Get() @Header("Cache-Control", "no-store")
  list(@CurrentPrincipal() principal: AuthPrincipal, @Query("page") page?: string, @Query("view") view?: string) { return this.requests.list(principal, page, view); }
  @RequirePermissions("PATIENT_MANAGE_APPOINTMENT") @Post(":requestId/withdraw") @Header("Cache-Control", "no-store")
  withdraw(@CurrentPrincipal() principal: AuthPrincipal, @Param("requestId") id: string) { return this.requests.withdraw(principal, id); }
  @RequirePermissions("PATIENT_MANAGE_APPOINTMENT") @Post(":requestId/refresh") @Header("Cache-Control", "no-store")
  refresh(@CurrentPrincipal() principal: AuthPrincipal, @Param("requestId") id: string) { return this.requests.refresh(principal, id); }
  @RequirePermissions("PATIENT_MANAGE_APPOINTMENT") @Get(":requestId/matches") @Header("Cache-Control", "no-store")
  matches(@CurrentPrincipal() principal: AuthPrincipal, @Param("requestId") id: string) { return this.requests.matches(principal, id); }
  @RequirePermissions("PATIENT_MANAGE_APPOINTMENT") @Post(":requestId/read") @Header("Cache-Control", "no-store")
  read(@CurrentPrincipal() principal: AuthPrincipal, @Param("requestId") id: string, @Body() body: { version?: unknown }) { return this.requests.read(principal, id, body?.version); }
}

@Controller("provider/availability-demand")
export class ProviderAvailabilityDemandController {
  constructor(private readonly demand: ProviderAvailabilityDemandService) {}
  // The existing global guard enforces current credentials and category status.
  @RequirePermissions("PROVIDER_MANAGE_AVAILABILITY") @Get() @Header("Cache-Control", "no-store")
  list(@CurrentPrincipal() principal: AuthPrincipal, @Query() query: Record<string, unknown>) {
    return this.demand.list(principal, query);
  }
}
@Module({ controllers: [AvailabilityRequestsController, ProviderAvailabilityDemandController], providers: [AvailabilityRequestsService, ProviderAvailabilityDemandService] })
export class AvailabilityRequestsModule {}
