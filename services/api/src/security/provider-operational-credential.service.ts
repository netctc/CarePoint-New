import { ForbiddenException, Injectable } from "@nestjs/common";
import { roleHasPermission, type AuthPrincipal, type Permission } from "@carepoint/identity";
import { PrismaService } from "../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../infrastructure/audit/audit.service";
import { jsonStringArray, missingCurrentCredentialTypes } from "./provider-credential-validity";

const PROVIDER_NON_OPERATIONAL_PERMISSIONS = new Set<Permission>([
  "PROVIDER_SELF_ONBOARD",
  "SELF_NOTIFICATION_MANAGE",
  "SELF_SESSION_MANAGE",
]);

@Injectable()
export class ProviderOperationalCredentialService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
  ) {}

  async assertAccess(principal: AuthPrincipal, permissions: readonly Permission[], route: string | null): Promise<void> {
    if (principal.role !== "DOCTOR" && principal.role !== "OTHER_PROVIDER") return;

    const effectivePermissions = permissions.filter((permission) => roleHasPermission(principal.role, permission));
    if (effectivePermissions.length === 0 || effectivePermissions.every((permission) => PROVIDER_NON_OPERATIONAL_PERMISSIONS.has(permission))) return;

    const provider = await this.prisma.provider.findUnique({
      where: { userId: principal.accountId },
      include: {
        credentials: true,
        otherProviderProfile: { include: { category: true } },
      },
    });

    const expectedClass = principal.role === "DOCTOR" ? "DOCTOR" : "OTHER_PROVIDER";
    if (!provider || provider.class !== expectedClass || provider.status !== "ACTIVE") {
      await this.deny(principal, route, provider?.id ?? null, "PROVIDER_NOT_ACTIVE", []);
    }

    if (principal.role === "OTHER_PROVIDER" && !provider.otherProviderProfile?.category?.active) {
      await this.deny(principal, route, provider.id, "PROVIDER_CATEGORY_NOT_ACTIVE", []);
    }

    const requiredTypes = principal.role === "DOCTOR"
      ? ["medical-license"]
      : jsonStringArray(provider.otherProviderProfile?.category?.requiredCredentialTypes);
    const verified = provider.credentials.filter((credential) => credential.status === "VERIFIED");
    const missing = missingCurrentCredentialTypes(requiredTypes, verified);
    if (missing.length > 0) {
      await this.deny(principal, route, provider.id, "REQUIRED_CREDENTIAL_NOT_CURRENT", missing);
    }
  }

  private async deny(
    principal: AuthPrincipal,
    route: string | null,
    providerId: string | null,
    reason: string,
    missingCredentialTypes: readonly string[],
  ): Promise<never> {
    await this.audit.write({
      actorId: principal.accountId,
      action: "PROVIDER_OPERATIONAL_ACCESS_DENIED",
      objectType: "PROVIDER",
      objectId: providerId,
      purpose: "PROVIDER_GOVERNANCE",
      result: "DENIED",
      metadata: {
        role: principal.role,
        reason,
        route,
        missingCredentialTypes: [...missingCredentialTypes],
      },
    });
    throw new ForbiddenException("Current verified provider credentials are required for this operation.");
  }
}
