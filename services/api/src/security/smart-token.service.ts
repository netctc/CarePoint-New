import { ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { tokenHash, type AuthPrincipal } from "@carepoint/identity";
import { DatabaseAuditService } from "../infrastructure/audit/audit.service";
import { PrismaService } from "../infrastructure/prisma/prisma.module";
import { RedisSecurityService } from "../infrastructure/redis/redis-security.module";

export type SmartFhirInteraction = "r" | "s";
export interface SmartFhirRequirement {
  resourceType: string;
  interaction: SmartFhirInteraction;
}

export interface SmartAccessContext {
  principal: AuthPrincipal;
  tokenId: string;
  clientId: string;
  patientId: string;
  scopes: string[];
  expiresAt: string;
}

export interface StoredSmartAccessToken {
  tokenId: string;
  clientId: string;
  userId: string;
  patientId: string;
  scopes: string[];
  expiresAt: string;
}

@Injectable()
export class SmartTokenService {
  constructor(
    private readonly redis: RedisSecurityService,
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
  ) {}

  async validateAccessToken(accessToken: string): Promise<SmartAccessContext> {
    const stored = await this.redis.getEphemeral(this.tokenKey(accessToken));
    if (!stored) throw new UnauthorizedException("Access token is invalid or expired.");
    const token = this.parseStoredToken(stored);
    if (new Date(token.expiresAt).getTime() <= Date.now()) {
      await this.redis.deleteEphemeral(this.tokenKey(accessToken));
      throw new UnauthorizedException("Access token is invalid or expired.");
    }
    const user = await this.prisma.user.findUnique({
      where: { id: token.userId },
      select: { id: true, role: true, status: true, patientProfile: { select: { id: true } } },
    });
    if (!user || user.status !== "ACTIVE" || user.role !== "PATIENT" || user.patientProfile?.id !== token.patientId) {
      await this.redis.deleteEphemeral(this.tokenKey(accessToken));
      throw new UnauthorizedException("Access token is invalid or expired.");
    }
    return {
      principal: { accountId: user.id, role: "PATIENT", sessionId: token.tokenId },
      tokenId: token.tokenId,
      clientId: token.clientId,
      patientId: token.patientId,
      scopes: token.scopes,
      expiresAt: token.expiresAt,
    };
  }

  async assertFhirAccess(context: SmartAccessContext, requirement: SmartFhirRequirement, requestUrl: string | null): Promise<void> {
    const allowed = context.scopes.some((scope) => this.scopeAllows(scope, requirement));
    if (allowed) return;
    await this.audit.write({
      actorId: context.principal.accountId,
      action: "SMART_SCOPE_DENIED",
      objectType: "FHIR_ROUTE",
      objectId: requestUrl,
      purpose: "PATIENT_ACCESS",
      result: "DENIED",
      metadata: {
        clientId: context.clientId,
        patientId: context.patientId,
        resourceType: requirement.resourceType,
        interaction: requirement.interaction,
        scopes: context.scopes,
      },
    });
    throw new ForbiddenException(`SMART token does not grant ${requirement.interaction === "r" ? "read" : "search"} access to ${requirement.resourceType}.`);
  }

  async denyNonFhirRoute(context: SmartAccessContext, requestUrl: string | null): Promise<never> {
    await this.audit.write({
      actorId: context.principal.accountId,
      action: "SMART_NON_FHIR_ROUTE_DENIED",
      objectType: "API_ROUTE",
      objectId: requestUrl,
      purpose: "PATIENT_ACCESS",
      result: "DENIED",
      metadata: { clientId: context.clientId, patientId: context.patientId },
    });
    throw new ForbiddenException("SMART access tokens are restricted to explicitly scoped FHIR routes.");
  }

  tokenKey(accessToken: string): string {
    return `carepoint:smart:token:${tokenHash(accessToken)}`;
  }

  private scopeAllows(scope: string, requirement: SmartFhirRequirement): boolean {
    const match = /^patient\/([A-Z][A-Za-z0-9]*)\.([cruds]+)$/.exec(scope);
    if (!match || match[1] !== requirement.resourceType) return false;
    return match[2]?.includes(requirement.interaction) ?? false;
  }

  private parseStoredToken(value: string): StoredSmartAccessToken {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new UnauthorizedException("Access token is invalid or expired.");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new UnauthorizedException("Access token is invalid or expired.");
    const item = parsed as Record<string, unknown>;
    if (
      typeof item.tokenId !== "string" ||
      typeof item.clientId !== "string" ||
      typeof item.userId !== "string" ||
      typeof item.patientId !== "string" ||
      typeof item.expiresAt !== "string" ||
      !Array.isArray(item.scopes) ||
      !item.scopes.every((scope) => typeof scope === "string")
    ) {
      throw new UnauthorizedException("Access token is invalid or expired.");
    }
    return {
      tokenId: item.tokenId,
      clientId: item.clientId,
      userId: item.userId,
      patientId: item.patientId,
      scopes: item.scopes as string[],
      expiresAt: item.expiresAt,
    };
  }
}
