import { Body, Controller, Get, Module, Param, Post } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { OrdersService } from "./orders.service";
import { OrdersEnvelopeService } from "./orders-envelope.service";
import { OrdersAttestationService } from "./orders-attestation.service";
import { OrdersSystemExportService } from "./orders-system-export.service";

@Controller("clinical-orders")
class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @RequirePermissions("CLINICAL_ORDER_WRITE")
  @Post("appointments/:appointmentId/prescriptions")
  prescription(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("appointmentId") appointmentId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.orders.createOrder(principal, appointmentId, "PRESCRIPTION", body);
  }

  @RequirePermissions("CLINICAL_ORDER_WRITE")
  @Post("appointments/:appointmentId/laboratory")
  laboratory(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("appointmentId") appointmentId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.orders.createOrder(principal, appointmentId, "LABORATORY", body);
  }

  @RequirePermissions("PATIENT_READ_CLINICAL_ORDERS")
  @Get("me")
  mine(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.orders.patientOrders(principal);
  }

  @RequirePermissions("CLINICAL_ORDER_READ")
  @Get("patients/:patientId")
  providerPatientOrders(@CurrentPrincipal() principal: AuthPrincipal, @Param("patientId") patientId: string) {
    return this.orders.providerPatientOrders(principal, patientId);
  }

  @RequirePermissions("PATIENT_READ_CLINICAL_ORDERS", "CLINICAL_ORDER_READ")
  @Get(":orderId")
  get(@CurrentPrincipal() principal: AuthPrincipal, @Param("orderId") orderId: string) {
    return this.orders.getOrder(principal, orderId);
  }

  @RequirePermissions("CLINICAL_ORDER_WRITE")
  @Post(":orderId/cancel")
  cancel(@CurrentPrincipal() principal: AuthPrincipal, @Param("orderId") orderId: string) {
    return this.orders.cancelOrder(principal, orderId);
  }

  @RequirePermissions("LAB_RESULT_ENTER")
  @Post(":orderId/lab-result")
  enterResult(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("orderId") orderId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.orders.enterLabResult(principal, orderId, body);
  }

  @RequirePermissions("LAB_RESULT_VALIDATE")
  @Post(":orderId/lab-result/validate")
  validateResult(@CurrentPrincipal() principal: AuthPrincipal, @Param("orderId") orderId: string) {
    return this.orders.validateLabResult(principal, orderId);
  }

  @RequirePermissions("LAB_RESULT_VALIDATE")
  @Post(":orderId/lab-result/release")
  releaseResult(@CurrentPrincipal() principal: AuthPrincipal, @Param("orderId") orderId: string) {
    return this.orders.releaseLabResult(principal, orderId);
  }
}

@Module({
  controllers: [OrdersController],
  providers: [OrdersService, OrdersEnvelopeService, OrdersAttestationService, OrdersSystemExportService],
  exports: [OrdersService, OrdersSystemExportService],
})
export class OrdersModule {}
