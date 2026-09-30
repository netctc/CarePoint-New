import { Body, Controller, Get, Header, Headers, Module, Param, Post, Query } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, Public, RequirePermissions } from "../../security/api-security.module";
import { ClinicalModule } from "../clinical/clinical.module";
import { ProvidersModule } from "../providers/providers.module";
import { MedicalDeviceService } from "./medical-device.service";

@Controller("admin/devices")
@RequirePermissions("DATA_GOVERNANCE_MANAGE")
class AdminDevicesController {
  constructor(private readonly devices: MedicalDeviceService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  workspace() { return this.devices.adminWorkspace(); }

  @Post("models")
  @Header("Cache-Control", "no-store")
  createModel(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: Record<string, unknown>) {
    return this.devices.createModel(principal, body);
  }

  @Post()
  @Header("Cache-Control", "no-store")
  register(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: Record<string, unknown>) {
    return this.devices.registerDevice(principal, body);
  }

  @Post(":deviceId/assign")
  @Header("Cache-Control", "no-store")
  assign(@CurrentPrincipal() principal: AuthPrincipal, @Param("deviceId") deviceId: string, @Body() body: Record<string, unknown>) {
    return this.devices.assignDevice(principal, deviceId, body);
  }

  @Post(":deviceId/credentials/rotate")
  @Header("Cache-Control", "no-store")
  credential(@CurrentPrincipal() principal: AuthPrincipal, @Param("deviceId") deviceId: string, @Body() body: Record<string, unknown>) {
    return this.devices.rotateCredential(principal, deviceId, body);
  }

  @Post(":deviceId/revoke")
  @Header("Cache-Control", "no-store")
  revoke(@CurrentPrincipal() principal: AuthPrincipal, @Param("deviceId") deviceId: string, @Body() body: Record<string, unknown>) {
    return this.devices.revokeDevice(principal, deviceId, body);
  }
}

@Controller("admin/integrations/devices")
@RequirePermissions("DATA_GOVERNANCE_MANAGE")
class AdminDeviceIntegrationsController {
  constructor(private readonly devices: MedicalDeviceService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  async list() {
    const workspace = await this.devices.adminWorkspace();
    return { items: workspace.integrations, secretsExposed: false };
  }

  @Post()
  @Header("Cache-Control", "no-store")
  create(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: Record<string, unknown>) {
    return this.devices.createIntegration(principal, body);
  }

  @Post(":integrationId/revoke")
  @Header("Cache-Control", "no-store")
  revoke(@CurrentPrincipal() principal: AuthPrincipal, @Param("integrationId") integrationId: string) {
    return this.devices.revokeIntegration(principal, integrationId);
  }
}

@Controller("provider/device-observations")
class ProviderDeviceObservationsController {
  constructor(private readonly devices: MedicalDeviceService) {}

  @RequirePermissions("CLINICAL_RECORD_WRITE")
  @Get("devices")
  @Header("Cache-Control", "no-store")
  assigned(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Query("patientId") patientId: string,
    @Query("appointmentId") appointmentId: string,
  ) {
    return this.devices.assignedDevices(principal, patientId, appointmentId);
  }

  @RequirePermissions("CLINICAL_RECORD_WRITE")
  @Post()
  @Header("Cache-Control", "no-store")
  capture(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: Record<string, unknown>) {
    const patientId = typeof body.patientId === "string" ? body.patientId : "";
    return this.devices.captureFromProvider(principal, patientId, body);
  }
}

@Controller("device-observations")
class DirectDeviceObservationController {
  constructor(private readonly devices: MedicalDeviceService) {}

  @Public()
  @Post()
  @Header("Cache-Control", "no-store")
  ingest(
    @Headers("x-device-id") deviceId: string,
    @Headers("x-device-key-id") credentialId: string,
    @Headers("x-device-event-id") eventId: string,
    @Headers("x-device-timestamp") timestamp: string,
    @Headers("x-device-signature") signature: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.devices.ingestDirectDevice(deviceId, { credentialId, eventId, timestamp, signature }, body);
  }
}

@Controller("device-integrations")
class DeviceIntegrationWebhookController {
  constructor(private readonly devices: MedicalDeviceService) {}

  @Public()
  @Post(":code/events")
  @Header("Cache-Control", "no-store")
  ingest(
    @Param("code") code: string,
    @Headers("x-device-event-id") eventId: string,
    @Headers("x-device-timestamp") timestamp: string,
    @Headers("x-device-signature") signature: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.devices.ingestIntegration(code, { eventId, timestamp, signature }, body);
  }
}

@Module({
  imports: [ClinicalModule, ProvidersModule],
  controllers: [
    AdminDevicesController,
    AdminDeviceIntegrationsController,
    ProviderDeviceObservationsController,
    DirectDeviceObservationController,
    DeviceIntegrationWebhookController,
  ],
  providers: [MedicalDeviceService],
  exports: [MedicalDeviceService],
})
export class MedicalDeviceModule {}
