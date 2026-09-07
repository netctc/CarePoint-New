import { Body, Controller, Get, Header, HttpCode, Module, Post, Query, Req, Res } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { DistributedRateLimitService } from "../../infrastructure/redis/redis-security.module";
import { CurrentPrincipal, Public } from "../../security/api-security.module";
import { SmartConfigurationService } from "../../security/smart-configuration.service";
import { smartConsentPage, smartErrorPage, smartLoginPage, smartMfaPage } from "./smart-browser-pages";
import { SmartBrowserService } from "./smart-browser.service";
import { SmartOAuthService } from "./smart-oauth.service";
import { SmartOidcService } from "./smart-oidc.service";

type SmartInput = Record<string, unknown>;
interface RequestIdentity { ip?: string; socket?: { remoteAddress?: string }; }
interface HttpResponseLike {
  setHeader(name: string, value: string): void;
  status(code: number): HttpResponseLike;
  send(value: string): void;
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

@Controller(".well-known")
class OpenIdDiscoveryController {
  constructor(private readonly config: SmartConfigurationService) {}

  @Public()
  @Get("openid-configuration")
  @Header("Content-Type", "application/json; charset=utf-8")
  @Header("Cache-Control", "public, max-age=300")
  @Header("X-Content-Type-Options", "nosniff")
  discovery() {
    return this.config.openidConfiguration();
  }
}

@Controller("smart")
class SmartOAuthController {
  constructor(
    private readonly oauth: SmartOAuthService,
    private readonly oidc: SmartOidcService,
    private readonly rateLimits: DistributedRateLimitService,
  ) {}

  @Get("authorize")
  async authorize(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Req() request: RequestIdentity,
    @Query() query: SmartInput,
    @Res() response: HttpResponseLike,
  ): Promise<void> {
    await Promise.all([
      this.rateLimits.assertAllowed({ namespace: "smart:authorize:ip", identity: this.clientIp(request), limit: 120, windowSeconds: 300 }),
      this.rateLimits.assertAllowed({ namespace: "smart:authorize:user", identity: principal.accountId, limit: 60, windowSeconds: 300 }),
    ]);
    const result = await this.oauth.authorize(principal, query);
    noStore(response);
    response.redirect(302, result.redirectTo);
  }

  @Public()
  @Get("jwks")
  @Header("Content-Type", "application/json; charset=utf-8")
  @Header("Cache-Control", "public, max-age=300")
  @Header("X-Content-Type-Options", "nosniff")
  jwks() {
    return this.oidc.jwks();
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

@Controller("smart/browser")
class SmartBrowserController {
  constructor(
    private readonly browser: SmartBrowserService,
    private readonly rateLimits: DistributedRateLimitService,
  ) {}

  @Public()
  @Get("authorize")
  async authorize(@Req() request: RequestIdentity, @Query() query: SmartInput, @Res() response: HttpResponseLike): Promise<void> {
    await this.rateLimits.assertAllowed({ namespace: "smart:browser:start:ip", identity: this.clientIp(request), limit: 120, windowSeconds: 300 });
    try {
      const view = await this.browser.begin(query);
      secureHtml(response);
      response.status(200).send(smartLoginPage(view));
    } catch (error) {
      this.renderError(response, "Authorization request rejected", error);
    }
  }

  @Public()
  @Post("login")
  async login(@Req() request: RequestIdentity, @Body() body: SmartInput, @Res() response: HttpResponseLike): Promise<void> {
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "missing";
    await Promise.all([
      this.rateLimits.assertAllowed({ namespace: "smart:browser:login:ip", identity: this.clientIp(request), limit: 120, windowSeconds: 300 }),
      this.rateLimits.assertAllowed({ namespace: "smart:browser:login:account", identity: email, limit: 20, windowSeconds: 300 }),
    ]);
    try {
      const result = await this.browser.login(body.transaction, body.email, body.password);
      secureHtml(response);
      response.status(200).send(result.stage === "mfa" ? smartMfaPage(result.view) : smartConsentPage(result.view));
    } catch (error) {
      this.renderError(response, "Sign-in failed", error);
    }
  }

  @Public()
  @Post("mfa")
  async mfa(@Req() request: RequestIdentity, @Body() body: SmartInput, @Res() response: HttpResponseLike): Promise<void> {
    const transaction = typeof body.transaction === "string" ? body.transaction : "missing";
    await Promise.all([
      this.rateLimits.assertAllowed({ namespace: "smart:browser:mfa:ip", identity: this.clientIp(request), limit: 100, windowSeconds: 300 }),
      this.rateLimits.assertAllowed({ namespace: "smart:browser:mfa:transaction", identity: transaction, limit: 10, windowSeconds: 300 }),
    ]);
    try {
      const view = await this.browser.completeMfa(body.transaction, body.code);
      secureHtml(response);
      response.status(200).send(smartConsentPage(view));
    } catch (error) {
      this.renderError(response, "Verification failed", error);
    }
  }

  @Public()
  @Post("consent")
  async consent(@Req() request: RequestIdentity, @Body() body: SmartInput, @Res() response: HttpResponseLike): Promise<void> {
    const transaction = typeof body.transaction === "string" ? body.transaction : "missing";
    await Promise.all([
      this.rateLimits.assertAllowed({ namespace: "smart:browser:consent:ip", identity: this.clientIp(request), limit: 120, windowSeconds: 300 }),
      this.rateLimits.assertAllowed({ namespace: "smart:browser:consent:transaction", identity: transaction, limit: 5, windowSeconds: 300 }),
    ]);
    try {
      const result = await this.browser.decide(body.transaction, body.decision);
      noStore(response);
      response.redirect(302, result.redirectTo);
    } catch (error) {
      this.renderError(response, "Consent could not be completed", error);
    }
  }

  private renderError(response: HttpResponseLike, title: string, error: unknown): void {
    secureHtml(response);
    const message = error instanceof Error ? error.message : "The authorization request could not be completed.";
    response.status(400).send(smartErrorPage(title, message));
  }

  private clientIp(request: RequestIdentity): string {
    return request.ip?.trim() || request.socket?.remoteAddress?.trim() || "unknown";
  }
}

@Module({
  controllers: [SmartDiscoveryController, OpenIdDiscoveryController, SmartOAuthController, SmartBrowserController],
  providers: [SmartOidcService, SmartOAuthService, SmartBrowserService],
})
export class SmartModule {}

function noStore(response: HttpResponseLike): void {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.setHeader("Pragma", "no-cache");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
}

function secureHtml(response: HttpResponseLike): void {
  noStore(response);
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
}
