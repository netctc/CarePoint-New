import { Body, Controller, Delete, Get, Module, Param, Post, Req } from "@nestjs/common";
import type { AuthPrincipal, IdentityRole } from "@carepoint/identity";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DistributedRateLimitService } from "../../infrastructure/redis/redis-security.module";
import { CurrentPrincipal, Public, RequirePermissions } from "../../security/api-security.module";
import { PersistentAuthService } from "../../security/persistent-auth.service";

interface PatientRegistrationBody { email: string; password: string; firstName: string; lastName: string; phone?: string; }
interface ManagedAccountBody { email: string; password: string; role: IdentityRole; }
interface LoginBody { email: string; password: string; }
interface ConfirmMfaBody { code: string; }
interface CompleteMfaBody { challengeId: string; code: string; }
interface RefreshBody { refreshToken: string; }
interface RequestIdentity { ip?: string; socket?: { remoteAddress?: string }; headers?: Record<string, string | string[] | undefined>; }

@Controller("iam")
class IamController {
  constructor(
    private readonly auth: PersistentAuthService,
    private readonly rateLimits: DistributedRateLimitService,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @Post("register/patient")
  async registerPatient(@Req() request: RequestIdentity, @Body() body: PatientRegistrationBody) {
    await Promise.all([
      this.rateLimits.assertAllowed({ namespace: "iam:register:ip", identity: this.clientIp(request), limit: 200, windowSeconds: 3600 }),
      this.rateLimits.assertAllowed({ namespace: "iam:register:account", identity: body.email?.trim().toLowerCase() || "missing", limit: 3, windowSeconds: 3600 }),
    ]);
    return this.auth.registerPatient(body);
  }

  @Public()
  @Post("login")
  async login(@Req() request: RequestIdentity, @Body() body: LoginBody) {
    await Promise.all([
      this.rateLimits.assertAllowed({ namespace: "iam:login:ip", identity: this.clientIp(request), limit: 300, windowSeconds: 300 }),
      this.rateLimits.assertAllowed({ namespace: "iam:login:account", identity: body.email?.trim().toLowerCase() || "missing", limit: 20, windowSeconds: 300 }),
    ]);
    const result = await this.auth.login(body.email, body.password);
    if ("sessionId" in result) await this.captureSessionContext(result.sessionId, request);
    return result;
  }

  @Public()
  @Post("mfa/verify")
  async completeMfa(@Req() request: RequestIdentity, @Body() body: CompleteMfaBody) {
    await Promise.all([
      this.rateLimits.assertAllowed({ namespace: "iam:mfa:ip", identity: this.clientIp(request), limit: 100, windowSeconds: 300 }),
      this.rateLimits.assertAllowed({ namespace: "iam:mfa:challenge", identity: body.challengeId || "missing", limit: 10, windowSeconds: 300 }),
    ]);
    const result = await this.auth.completeMfa(body.challengeId, body.code);
    await this.captureSessionContext(result.sessionId, request);
    return result;
  }

  @Public()
  @Post("sessions/refresh")
  async refresh(@Req() request: RequestIdentity, @Body() body: RefreshBody) {
    await Promise.all([
      this.rateLimits.assertAllowed({ namespace: "iam:refresh:ip", identity: this.clientIp(request), limit: 300, windowSeconds: 300 }),
      this.rateLimits.assertAllowed({ namespace: "iam:refresh:token", identity: body.refreshToken || "missing", limit: 10, windowSeconds: 60 }),
    ]);
    const result = await this.auth.refresh(body.refreshToken);
    await this.captureSessionContext(result.sessionId, request);
    return result;
  }

  @RequirePermissions("IAM_MANAGE_ACCOUNTS")
  @Post("accounts")
  createManagedAccount(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: ManagedAccountBody) {
    return this.auth.createManagedAccount(principal.accountId, body);
  }

  @Get("accounts/me")
  me(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.auth.getAccount(principal, principal.accountId);
  }

  @RequirePermissions("IAM_MANAGE_ACCOUNTS")
  @Get("accounts/:accountId")
  account(@CurrentPrincipal() principal: AuthPrincipal, @Param("accountId") accountId: string) {
    return this.auth.getAccount(principal, accountId);
  }

  @Post("mfa/enroll")
  enrollMfa(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.auth.beginMfa(principal);
  }

  @Post("mfa/confirm")
  async confirmMfa(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: ConfirmMfaBody) {
    await this.auth.confirmMfa(principal, body.code);
    return { enabled: true };
  }

  @RequirePermissions("SELF_SESSION_MANAGE")
  @Get("sessions")
  async sessions(@CurrentPrincipal() principal: AuthPrincipal) {
    const now = new Date();
    const rows = await this.prisma.authSession.findMany({
      where: { userId: principal.accountId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        expiresAt: true,
        refreshExpiresAt: true,
        revokedAt: true,
        replacedBySessionId: true,
        userAgent: true,
        ipAddress: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return rows.map((row) => ({
      id: row.id,
      current: row.id === principal.sessionId,
      active: row.revokedAt === null && row.refreshExpiresAt > now,
      accessExpiresAt: row.expiresAt.toISOString(),
      refreshExpiresAt: row.refreshExpiresAt.toISOString(),
      revokedAt: row.revokedAt?.toISOString() ?? null,
      replacedBySessionId: row.replacedBySessionId,
      userAgent: row.userAgent,
      ipAddress: row.ipAddress,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  @RequirePermissions("SELF_SESSION_MANAGE")
  @Delete("sessions/:sessionId")
  async revoke(@CurrentPrincipal() principal: AuthPrincipal, @Param("sessionId") sessionId: string) {
    await this.auth.revokeSession(principal, sessionId);
    return { revoked: true };
  }

  @RequirePermissions("SELF_SESSION_MANAGE")
  @Post("sessions/revoke-all")
  async revokeAllMine(@CurrentPrincipal() principal: AuthPrincipal) {
    await this.auth.revokeAll(principal);
    return { revoked: true };
  }

  @RequirePermissions("IAM_MANAGE_ACCOUNTS")
  @Post("accounts/:accountId/revoke-all-sessions")
  async revokeAllForAccount(@CurrentPrincipal() principal: AuthPrincipal, @Param("accountId") accountId: string) {
    await this.auth.revokeAll(principal, accountId);
    return { revoked: true };
  }

  @RequirePermissions("IAM_MANAGE_ACCOUNTS")
  @Post("accounts/:accountId/suspend")
  suspendAccount(@CurrentPrincipal() principal: AuthPrincipal, @Param("accountId") accountId: string) {
    return this.auth.suspendAccount(principal.accountId, accountId);
  }

  private clientIp(request: RequestIdentity): string {
    return request.ip?.trim() || request.socket?.remoteAddress?.trim() || "unknown";
  }

  private async captureSessionContext(sessionId: string, request: RequestIdentity): Promise<void> {
    const rawUserAgent = request.headers?.["user-agent"];
    const userAgent = (Array.isArray(rawUserAgent) ? rawUserAgent[0] : rawUserAgent)?.trim().slice(0, 500) || null;
    const ipAddress = this.clientIp(request).slice(0, 80);
    await this.prisma.authSession.update({ where: { id: sessionId }, data: { userAgent, ipAddress } });
  }
}

@Module({ controllers: [IamController] })
export class IamModule {}
