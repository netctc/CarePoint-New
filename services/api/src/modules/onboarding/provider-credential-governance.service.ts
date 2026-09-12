import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { jsonStringArray, missingCurrentCredentialTypes } from "../../security/provider-credential-validity";

@Injectable()
export class ProviderCredentialGovernanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
  ) {}

  async assertApprovable(principal: AuthPrincipal, onboardingId: string): Promise<void> {
    const record = await this.prisma.providerOnboarding.findUnique({
      where: { id: onboardingId },
      include: { credentials: true, providerCategory: true },
    });
    if (!record) throw new NotFoundException("Onboarding not found.");

    const requiredTypes = record.kind === "DOCTOR"
      ? ["medical-license"]
      : jsonStringArray(record.providerCategory?.requiredCredentialTypes);
    const verified = record.credentials.filter((credential) => credential.state === "VERIFIED");
    const missingCurrent = missingCurrentCredentialTypes(requiredTypes, verified);
    if (missingCurrent.length === 0) return;

    await this.audit.write({
      actorId: principal.accountId,
      action: "PROVIDER_APPROVAL_DENIED_CREDENTIAL_VALIDITY",
      objectType: "PROVIDER_ONBOARDING",
      objectId: onboardingId,
      purpose: "PROVIDER_GOVERNANCE",
      result: "DENIED",
      metadata: {
        kind: record.kind,
        missingCredentialTypes: missingCurrent,
      },
    });
    throw new BadRequestException(`Missing current verified credential types: ${missingCurrent.join(", ")}`);
  }
}
