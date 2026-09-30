import { Body, Controller, Get, Header, Param, Post } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import {
  CurrentPrincipal,
  RequirePermissions,
} from "../../security/api-security.module";
import { SpecimensService } from "./specimens.service";

@Controller("provider/specimens")
export class ProviderSpecimensController {
  constructor(private readonly specimens: SpecimensService) {}

  @RequirePermissions("CLINICAL_ORDER_WRITE")
  @Post()
  collect(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() body: Record<string, unknown>,
  ) {
    return this.specimens.collect(principal, body);
  }

  @RequirePermissions("CLINICAL_ORDER_READ")
  @Get("order/:orderId")
  @Header("Cache-Control", "no-store")
  listForOrder(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("orderId") orderId: string,
  ) {
    return this.specimens.listForOrder(principal, orderId);
  }

  @RequirePermissions("CLINICAL_ORDER_WRITE")
  @Post(":specimenId/custody-events")
  appendCustody(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("specimenId") specimenId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.specimens.appendCustody(principal, specimenId, body);
  }

  @RequirePermissions("CLINICAL_ORDER_READ")
  @Get(":specimenId/custody-events")
  @Header("Cache-Control", "no-store")
  history(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("specimenId") specimenId: string,
  ) {
    return this.specimens.custodyHistory(principal, specimenId);
  }
}
