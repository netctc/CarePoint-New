import { Body, Controller, Get, Header, HttpCode, Module, Post, Query, Req, Res } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { DistributedRateLimitService } from "../../infrastructure/redis/redis-security.module";
import { CurrentPrincipal, Public } from "../../security/api-security.module";
import { SmartConfigurationService } from "../../security/smart-configuration.service";
import { SmartOAuthService } from "./smart-oauth.service";

type SmartInput = Record<string, unknown>;
interface RequestIdentity { ip?: string; socket?: { remoteAddress?: string }; }
interface RedirectResponse {
  setHeader(name: string, value: string): void;
  redirect(status: number, url: string): void;
}

@Controller("fhir/R4/.well-known")
class SmartDiscoveryController {
  constructor(private readonly config: SmartConfigurationService) {}

  @Public()
  @Get("smart-configuration")
  @Header("Content-Type", "application/json; charset=utf-8")
  @Header("Cache-Control", "public, max-age=300")
  @Header("X-Content-Type-Options", "nosniff")
  discovery() {
    return this.config.discovery();
  }
}

@Controller("smart")
class SmartOAuthController {
  constructor(
    private readonly oauth: SmartOAuthService,
    private readonly rateLimits: DistributedRateLimitService,
  ) {}

  @Get("authorize")
  async authorize(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Req() request: RequestIdentity,
    @Query() query: SmartInput,
    @Res() response: RedirectResponse,
  ): Promise<void> {
    await Promise.all([
      this.rateLimits.assertAllowed({ namespace: "smart:authorize:ip", identity: this.clientIp(request), limit: 120, windowSeconds: 300 }),
      this.rateLimits.assertAllowed({ namespace: "smart:authorize:user", identity: principal.accountId, limit: 60, windowSeconds: 300 }),
    ]);
    const result = await this.oauth.authorize(principal, query);
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Pragma", "no-cache");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.redirect(302, result.redirectTo);
  }

  @Public()
  @Post("token")
  @HttpCode(200)
  @Header("Content-Type", "application/json; charset=utf-8")
  @Header("Cache-Control", "no-store")
  @Header("Pragma", "no-cache")
  @Header("X-Content-Type-Options", "nosniff")
  async token(@Req() request: RequestIdentity, @Body() body: SmartInput) {
    const clientId = typeof body.client_id === "string" ? body.client_id : "missing";
    const code = typeof body.code === "string" ? body.code : "missing";
    await Promise.all([
      this.rateLimits.assertAllowed({ namespace: "smart:token:ip", identity: this.clientIp(request), limit: 180, windowSeconds: 300 }),
      this.rateLimits.assertAllowed({ namespace: "smart:token:client", identity: clientId, limit: 120, windowSeconds: 300 }),
      this.rateLimits.assertAllowed({ namespace: "smart:token:code", identity: code, limit: 10, windowSeconds: 300 }),
    ]);
    return this.oauth.exchange(body);
  }

  @Public()
  @Post("revoke")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @Header("Pragma", "no-cache")
  async revoke(@Req() request: RequestIdentity, @Body() body: SmartInput) {
    const clientId = typeof body.client_id === "string" ? body.client_id : "missing";
    await Promise.all([
      this.rateLimits.assertAllowed({ namespace: "smart:revoke:ip", identity: this.clientIp(request), limit: 180, windowSeconds: 300 }),
      this.rateLimits.assertAllowed({ namespace: "smart:revoke:client", identity: clientId, limit: 120, windowSeconds: 300 }),
    ]);
    await this.oauth.revoke(body);
    return {};
  }

  private clientIp(request: RequestIdentity): string {
    return request.ip?.trim() || request.socket?.remoteAddress?.trim() || "unknown";
  }
}

@Module({
  controllers: [SmartDiscoveryController, SmartOAuthController],
  providers: [SmartOAuthService],
})
export class SmartModule {}
