import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Module, Param, Post, Req } from "@nestjs/common";
import type { TelehealthReadinessInput } from "@carepoint/contracts";
import type { AuthPrincipal } from "@carepoint/identity";
import { PrismaModule } from "../../infrastructure/prisma/prisma.module";
import { CurrentPrincipal, Public, RequirePermissions } from "../../security/api-security.module";
import { TelehealthEnvelopeService } from "./telehealth-envelope.service";
import { TelehealthProviderService } from "./telehealth-provider.service";
import { TelehealthService } from "./telehealth.service";

@Controller("telehealth")
class TelehealthController {
  constructor(private readonly telehealth: TelehealthService) {}

  @RequirePermissions("TELEHEALTH_JOIN")
  @Get("appointments/:appointmentId")
  status(@CurrentPrincipal() principal: AuthPrincipal, @Param("appointmentId") appointmentId: string) {
    return this.telehealth.status(principal, appointmentId);
  }

  @RequirePermissions("TELEHEALTH_JOIN")
  @Post("appointments/:appointmentId/consent")
  consent(@CurrentPrincipal() principal: AuthPrincipal, @Param("appointmentId") appointmentId: string, @Body() body: { version: string }) {
    return this.telehealth.confirmConsent(principal, appointmentId, body.version);
  }

  @RequirePermissions("TELEHEALTH_JOIN")
  @Post("appointments/:appointmentId/readiness")
  readiness(@CurrentPrincipal() principal: AuthPrincipal, @Param("appointmentId") appointmentId: string, @Body() body: TelehealthReadinessInput) {
    return this.telehealth.readiness(principal, appointmentId, body);
  }

  @RequirePermissions("TELEHEALTH_JOIN")
  @Post("appointments/:appointmentId/join")
  join(@CurrentPrincipal() principal: AuthPrincipal, @Param("appointmentId") appointmentId: string) {
    return this.telehealth.join(principal, appointmentId);
  }

  @RequirePermissions("TELEHEALTH_OPERATE")
  @Post("appointments/:appointmentId/end")
  end(@CurrentPrincipal() principal: AuthPrincipal, @Param("appointmentId") appointmentId: string) {
    return this.telehealth.end(principal, appointmentId);
  }

  @Public()
  @HttpCode(204)
  @Post("webhooks/livekit")
  async webhook(
    @Req() request: { rawBody?: Buffer },
    @Headers("authorization") authorization?: string,
  ): Promise<void> {
    const rawBody = request.rawBody;
    if (!rawBody || rawBody.length === 0) {
      throw new BadRequestException("LiveKit webhook raw body is required.");
    }
    await this.telehealth.webhook(rawBody.toString("utf8"), authorization);
  }
}

@Module({
  imports: [PrismaModule],
  controllers: [TelehealthController],
  providers: [TelehealthService, TelehealthEnvelopeService, TelehealthProviderService],
  exports: [TelehealthService],
})
export class TelehealthModule {}
