import { Body, Controller, Delete, Get, Module, Param, Post } from "@nestjs/common";
import type { IdentityRole } from "@carepoint/identity";
import { IdentityCoreService } from "../../core/identity-core.module";

interface CreateAccountBody { email: string; password: string; role: IdentityRole; }
interface LoginBody { email: string; password: string; }
interface ConfirmMfaBody { code: string; }
interface CompleteMfaBody { challengeId: string; code: string; }
interface RefreshBody { refreshToken: string; }

@Controller("iam")
class IamController {
  constructor(private readonly identity: IdentityCoreService) {}

  @Post("accounts")
  createAccount(@Body() body: CreateAccountBody) { return this.identity.auth.createAccount(body); }

  @Get("accounts/:accountId")
  account(@Param("accountId") accountId: string) { return this.identity.auth.getAccount(accountId); }

  @Post("login")
  login(@Body() body: LoginBody) { return this.identity.auth.login(body.email, body.password); }

  @Post("mfa/:accountId/enroll")
  enrollMfa(@Param("accountId") accountId: string) { return this.identity.auth.beginMfa(accountId); }

  @Post("mfa/:accountId/confirm")
  confirmMfa(@Param("accountId") accountId: string, @Body() body: ConfirmMfaBody) { this.identity.auth.confirmMfa(accountId, body.code); return { enabled: true }; }

  @Post("mfa/verify")
  completeMfa(@Body() body: CompleteMfaBody) { return this.identity.auth.completeMfa(body.challengeId, body.code); }

  @Post("sessions/refresh")
  refresh(@Body() body: RefreshBody) { return this.identity.auth.refresh(body.refreshToken); }

  @Delete("sessions/:sessionId")
  revoke(@Param("sessionId") sessionId: string) { this.identity.auth.revoke(sessionId); return { revoked: true }; }

  @Post("accounts/:accountId/revoke-all-sessions")
  revokeAll(@Param("accountId") accountId: string) { this.identity.auth.revokeAll(accountId); return { revoked: true }; }
}

@Module({ controllers: [IamController] })
export class IamModule {}
