import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type { EncryptedEnvelope } from "@carepoint/security";
import { canActOnAccount, canOwnOnboarding, roleHasPermission, type AuthPrincipal } from "@carepoint/identity";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PersistentAuthService } from "../../security/persistent-auth.service";
import { DocumentStorageService } from "../documents/document-storage.service";
import { DocumentsEnvelopeService } from "../documents/documents-envelope.service";
import { DocumentMalwareScannerService } from "../documents/document-malware-scanner.service";

const OPEN_STATES = ["DRAFT", "PENDING_REVIEW", "REQUEST_CHANGES"] as const;

@Injectable()
export class PersistentOnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly auth: PersistentAuthService,
    private readonly documentStorage: DocumentStorageService,
    private readonly documentEnvelope: DocumentsEnvelopeService,
    private readonly documentScanner: DocumentMalwareScannerService,
  ) {}

  async list(principal: AuthPrincipal) {
    this.requireReviewPermission(principal);
    const records = await this.prisma.providerOnboarding.findMany({
      include: {
        credentials: {
          orderBy: { createdAt: "asc" },
          include: {
            documents: {
              orderBy: { createdAt: "asc" },
              select: {
                id: true,
                fileName: true,
                mediaType: true,
                byteLength: true,
                contentDigest: true,
                createdAt: true,
              },
            },
          },
        },
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
      const provider = existingProvider
        ? await tx.provider.update({ where: { id: existingProvider.id }, data: { status: "DRAFT" } })
        : await tx.provider.create({ data: { userId: principal.accountId, class: "DOCTOR", displayName: user.email, status: "DRAFT" } });
      if (!existingProvider || existingProvider.status !== "DRAFT") {
        await tx.providerGovernanceHistory.create({
          data: {
            providerId: provider.id,
            domain: "PROVIDER",
            targetId: provider.id,
            fromStatus: existingProvider?.status ?? null,
            toStatus: "DRAFT",
            reason: "Doctor onboarding started.",
            actorId: principal.accountId,
          },
        });
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
      const provider = existingProvider
        ? await tx.provider.update({ where: { id: existingProvider.id }, data: { status: "DRAFT" } })
        : await tx.provider.create({ data: { userId: principal.accountId, class: "OTHER_PROVIDER", displayName: user.email, status: "DRAFT" } });
      if (!existingProvider || existingProvider.status !== "DRAFT") {
        await tx.providerGovernanceHistory.create({
          data: {
            providerId: provider.id,
            domain: "PROVIDER",
            targetId: provider.id,
            fromStatus: existingProvider?.status ?? null,
            toStatus: "DRAFT",
            reason: "Other Provider onboarding started.",
            actorId: principal.accountId,
          },
        });
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

  async uploadCredentialDocument(
    principal: AuthPrincipal,
    onboardingId: string,
    credentialId: string,
    input: { fileName: string; mediaType?: string; contentBase64: string },
  ) {
    const onboarding = await this.requireOwnedOnboarding(principal, onboardingId);
    if (onboarding.state !== "DRAFT" && onboarding.state !== "REQUEST_CHANGES") {
      throw new ConflictException(
        "Credential documents cannot be changed while onboarding is under review or approved.",
      );
    }

    const credential = await this.prisma.onboardingCredential.findFirst({
      where: { id: credentialId, onboardingId },
      include: { documents: { select: { id: true } } },
    });
    if (!credential) throw new NotFoundException("Credential not found.");
    if (credential.documents.length >= 10) {
      throw new BadRequestException("A credential can contain at most 10 PDF documents.");
    }

    const fileName = input.fileName?.trim();
    if (!fileName || fileName.length > 180 || !fileName.toLowerCase().endsWith(".pdf")) {
      throw new BadRequestException("Credential document fileName must be a PDF name up to 180 characters.");
    }
    const mediaType = (input.mediaType?.trim().toLowerCase() || "application/pdf");
    if (mediaType !== "application/pdf") {
      throw new BadRequestException("Credential documents must use application/pdf.");
    }

    const compact = input.contentBase64?.replace(/\s+/g, "") ?? "";
    if (
      !compact ||
      compact.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(compact)
    ) {
      throw new BadRequestException("Credential document contentBase64 must be valid base64.");
    }
    const bytes = Uint8Array.from(Buffer.from(compact, "base64"));
    const scan = await this.documentScanner.assertClean(bytes, "application/pdf");
    const encrypted = await this.documentEnvelope.encryptBytes(bytes);
    const objectKey = `credentialing/${credentialId}/${randomUUID()}.cpenc`;

    await this.documentStorage.put(objectKey, encrypted.ciphertext);
    try {
      const document = await this.prisma.onboardingCredentialDocument.create({
        data: {
          credentialId,
          fileName,
          mediaType,
          byteLength: bytes.byteLength,
          contentDigest: scan.contentDigest,
          storageProvider: this.documentStorage.storageProviderName(),
          objectKey,
          blobAlgorithm: encrypted.envelope.algorithm,
          blobKeyId: encrypted.envelope.keyId,
          blobWrappedKey: encrypted.envelope.wrappedKey,
          blobIv: encrypted.envelope.iv,
          createdByAccountId: principal.accountId,
        },
        select: {
          id: true,
          fileName: true,
          mediaType: true,
          byteLength: true,
          contentDigest: true,
          createdAt: true,
        },
      });

      await this.audit.write({
        actorId: principal.accountId,
        action: "ONBOARDING_CREDENTIAL_DOCUMENT_UPLOADED",
        objectType: "PROVIDER_CREDENTIAL_DOCUMENT",
        objectId: document.id,
        result: "SUCCESS",
        metadata: {
          onboardingId,
          credentialId,
          mediaType,
          byteLength: document.byteLength,
          scanId: scan.scanId,
        },
      });
      return document;
    } catch (error) {
      await this.documentStorage.remove(objectKey).catch(() => undefined);
      throw error;
    }
  }

  async removeCredential(
    principal: AuthPrincipal,
    onboardingId: string,
    credentialId: string,
  ) {
    const onboarding = await this.requireOwnedOnboarding(principal, onboardingId);
    if (onboarding.state !== "DRAFT" && onboarding.state !== "REQUEST_CHANGES") {
      throw new ConflictException(
        "Credentials cannot be removed while onboarding is under review or approved.",
      );
    }

    const credential = await this.prisma.onboardingCredential.findFirst({
      where: { id: credentialId, onboardingId },
      include: { documents: true },
    });
    if (!credential) throw new NotFoundException("Credential not found.");

    for (const document of credential.documents) {
      await this.documentStorage.remove(document.objectKey);
    }

    await this.prisma.onboardingCredential.delete({
      where: { id: credentialId },
    });

    await this.audit.write({
      actorId: principal.accountId,
      action: "ONBOARDING_CREDENTIAL_REMOVED",
      objectType: "PROVIDER_CREDENTIAL",
      objectId: credentialId,
      result: "SUCCESS",
      metadata: {
        onboardingId,
        removedDocumentCount: credential.documents.length,
      },
    });

    return { id: credentialId, removed: true };
  }

  async credentialDocumentContent(
    principal: AuthPrincipal,
    onboardingId: string,
    credentialId: string,
    documentId: string,
  ) {
    const onboarding = await this.prisma.providerOnboarding.findUnique({
      where: { id: onboardingId },
      select: { id: true, userId: true },
    });
    if (!onboarding) throw new NotFoundException("Onboarding not found.");

    const owner = canOwnOnboarding(principal, onboarding.userId);
    const reviewer = roleHasPermission(principal.role, "PROVIDER_REVIEW");
    if (!owner && !reviewer) {
      throw new ForbiddenException("Credential document access denied.");
    }

    const document = await this.prisma.onboardingCredentialDocument.findFirst({
      where: {
        id: documentId,
        credentialId,
        credential: { onboardingId },
      },
    });
    if (!document) throw new NotFoundException("Credential document not found.");

    if (document.blobAlgorithm !== "AES-256-GCM") {
      throw new ConflictException("Credential document encryption algorithm is unsupported.");
    }
    const ciphertext = await this.documentStorage.get(document.objectKey);
    const envelope: EncryptedEnvelope = {
      version: 1,
      algorithm: "AES-256-GCM",
      keyId: document.blobKeyId,
      wrappedKey: document.blobWrappedKey,
      iv: document.blobIv,
      ciphertext,
    };
    const bytes = await this.documentEnvelope.decryptBytes(envelope);
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== document.contentDigest) {
      throw new ConflictException("Credential document integrity check failed.");
    }

    await this.audit.write({
      actorId: principal.accountId,
      action: "ONBOARDING_CREDENTIAL_DOCUMENT_READ",
      objectType: "PROVIDER_CREDENTIAL_DOCUMENT",
      objectId: document.id,
      purpose: reviewer ? "CREDENTIAL_REVIEW" : "PROVIDER_SELF_ONBOARD",
      result: "SUCCESS",
      metadata: {
        onboardingId,
        credentialId,
        byteLength: bytes.byteLength,
      },
    });

    return {
      id: document.id,
      credentialId,
      fileName: document.fileName,
      mediaType: document.mediaType,
      byteLength: document.byteLength,
      contentDigest: document.contentDigest,
      createdAt: document.createdAt,
      contentBase64: Buffer.from(bytes).toString("base64"),
    };
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
        if (provider) {
          await tx.provider.update({ where: { id: provider.id }, data: { status: "DRAFT" } });
          if (provider.status !== "DRAFT") {
            await tx.providerGovernanceHistory.create({
              data: {
                providerId: provider.id,
                domain: "PROVIDER",
                targetId: provider.id,
                fromStatus: provider.status,
                toStatus: "DRAFT",
                reason: note?.trim() || "Credential rejected during onboarding review.",
                actorId: principal.accountId,
              },
            });
          }
        }
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
      if (provider) {
        await tx.provider.update({ where: { id: provider.id }, data: { status: "DRAFT" } });
        if (provider.status !== "DRAFT") {
          await tx.providerGovernanceHistory.create({
            data: {
              providerId: provider.id,
              domain: "PROVIDER",
              targetId: provider.id,
              fromStatus: provider.status,
              toStatus: "DRAFT",
              reason: reviewNote,
              actorId: principal.accountId,
            },
          });
        }
      }
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
      if (provider) {
        await tx.provider.update({ where: { id: provider.id }, data: { status: "REJECTED" } });
        if (provider.status !== "REJECTED") {
          await tx.providerGovernanceHistory.create({
            data: {
              providerId: provider.id,
              domain: "PROVIDER",
              targetId: provider.id,
              fromStatus: provider.status,
              toStatus: "REJECTED",
              reason: reviewNote,
              actorId: principal.accountId,
            },
          });
        }
      }
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
      include: { credentials: { include: { documents: true } }, providerCategory: true, specialty: true, user: true },
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
        const promoted = existing
          ? await tx.providerCredential.update({
              where: { id: existing.id },
              data: {
                type: credential.type,
                issuer: credential.issuer,
                number: credential.number,
                validUntil: credential.validUntil,
                documentId: credential.documentId,
                status: "VALID",
                verifications: {
                  create: { status: "VALID", note: "Verified during onboarding approval.", actorId: principal.accountId },
                },
              },
            })
          : await tx.providerCredential.create({
              data: {
                providerId: provider.id,
                type: credential.type,
                issuer: credential.issuer,
                number: credential.number,
                validUntil: credential.validUntil,
                documentId: credential.documentId,
                status: "VALID",
                verifications: {
                  create: { status: "VALID", note: "Verified during onboarding approval.", actorId: principal.accountId },
                },
              },
            });

        for (const document of credential.documents) {
          const existingDocument = await tx.providerCredentialDocument.findUnique({ where: { objectKey: document.objectKey } });
          if (!existingDocument) {
            await tx.providerCredentialDocument.create({
              data: {
                credentialId: promoted.id,
                fileName: document.fileName,
                mediaType: document.mediaType,
                byteLength: document.byteLength,
                contentDigest: document.contentDigest,
                storageProvider: document.storageProvider,
                objectKey: document.objectKey,
                blobAlgorithm: document.blobAlgorithm,
                blobKeyId: document.blobKeyId,
                blobWrappedKey: document.blobWrappedKey,
                blobIv: document.blobIv,
                createdByAccountId: document.createdByAccountId,
                createdAt: document.createdAt,
              },
            });
          }
        }

        await tx.providerGovernanceHistory.create({
          data: {
            providerId: provider.id,
            domain: "CREDENTIAL",
            targetId: promoted.id,
            fromStatus: existing?.status ?? null,
            toStatus: "VALID",
            reason: "Verified during onboarding approval.",
            actorId: principal.accountId,
            metadata: { onboardingCredentialId: credential.id, credentialType: credential.type },
          },
        });
      }

      await tx.provider.update({ where: { id: provider.id }, data: { status: "ACTIVE" } });
      await tx.providerGovernanceHistory.create({
        data: {
          providerId: provider.id,
          domain: "PROVIDER",
          targetId: provider.id,
          fromStatus: provider.status,
          toStatus: "ACTIVE",
          reason: "Provider onboarding approved.",
          actorId: principal.accountId,
        },
      });
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
    await this.prisma.$transaction(async (tx) => {
      await tx.provider.update({ where: { id: provider.id }, data: { status: "SUSPENDED" } });
      if (provider.status !== "SUSPENDED") {
        await tx.providerGovernanceHistory.create({
          data: {
            providerId: provider.id,
            domain: "PROVIDER",
            targetId: provider.id,
            fromStatus: provider.status,
            toStatus: "SUSPENDED",
            reason: "Provider suspended by governance reviewer.",
            actorId: principal.accountId,
          },
        });
      }
    });
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
