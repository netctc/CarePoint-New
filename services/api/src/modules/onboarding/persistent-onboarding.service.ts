import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { canActOnAccount, canOwnOnboarding, roleHasPermission, type AuthPrincipal } from "@carepoint/identity";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PersistentAuthService } from "../../security/persistent-auth.service";

const OPEN_STATES = ["DRAFT", "PENDING_REVIEW", "REQUEST_CHANGES"] as const;

@Injectable()
export class PersistentOnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly auth: PersistentAuthService,
  ) {}

  async list(principal: AuthPrincipal) {
    this.requireReviewPermission(principal);
    const records = await this.prisma.providerOnboarding.findMany({
      include: {
        credentials: { orderBy: { createdAt: "asc" } },
        specialty: true,
        providerCategory: true,
        user: { select: { id: true, email: true, role: true, status: true } },
      },
      orderBy: { updatedAt: "desc" },
    });
    if (records.length === 0) return [];

    const providers = await this.prisma.provider.findMany({
      where: { userId: { in: records.map((record) => record.userId) } },
      select: { id: true, userId: true, class: true, displayName: true, legalName: true, status: true, updatedAt: true },
    });
    const providerByUser = new Map(providers.filter((provider) => provider.userId).map((provider) => [provider.userId as string, provider]));
    return records.map((record) => ({ ...record, provider: providerByUser.get(record.userId) || null }));
  }

  async startDoctor(principal: AuthPrincipal, specialtyId: string) {
    if (principal.role !== "DOCTOR") throw new ForbiddenException("Doctor onboarding requires a DOCTOR account.");
    const specialty = await this.prisma.medicalSpecialty.findUnique({ where: { id: specialtyId } });
    if (!specialty?.active) throw new BadRequestException("An active medical specialty is required.");
    await this.ensureNoOpenOnboarding(principal.accountId, "DOCTOR");
    const user = await this.requireUser(principal.accountId);

    const result = await this.prisma.$transaction(async (tx) => {
      const existingProvider = await tx.provider.findUnique({ where: { userId: principal.accountId } });
      if (existingProvider && existingProvider.class !== "DOCTOR") throw new ConflictException("Provider domain mismatch.");
      if (existingProvider) {
        await tx.provider.update({ where: { id: existingProvider.id }, data: { status: "DRAFT" } });
      } else {
        await tx.provider.create({ data: { userId: principal.accountId, class: "DOCTOR", displayName: user.email, status: "DRAFT" } });
      }
      return tx.providerOnboarding.create({
        data: { userId: principal.accountId, kind: "DOCTOR", specialtyId },
        include: { credentials: true, specialty: true },
      });
    });

    await this.audit.write({
      actorId: principal.accountId,
      action: "DOCTOR_ONBOARDING_STARTED",
      objectType: "PROVIDER_ONBOARDING",
      objectId: result.id,
      result: "SUCCESS",
      metadata: { specialtyId },
    });
    return result;
  }

  async startOtherProvider(principal: AuthPrincipal, providerCategoryId: string) {
    if (principal.role !== "OTHER_PROVIDER") throw new ForbiddenException("Other Provider onboarding requires an OTHER_PROVIDER account. Doctors are excluded.");
    const category = await this.prisma.providerCategory.findUnique({ where: { id: providerCategoryId } });
    if (!category?.active) throw new BadRequestException("An active non-doctor provider category is required.");
    await this.ensureNoOpenOnboarding(principal.accountId, "OTHER_PROVIDER");
    const user = await this.requireUser(principal.accountId);

    const result = await this.prisma.$transaction(async (tx) => {
      const existingProvider = await tx.provider.findUnique({ where: { userId: principal.accountId } });
      if (existingProvider && existingProvider.class !== "OTHER_PROVIDER") throw new ConflictException("Provider domain mismatch.");
      if (existingProvider) {
        await tx.provider.update({ where: { id: existingProvider.id }, data: { status: "DRAFT" } });
      } else {
        await tx.provider.create({ data: { userId: principal.accountId, class: "OTHER_PROVIDER", displayName: user.email, status: "DRAFT" } });
      }
      return tx.providerOnboarding.create({
        data: { userId: principal.accountId, kind: "OTHER_PROVIDER", providerCategoryId },
        include: { credentials: true, providerCategory: true },
      });
    });

    await this.audit.write({
      actorId: principal.accountId,
      action: "OTHER_PROVIDER_ONBOARDING_STARTED",
      objectType: "PROVIDER_ONBOARDING",
      objectId: result.id,
      result: "SUCCESS",
      metadata: { providerCategoryId },
    });
    return result;
  }

  async addCredential(
    principal: AuthPrincipal,
    onboardingId: string,
    input: { type: string; number?: string; issuer?: string; validUntil?: string; documentId?: string },
  ) {
    const record = await this.requireOwnedOnboarding(principal, onboardingId);
    if (record.state !== "DRAFT" && record.state !== "REQUEST_CHANGES") throw new ConflictException("Credentials cannot be changed while onboarding is under review or approved.");
    if (!input.type?.trim()) throw new BadRequestException("Credential type is required.");

    const credential = await this.prisma.onboardingCredential.create({
      data: {
        onboardingId,
        type: input.type.trim().toLowerCase(),
        number: input.number?.trim() || null,
        issuer: input.issuer?.trim() || null,
        validUntil: input.validUntil ? new Date(input.validUntil) : null,
        documentId: input.documentId?.trim() || null,
      },
    });
    await this.audit.write({
      actorId: principal.accountId,
      action: "ONBOARDING_CREDENTIAL_ADDED",
      objectType: "PROVIDER_CREDENTIAL",
      objectId: credential.id,
      result: "SUCCESS",
      metadata: { onboardingId, type: credential.type },
    });
    return credential;
  }

  async submit(principal: AuthPrincipal, onboardingId: string) {
    const record = await this.requireOwnedOnboarding(principal, onboardingId);
    if (record.state !== "DRAFT" && record.state !== "REQUEST_CHANGES") throw new ConflictException("Onboarding cannot be submitted in its current state.");
    if (record.credentials.length === 0) throw new BadRequestException("At least one credential is required before submission.");

    const requiredTypes = record.kind === "DOCTOR"
      ? ["medical-license"]
      : this.jsonStringArray(record.providerCategory?.requiredCredentialTypes);
    const present = new Set(record.credentials.map((item) => item.type.toLowerCase()));
    const missing = requiredTypes.filter((item) => !present.has(item.toLowerCase()));
    if (missing.length > 0) throw new BadRequestException(`Missing required credential types: ${missing.join(", ")}`);

    const provider = await this.prisma.provider.findUnique({ where: { userId: principal.accountId } });
    if (!provider || provider.class !== record.kind) throw new ConflictException("Provider domain does not match onboarding.");

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.provider.update({ where: { id: provider.id }, data: { status: "PENDING_REVIEW" } });
      return tx.providerOnboarding.update({
        where: { id: onboardingId },
        data: { state: "PENDING_REVIEW", submittedAt: new Date(), reviewNote: null },
        include: { credentials: true, specialty: true, providerCategory: true },
      });
    });

    await this.audit.write({
      actorId: principal.accountId,
      action: "ONBOARDING_SUBMITTED",
      objectType: "PROVIDER_ONBOARDING",
      objectId: onboardingId,
      result: "SUCCESS",
      metadata: { kind: record.kind },
    });
    return result;
  }

  async reviewCredential(
    principal: AuthPrincipal,
    onboardingId: string,
    credentialId: string,
    state: "VERIFIED" | "REJECTED",
    note?: string,
  ) {
    this.requireReviewPermission(principal);
    const record = await this.prisma.providerOnboarding.findUnique({ where: { id: onboardingId } });
    if (!record) throw new NotFoundException("Onboarding not found.");
    if (record.state !== "PENDING_REVIEW" && record.state !== "REQUEST_CHANGES") throw new ConflictException("Onboarding is not under review.");
    const credential = await this.prisma.onboardingCredential.findFirst({ where: { id: credentialId, onboardingId } });
    if (!credential) throw new NotFoundException("Credential not found.");
    if (state !== "VERIFIED" && state !== "REJECTED") throw new BadRequestException("Credential review state is invalid.");
    if (state === "REJECTED" && !note?.trim()) throw new BadRequestException("A review note is required when rejecting a credential.");

    const result = await this.prisma.$transaction(async (tx) => {
      const reviewed = await tx.onboardingCredential.update({
        where: { id: credentialId },
        data: {
          state,
          reviewNote: note?.trim() || null,
          reviewedByActorId: principal.accountId,
          reviewedAt: new Date(),
        },
      });
      if (state === "REJECTED") {
        await tx.providerOnboarding.update({
          where: { id: onboardingId },
          data: {
            state: "REQUEST_CHANGES",
            reviewNote: note?.trim() || "Credential changes required.",
            reviewerActorId: principal.accountId,
            reviewedAt: new Date(),
          },
        });
        const provider = await tx.provider.findUnique({ where: { userId: record.userId } });
        if (provider) await tx.provider.update({ where: { id: provider.id }, data: { status: "DRAFT" } });
      }
      return reviewed;
    });

    await this.audit.write({
      actorId: principal.accountId,
      action: "CREDENTIAL_REVIEWED",
      objectType: "PROVIDER_CREDENTIAL",
      objectId: credentialId,
      result: "SUCCESS",
      metadata: { onboardingId, state, noteProvided: Boolean(note?.trim()) },
    });
    return result;
  }

  async requestChanges(principal: AuthPrincipal, onboardingId: string, note?: string) {
    this.requireReviewPermission(principal);
    const reviewNote = note?.trim();
    if (!reviewNote) throw new BadRequestException("A review note is required when requesting changes.");
    const record = await this.prisma.providerOnboarding.findUnique({ where: { id: onboardingId } });
    if (!record) throw new NotFoundException("Onboarding not found.");
    if (record.state !== "PENDING_REVIEW") throw new ConflictException("Only pending onboarding can be returned for changes.");

    const result = await this.prisma.$transaction(async (tx) => {
      const provider = await tx.provider.findUnique({ where: { userId: record.userId } });
      if (provider) await tx.provider.update({ where: { id: provider.id }, data: { status: "DRAFT" } });
      return tx.providerOnboarding.update({
        where: { id: onboardingId },
        data: {
          state: "REQUEST_CHANGES",
          reviewNote,
          reviewerActorId: principal.accountId,
          reviewedAt: new Date(),
        },
        include: { credentials: true, specialty: true, providerCategory: true },
      });
    });

    await this.audit.write({
      actorId: principal.accountId,
      action: "ONBOARDING_CHANGES_REQUESTED",
      objectType: "PROVIDER_ONBOARDING",
      objectId: onboardingId,
      result: "SUCCESS",
      metadata: { kind: record.kind, note: reviewNote },
    });
    return result;
  }

  async reject(principal: AuthPrincipal, onboardingId: string, note?: string) {
    this.requireReviewPermission(principal);
    const reviewNote = note?.trim();
    if (!reviewNote) throw new BadRequestException("A rejection note is required.");
    const record = await this.prisma.providerOnboarding.findUnique({ where: { id: onboardingId } });
    if (!record) throw new NotFoundException("Onboarding not found.");
    if (record.state !== "PENDING_REVIEW" && record.state !== "REQUEST_CHANGES") {
      throw new ConflictException("Only onboarding under review can be rejected.");
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const provider = await tx.provider.findUnique({ where: { userId: record.userId } });
      if (provider) await tx.provider.update({ where: { id: provider.id }, data: { status: "REJECTED" } });
      return tx.providerOnboarding.update({
        where: { id: onboardingId },
        data: {
          state: "REJECTED",
          reviewNote,
          reviewerActorId: principal.accountId,
          reviewedAt: new Date(),
        },
        include: { credentials: true, specialty: true, providerCategory: true },
      });
    });

    await this.auth.revokeAll(principal, record.userId);
    await this.audit.write({
      actorId: principal.accountId,
      action: "ONBOARDING_REJECTED",
      objectType: "PROVIDER_ONBOARDING",
      objectId: onboardingId,
      result: "SUCCESS",
      metadata: { kind: record.kind, accountId: record.userId, note: reviewNote },
    });
    return result;
  }

  async approve(principal: AuthPrincipal, onboardingId: string) {
    this.requireReviewPermission(principal);
    const record = await this.prisma.providerOnboarding.findUnique({
      where: { id: onboardingId },
      include: { credentials: true, providerCategory: true, specialty: true, user: true },
    });
    if (!record) throw new NotFoundException("Onboarding not found.");
    if (record.state !== "PENDING_REVIEW") throw new ConflictException("Onboarding must be pending review before approval.");
    if (record.credentials.length === 0) throw new BadRequestException("At least one credential is required before approval.");
    if (record.credentials.some((item) => item.state === "PENDING")) {
      throw new BadRequestException("Every pending credential must be reviewed before approval.");
    }

    const requiredTypes = record.kind === "DOCTOR"
      ? ["medical-license"]
      : this.jsonStringArray(record.providerCategory?.requiredCredentialTypes);
    const verifiedCredentials = record.credentials.filter((item) => item.state === "VERIFIED");
    const verifiedTypes = new Set(verifiedCredentials.map((item) => item.type.toLowerCase()));
    const missingVerified = requiredTypes.filter((item) => !verifiedTypes.has(item.toLowerCase()));
    if (missingVerified.length > 0) {
      throw new BadRequestException(`Missing verified credential types: ${missingVerified.join(", ")}`);
    }

    const provider = await this.prisma.provider.findUnique({ where: { userId: record.userId } });
    if (!provider || provider.class !== record.kind) throw new ConflictException("Provider domain does not match onboarding.");

    const result = await this.prisma.$transaction(async (tx) => {
      if (record.kind === "DOCTOR") {
        if (!record.specialtyId) throw new BadRequestException("Doctor specialty is missing.");
        const license = [...verifiedCredentials]
          .filter((item) => item.type === "medical-license")
          .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0];
        if (!license?.number) throw new BadRequestException("Verified medical-license number is required for doctor activation.");
        const doctor = await tx.doctorProfile.upsert({
          where: { providerId: provider.id },
          create: { providerId: provider.id, licenseNumber: license.number, licenseIssuer: license.issuer },
          update: { licenseNumber: license.number, licenseIssuer: license.issuer },
        });
        await tx.doctorSpecialty.upsert({
          where: { doctorId_specialtyId: { doctorId: doctor.id, specialtyId: record.specialtyId } },
          create: { doctorId: doctor.id, specialtyId: record.specialtyId, primary: true },
          update: { primary: true },
        });
      } else {
        if (!record.providerCategoryId) throw new BadRequestException("Other Provider category is missing.");
        await tx.otherProviderProfile.upsert({
          where: { providerId: provider.id },
          create: { providerId: provider.id, categoryId: record.providerCategoryId },
          update: { categoryId: record.providerCategoryId },
        });
      }

      for (const credential of verifiedCredentials) {
        const existing = credential.documentId
          ? await tx.providerCredential.findFirst({ where: { providerId: provider.id, documentId: credential.documentId } })
          : credential.number
            ? await tx.providerCredential.findFirst({ where: { providerId: provider.id, type: credential.type, number: credential.number } })
            : null;
        if (existing) {
          await tx.providerCredential.update({
            where: { id: existing.id },
            data: {
              type: credential.type,
              issuer: credential.issuer,
              number: credential.number,
              validUntil: credential.validUntil,
              documentId: credential.documentId,
              status: "VERIFIED",
            },
          });
        } else {
          await tx.providerCredential.create({
            data: {
              providerId: provider.id,
              type: credential.type,
              issuer: credential.issuer,
              number: credential.number,
              validUntil: credential.validUntil,
              documentId: credential.documentId,
              status: "VERIFIED",
            },
          });
        }
      }

      await tx.provider.update({ where: { id: provider.id }, data: { status: "ACTIVE" } });
      return tx.providerOnboarding.update({
        where: { id: onboardingId },
        data: { state: "APPROVED", reviewedAt: new Date(), reviewerActorId: principal.accountId, reviewNote: null },
        include: { credentials: true, specialty: true, providerCategory: true },
      });
    });

    await this.audit.write({
      actorId: principal.accountId,
      action: "ONBOARDING_APPROVED",
      objectType: "PROVIDER_ONBOARDING",
      objectId: onboardingId,
      result: "SUCCESS",
      metadata: { kind: record.kind, providerId: provider.id, promotedCredentials: verifiedCredentials.length },
    });
    return result;
  }

  async providerState(principal: AuthPrincipal, accountId = principal.accountId) {
    if (!canActOnAccount(principal, accountId)) throw new ForbiddenException("Provider access denied.");
    const provider = await this.prisma.provider.findUnique({
      where: { userId: accountId },
      select: { id: true, class: true, status: true },
    });
    if (!provider) throw new NotFoundException("Provider profile not found.");
    return provider;
  }

  async suspendProvider(principal: AuthPrincipal, accountId: string) {
    this.requireReviewPermission(principal);
    const provider = await this.prisma.provider.findUnique({ where: { userId: accountId } });
    if (!provider) throw new NotFoundException("Provider profile not found.");
    await this.prisma.provider.update({ where: { id: provider.id }, data: { status: "SUSPENDED" } });
    await this.auth.revokeAll(principal, accountId);
    await this.audit.write({
      actorId: principal.accountId,
      action: "PROVIDER_SUSPENDED",
      objectType: "PROVIDER",
      objectId: provider.id,
      result: "SUCCESS",
      metadata: { accountId, class: provider.class },
    });
    return { id: provider.id, class: provider.class, status: "SUSPENDED" };
  }

  private async requireOwnedOnboarding(principal: AuthPrincipal, onboardingId: string) {
    const record = await this.prisma.providerOnboarding.findUnique({
      where: { id: onboardingId },
      include: { credentials: true, providerCategory: true },
    });
    if (!record) throw new NotFoundException("Onboarding not found.");
    if (!canOwnOnboarding(principal, record.userId)) {
      await this.audit.write({
        actorId: principal.accountId,
        action: "ONBOARDING_ACCESS_DENIED",
        objectType: "PROVIDER_ONBOARDING",
        objectId: onboardingId,
        result: "DENIED",
        metadata: { ownerAccountId: record.userId, role: principal.role },
      });
      throw new ForbiddenException("Onboarding access denied.");
    }
    return record;
  }

  private async ensureNoOpenOnboarding(accountId: string, kind: "DOCTOR" | "OTHER_PROVIDER") {
    const existing = await this.prisma.providerOnboarding.findFirst({
      where: { userId: accountId, kind, state: { in: [...OPEN_STATES] } },
    });
    if (existing) throw new ConflictException("An open onboarding already exists for this provider account.");
  }

  private async requireUser(accountId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: accountId } });
    if (!user) throw new NotFoundException("Account not found.");
    return user;
  }

  private requireReviewPermission(principal: AuthPrincipal): void {
    if (!roleHasPermission(principal.role, "PROVIDER_REVIEW")) throw new ForbiddenException("Provider review permission is required.");
  }

  private jsonStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  }
}
