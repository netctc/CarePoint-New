import { ConflictException, ForbiddenException, Injectable } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";

@Injectable()
export class ProviderSelfOnboardingService {
  constructor(private readonly prisma: PrismaService) {}

  async assertCanStart(principal: AuthPrincipal) {
    const kind = principal.role === "DOCTOR"
      ? "DOCTOR"
      : principal.role === "OTHER_PROVIDER"
        ? "OTHER_PROVIDER"
        : null;
    if (!kind) throw new ForbiddenException("Provider self-onboarding is available only to provider accounts.");

    const provider = await this.prisma.provider.findUnique({
      where: { userId: principal.accountId },
      select: { class: true, status: true },
    });
    if (!provider) return;
    if (provider.class !== kind) throw new ConflictException("Provider domain mismatch.");
    if (provider.status === "ACTIVE") {
      throw new ConflictException("An active provider cannot restart onboarding.");
    }
    if (provider.status === "SUSPENDED") {
      throw new ConflictException("A suspended provider cannot restart onboarding.");
    }
  }

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
        select: {
          id: true,
          kind: true,
          state: true,
          submittedAt: true,
          reviewedAt: true,
          reviewNote: true,
          createdAt: true,
          updatedAt: true,
          credentials: {
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              type: true,
              number: true,
              issuer: true,
              validUntil: true,
              state: true,
              reviewNote: true,
              reviewedAt: true,
              createdAt: true,
              updatedAt: true,
            },
          },
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
