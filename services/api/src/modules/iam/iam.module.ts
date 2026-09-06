import { Body, Controller, Delete, Get, Module, Param, Post } from "@nestjs/common";
import type { AuthPrincipal, IdentityRole } from "@carepoint/identity";
import { CurrentPrincipal, Public, RequirePermissions } from "../../security/api-security.module";
import { PersistentAuthService } from "../../security/persistent-auth.service";

interface PatientRegistrationBody { email: string; password: string; firstName: string; lastName: string; phone?: string; }
interface ManagedAccountBody { email: string; password: string; role: IdentityRole; }
interface LoginBody { email: string; password: string; }
interface ConfirmMfaBody { code: string; }
interface CompleteMfaBody { challengeId: string; code: string; }
interface RefreshBody { refreshToken: string; }

@Controller("iam")
class IamController {
  constructor(private readonly auth: PersistentAuthService) {}

  @Public()
  @Post("register/patient")
  registerPatient(@Body() body: PatientRegistrationBody) {
    return this.auth.registerPatient(body);
  }

  @Public()
  @Post("login")
  login(@Body() body: LoginBody) {
    return this.auth.login(body.email, body.password);
  }

  @Public()
  @Post("mfa/verify")
  completeMfa(@Body() body: CompleteMfaBody) {
    return this.auth.completeMfa(body.challengeId, body.code);
  }

  @Public()
  @Post("sessions/refresh")
  refresh(@Body() body: RefreshBody) {
    return this.auth.refresh(body.refreshToken);
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
}

@Module({ controllers: [IamController] })
export class IamModule {}
