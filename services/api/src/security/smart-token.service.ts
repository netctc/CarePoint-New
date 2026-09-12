import { ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { tokenHash, type AuthPrincipal } from "@carepoint/identity";
import { DatabaseAuditService } from "../infrastructure/audit/audit.service";
import { PrismaService } from "../infrastructure/prisma/prisma.module";
import { RedisSecurityService } from "../infrastructure/redis/redis-security.module";
import { SmartConfigurationService } from "./smart-configuration.service";

export type SmartFhirInteraction = "r" | "s";
export interface SmartFhirRequirement {
  resourceType: string;
  interaction: SmartFhirInteraction;
}

export type SmartAuthorizationType = "patient" | "system";

export interface SmartAccessContext {
  principal: AuthPrincipal;
  authorizationType: SmartAuthorizationType;
  tokenId: string;
  clientId: string;
  patientId: string | null;
  scopes: string[];
  expiresAt: string;
  refreshFamilyId?: string;
}

export interface StoredSmartAccessToken {
  tokenKind?: "patient";
  tokenId: string;
  clientId: string;
  userId: string;
  patientId: string;
  scopes: string[];
  expiresAt: string;
  refreshFamilyId?: string;
}

export interface StoredSmartSystemAccessToken {
  tokenKind: "system";
  tokenId: string;
  clientId: string;
  scopes: string[];
  expiresAt: string;
}

export interface StoredSmartRefreshFamily {
  familyId: string;
  clientId: string;
  userId: string;
  patientId: string;
  scopes: string[];
  createdAt: string;
  expiresAt: string;
}

type ParsedSmartAccessToken = StoredSmartAccessToken | StoredSmartSystemAccessToken;

@Injectable()
export class SmartTokenService {
  constructor(
    private readonly redis: RedisSecurityService,
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly config: SmartConfigurationService,
  ) {}

  async validateAccessToken(accessToken: string): Promise<SmartAccessContext> {
    const accessKey = this.tokenKey(accessToken);
    const stored = await this.redis.getEphemeral(accessKey);
    if (!stored) throw new UnauthorizedException("Access token is invalid or expired.");
    const token = this.parseStoredToken(stored);
    if (new Date(token.expiresAt).getTime() <= Date.now()) {
      await this.redis.deleteEphemeral(accessKey);
      throw new UnauthorizedException("Access token is invalid or expired.");
    }

    if (token.tokenKind === "system") return this.validateSystemToken(token, accessKey);
    return this.validatePatientToken(token, accessKey);
  }

  async assertFhirAccess(context: SmartAccessContext, requirement: SmartFhirRequirement, requestUrl: string | null): Promise<void> {
    const allowed = context.scopes.some((scope) => this.scopeAllows(scope, requirement, context.authorizationType));
    if (allowed) return;
    await this.audit.write({
      actorId: context.principal.accountId,
      action: "SMART_SCOPE_DENIED",
      objectType: "FHIR_ROUTE",
      objectId: requestUrl,
      purpose: context.authorizationType === "patient" ? "PATIENT_ACCESS" : "SYSTEM_ACCESS",
      result: "DENIED",
      metadata: {
        authorizationType: context.authorizationType,
        clientId: context.clientId,
        patientId: context.patientId,
        resourceType: requirement.resourceType,
        interaction: requirement.interaction,
        scopes: context.scopes,
        refreshFamilyId: context.refreshFamilyId ?? null,
      },
    });
    throw new ForbiddenException(`SMART token does not grant ${requirement.interaction === "r" ? "read" : "search"} access to ${requirement.resourceType}.`);
  }

  async assertSystemFhirOperation(context: SmartAccessContext, operation: string, requestUrl: string | null): Promise<void> {
    if (context.authorizationType === "system") return;
    await this.audit.write({
      actorId: context.principal.accountId,
      action: "SMART_SYSTEM_OPERATION_DENIED",
      objectType: "FHIR_OPERATION",
      objectId: operation,
      purpose: "SYSTEM_ACCESS",
      result: "DENIED",
      metadata: {
        authorizationType: context.authorizationType,
        clientId: context.clientId,
        patientId: context.patientId,
        requestUrl,
        scopes: context.scopes,
      },
    });
    throw new ForbiddenException(`FHIR operation '${operation}' requires a SMART backend-services token.`);
  }

  async denyNonFhirRoute(context: SmartAccessContext, requestUrl: string | null): Promise<never> {
    await this.audit.write({
      actorId: context.principal.accountId,
      action: "SMART_NON_FHIR_ROUTE_DENIED",
      objectType: "API_ROUTE",
      objectId: requestUrl,
      purpose: context.authorizationType === "patient" ? "PATIENT_ACCESS" : "SYSTEM_ACCESS",
      result: "DENIED",
      metadata: {
        authorizationType: context.authorizationType,
        clientId: context.clientId,
        patientId: context.patientId,
        refreshFamilyId: context.refreshFamilyId ?? null,
      },
    });
    throw new ForbiddenException("SMART access tokens are restricted to explicitly scoped FHIR routes.");
  }

  tokenKey(accessToken: string): string {
    return `carepoint:smart:token:${tokenHash(accessToken)}`;
  }

  refreshFamilyKey(familyId: string): string {
    return `carepoint:smart:refresh-family:${familyId}`;
  }

  private async validatePatientToken(token: StoredSmartAccessToken, accessKey: string): Promise<SmartAccessContext> {
    if (token.refreshFamilyId) {
      const familyRaw = await this.redis.getEphemeral(this.refreshFamilyKey(token.refreshFamilyId));
      if (!familyRaw) {
        await this.redis.deleteEphemeral(accessKey);
        throw new UnauthorizedException("Access token is invalid or expired.");
      }
      const family = this.parseRefreshFamily(familyRaw);
      if (
        family.familyId !== token.refreshFamilyId ||
        family.clientId !== token.clientId ||
        family.userId !== token.userId ||
        family.patientId !== token.patientId ||
        new Date(family.expiresAt).getTime() <= Date.now()
      ) {
        await this.redis.deleteEphemeral(accessKey);
        throw new UnauthorizedException("Access token is invalid or expired.");
      }
    }

    const user = await this.prisma.user.findUnique({
      where: { id: token.userId },
      select: { id: true, role: true, status: true, patientProfile: { select: { id: true } } },
    });
    if (!user || user.status !== "ACTIVE" || user.role !== "PATIENT" || user.patientProfile?.id !== token.patientId) {
      await this.redis.deleteEphemeral(accessKey);
      throw new UnauthorizedException("Access token is invalid or expired.");
    }
    return {
      principal: { accountId: user.id, role: "PATIENT", sessionId: token.tokenId },
      authorizationType: "patient",
      tokenId: token.tokenId,
      clientId: token.clientId,
      patientId: token.patientId,
      scopes: token.scopes,
      expiresAt: token.expiresAt,
      ...(token.refreshFamilyId ? { refreshFamilyId: token.refreshFamilyId } : {}),
    };
  }

  private async validateSystemToken(token: StoredSmartSystemAccessToken, accessKey: string): Promise<SmartAccessContext> {
    const client = this.config.backendClient(token.clientId);
    if (!client || !token.scopes.every((scope) => client.allowedScopes.includes(scope))) {
      await this.redis.deleteEphemeral(accessKey);
      throw new UnauthorizedException("Access token is invalid or expired.");
    }
    return {
      principal: {
        accountId: `smart-system:${token.clientId}`,
        role: "SUPPORT",
        sessionId: token.tokenId,
      },
      authorizationType: "system",
      tokenId: token.tokenId,
      clientId: token.clientId,
      patientId: null,
      scopes: token.scopes,
      expiresAt: token.expiresAt,
    };
  }

  private scopeAllows(scope: string, requirement: SmartFhirRequirement, authorizationType: SmartAuthorizationType): boolean {
    const prefix = authorizationType === "patient" ? "patient" : "system";
    const match = new RegExp(`^${prefix}\\/([A-Z][A-Za-z0-9]*)\\.([cruds]+)$`).exec(scope);
    if (!match || match[1] !== requirement.resourceType) return false;
    return match[2]?.includes(requirement.interaction) ?? false;
  }

  private parseStoredToken(value: string): ParsedSmartAccessToken {
    const item = this.parseJson(value);
    if (item.tokenKind === "system") return this.parseSystemToken(item);
    return this.parsePatientToken(item);
  }

  private parsePatientToken(item: Record<string, unknown>): StoredSmartAccessToken {
    if (
      (item.tokenKind !== undefined && item.tokenKind !== "patient") ||
      typeof item.tokenId !== "string" ||
      typeof item.clientId !== "string" ||
      typeof item.userId !== "string" ||
      typeof item.patientId !== "string" ||
      typeof item.expiresAt !== "string" ||
      (item.refreshFamilyId !== undefined && typeof item.refreshFamilyId !== "string") ||
      !Array.isArray(item.scopes) ||
      !item.scopes.every((scope) => typeof scope === "string")
    ) {
      throw new UnauthorizedException("Access token is invalid or expired.");
    }
    return {
      ...(item.tokenKind === "patient" ? { tokenKind: "patient" as const } : {}),
      tokenId: item.tokenId,
      clientId: item.clientId,
      userId: item.userId,
      patientId: item.patientId,
      scopes: item.scopes as string[],
      expiresAt: item.expiresAt,
      ...(typeof item.refreshFamilyId === "string" ? { refreshFamilyId: item.refreshFamilyId } : {}),
    };
  }

  private parseSystemToken(item: Record<string, unknown>): StoredSmartSystemAccessToken {
    if (
      item.tokenKind !== "system" ||
      typeof item.tokenId !== "string" ||
      typeof item.clientId !== "string" ||
      typeof item.expiresAt !== "string" ||
      !Array.isArray(item.scopes) ||
      !item.scopes.every((scope) => typeof scope === "string")
    ) {
      throw new UnauthorizedException("Access token is invalid or expired.");
    }
    return {
      tokenKind: "system",
      tokenId: item.tokenId,
      clientId: item.clientId,
      scopes: item.scopes as string[],
      expiresAt: item.expiresAt,
    };
  }

  private parseJson(value: string): Record<string, unknown> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new UnauthorizedException("Access token is invalid or expired.");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new UnauthorizedException("Access token is invalid or expired.");
    return parsed as Record<string, unknown>;
  }

  private parseRefreshFamily(value: string): StoredSmartRefreshFamily {
    const item = this.parseJson(value);
    if (
      typeof item.familyId !== "string" ||
      typeof item.clientId !== "string" ||
      typeof item.userId !== "string" ||
      typeof item.patientId !== "string" ||
      typeof item.createdAt !== "string" ||
      typeof item.expiresAt !== "string" ||
      !Array.isArray(item.scopes) ||
      !item.scopes.every((scope) => typeof scope === "string")
    ) {
      throw new UnauthorizedException("Access token is invalid or expired.");
    }
    return {
      familyId: item.familyId,
      clientId: item.clientId,
      userId: item.userId,
      patientId: item.patientId,
      scopes: item.scopes as string[],
      createdAt: item.createdAt,
      expiresAt: item.expiresAt,
    };
  }
}
