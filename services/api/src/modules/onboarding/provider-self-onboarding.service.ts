import { ForbiddenException, Injectable } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";

@Injectable()
export class ProviderSelfOnboardingService {
  constructor(private readonly prisma: PrismaService) {}

  async state(principal: AuthPrincipal) {
    const kind = principal.role === "DOCTOR"
      ? "DOCTOR"
      : principal.role === "OTHER_PROVIDER"
        ? "OTHER_PROVIDER"
        : null;
    if (!kind) throw new ForbiddenException("Provider self-onboarding is available only to provider accounts.");

    const [provider, onboarding] = await Promise.all([
      this.prisma.provider.findUnique({
        where: { userId: principal.accountId },
        select: {
          id: true,
          class: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.providerOnboarding.findFirst({
        where: { userId: principal.accountId, kind },
        orderBy: { updatedAt: "desc" },
        include: {
          credentials: { orderBy: { createdAt: "desc" } },
          specialty: {
            select: { id: true, code: true, labels: true, active: true },
          },
          providerCategory: {
            select: {
              id: true,
              slug: true,
              labels: true,
              family: true,
              active: true,
              requiredCredentialTypes: true,
              capabilities: true,
            },
          },
        },
      }),
    ]);

    return {
      kind,
      provider,
      onboarding,
      accessReady: provider?.status === "ACTIVE",
    };
  }
}
