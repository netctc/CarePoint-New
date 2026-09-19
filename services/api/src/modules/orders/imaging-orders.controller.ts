import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { ImagingOrdersService } from "./imaging-orders.service";

@Controller("provider")
export class ImagingOrdersController {
  constructor(private readonly imaging: ImagingOrdersService) {}

  @RequirePermissions("CLINICAL_ORDER_WRITE")
  @Post("patients/:patientId/imaging-orders")
  create(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("patientId") patientId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.imaging.create(principal, patientId, body);
  }

  @RequirePermissions("CLINICAL_ORDER_READ")
  @Get("patients/:patientId/imaging-orders")
  list(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("patientId") patientId: string,
  ) {
    return this.imaging.listForPatient(principal, patientId);
  }

  @RequirePermissions("CLINICAL_ORDER_WRITE")
  @Patch("imaging-orders/:orderId")
  update(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("orderId") orderId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.imaging.update(principal, orderId, body);
  }
}
