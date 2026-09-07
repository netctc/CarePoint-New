import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Global,
  Injectable,
  Module,
  SetMetadata,
  UnauthorizedException,
} from "@nestjs/common";
import { APP_FILTER, APP_GUARD, Reflector } from "@nestjs/core";
import { principalHasAnyPermission, type AuthPrincipal, type Permission } from "@carepoint/identity";
import { PrismaModule } from "../infrastructure/prisma/prisma.module";
import { PrismaKnownRequestFilter } from "../infrastructure/prisma/prisma-conflict.filter";
import { DatabaseAuditService } from "../infrastructure/audit/audit.service";
import { MfaEnvelopeService } from "../infrastructure/security/mfa-envelope.service";
import { PersistentAuthService } from "./persistent-auth.service";

const PUBLIC_ROUTE = "carepoint:public-route";
const REQUIRED_PERMISSIONS = "carepoint:required-permissions";

export const Public = () => SetMetadata(PUBLIC_ROUTE, true);
export const RequirePermissions = (...permissions: Permission[]) => SetMetadata(REQUIRED_PERMISSIONS, permissions);

export const CurrentPrincipal = createParamDecorator((_data: unknown, context: ExecutionContext): AuthPrincipal => {
  const request = context.switchToHttp().getRequest<{ principal?: AuthPrincipal }>();
  if (!request.principal) throw new UnauthorizedException("Authentication context is missing.");
  return request.principal;
});

@Injectable()
class ApiAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: PersistentAuthService,
    private readonly audit: DatabaseAuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<{ headers: { authorization?: string }; principal?: AuthPrincipal; method?: string; url?: string }>();
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) throw new UnauthorizedException("Bearer access token is required.");

    const token = header.slice("Bearer ".length).trim();
    if (!token) throw new UnauthorizedException("Bearer access token is required.");
    const principal = await this.auth.validateAccessToken(token);
    request.principal = principal;

    const permissions = this.reflector.getAllAndOverride<Permission[]>(REQUIRED_PERMISSIONS, [context.getHandler(), context.getClass()]) ?? [];
    if (!principalHasAnyPermission(principal, permissions)) {
      await this.audit.write({
        actorId: principal.accountId,
        action: "AUTHORIZATION_DENIED",
        objectType: "API_ROUTE",
        objectId: request.url ?? null,
        result: "DENIED",
        metadata: { method: request.method ?? null, role: principal.role, requiredPermissions: permissions },
      });
      throw new ForbiddenException("Authorization denied.");
    }
    return true;
  }
}

@Global()
@Module({
  imports: [PrismaModule],
  providers: [
    DatabaseAuditService,
    MfaEnvelopeService,
    PersistentAuthService,
    { provide: APP_GUARD, useClass: ApiAccessGuard },
    { provide: APP_FILTER, useClass: PrismaKnownRequestFilter },
  ],
  exports: [DatabaseAuditService, MfaEnvelopeService, PersistentAuthService],
})
export class ApiSecurityModule {}
