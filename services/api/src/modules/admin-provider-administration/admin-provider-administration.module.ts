import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { DocumentsModule } from "../documents/documents.module";
import { DocumentStorageService } from "../documents/document-storage.service";
import { DocumentsEnvelopeService } from "../documents/documents-envelope.service";
import { DocumentMalwareScannerService } from "../documents/document-malware-scanner.service";
import { jsonStringArray } from "../../security/provider-credential-validity";

const DAY_MS = 86_400_000;
const DEFAULT_WARNING_DAYS = [90, 60, 30, 7];
const ACCOUNT_STATUSES = new Set(["ACTIVE", "SUSPENDED", "ARCHIVED"]);
const PROVIDER_STATUSES = new Set(["DRAFT", "PENDING_REVIEW", "ACTIVE", "SUSPENDED", "REJECTED"]);
const CREDENTIAL_BASE_STATUSES = new Set(["PENDING", "VALID", "REJECTED", "REVOKED"]);

type ProfilePatch = { displayName?: string; legalName?: string | null; contactPhone?: string | null };
type StatusPatch = { status?: string; reason?: string };
type CredentialInput = {
  type?: string;
  issuer?: string | null;
  number?: string | null;
  validFrom?: string | null;
  validUntil?: string | null;
  status?: string;
  note?: string;
};
type CredentialDocumentInput = { fileName?: string; mediaType?: string; contentBase64?: string };

@Injectable()
class AdminProviderAdministrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly documentStorage: DocumentStorageService,
    private readonly documentEnvelope: DocumentsEnvelopeService,
    private readonly documentScanner: DocumentMalwareScannerService,
  ) {}

  async directory(principal: AuthPrincipal, providerClass?: string, query?: string, pageRaw?: string, pageSizeRaw?: string) {
    const normalizedClass = providerClass === "DOCTOR" || providerClass === "OTHER_PROVIDER" ? providerClass : undefined;
    const page = this.page(pageRaw);
    const pageSize = this.pageSize(pageSizeRaw);
    const needle = query?.trim() ?? "";
    if (needle.length > 120) throw new BadRequestException("q exceeds 120 characters.");
    const where: Prisma.ProviderWhereInput = {
      ...(normalizedClass ? { class: normalizedClass } : {}),
      ...(needle ? {
        OR: [
          { displayName: { contains: needle, mode: "insensitive" } },
          { legalName: { contains: needle, mode: "insensitive" } },
          { contactPhone: { contains: needle, mode: "insensitive" } },
          { user: { email: { contains: needle, mode: "insensitive" } } },
          { doctorProfile: { licenseNumber: { contains: needle, mode: "insensitive" } } },
          { otherProviderProfile: { category: { slug: { contains: needle, mode: "insensitive" } } } },
          { credentials: { some: {
            OR: [
              { type: { contains: needle, mode: "insensitive" } },
              { number: { contains: needle, mode: "insensitive" } },
              { issuer: { contains: needle, mode: "insensitive" } },
            ],
          } } },
        ],
      } : {}),
    };
    const [total, providers, warningDays] = await Promise.all([
      this.prisma.provider.count({ where }),
      this.prisma.provider.findMany({
        where,
        include: {
          user: { select: { id: true, email: true, status: true, createdAt: true, updatedAt: true } },
          doctorProfile: { include: { specialties: { include: { specialty: true } } } },
          otherProviderProfile: { include: { category: true } },
          credentials: { orderBy: { createdAt: "desc" }, include: { documents: { select: { id: true } }, verifications: { orderBy: { createdAt: "desc" }, take: 1 } } },
        },
        orderBy: [{ displayName: "asc" }, { createdAt: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.warningDays(),
    ]);
    const items = providers.map((provider) => this.presentProvider(provider, warningDays));
    await this.audit.write({
      actorId: principal.accountId,
      action: "ADMIN_PROVIDER_DIRECTORY_READ",
      objectType: "PROVIDER_DIRECTORY",
      objectId: normalizedClass ?? "ALL",
      purpose: "PROVIDER_ADMINISTRATION",
      result: "SUCCESS",
      metadata: { providerClass: normalizedClass ?? "ALL", resultCount: items.length, total, queryApplied: Boolean(needle), page, pageSize },
    });
    return { generatedAt: new Date().toISOString(), warningDays, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)), items };
  }


  async detail(principal: AuthPrincipal, providerId: string) {
    const provider = await this.requireProvider(providerId, true);
    const warningDays = await this.warningDays();
    await this.audit.write({
      actorId: principal.accountId,
      action: "ADMIN_PROVIDER_DETAIL_READ",
      objectType: "PROVIDER",
      objectId: provider.id,
      purpose: "PROVIDER_ADMINISTRATION",
      result: "SUCCESS",
    });
    return this.presentProvider(provider, warningDays, true);
  }

  async updateProfile(principal: AuthPrincipal, providerId: string, body: ProfilePatch) {
    const provider = await this.requireProvider(providerId);
    const displayName = body.displayName?.trim();
    if (body.displayName !== undefined && !displayName) throw new BadRequestException("displayName cannot be empty.");
    const updated = await this.prisma.provider.update({
      where: { id: providerId },
      data: {
        ...(displayName ? { displayName } : {}),
        ...(body.legalName !== undefined ? { legalName: this.optional(body.legalName) } : {}),
        ...(body.contactPhone !== undefined ? { contactPhone: this.optional(body.contactPhone) } : {}),
      },
    });
    await this.audit.write({
      actorId: principal.accountId,
      action: "ADMIN_PROVIDER_PROFILE_UPDATED",
      objectType: "PROVIDER",
      objectId: providerId,
      purpose: "PROVIDER_ADMINISTRATION",
      result: "SUCCESS",
      metadata: { providerClass: provider.class },
    });
    return updated;
  }

  async updateAccountStatus(principal: AuthPrincipal, providerId: string, body: StatusPatch) {
    const provider = await this.requireProvider(providerId);
    if (!provider.userId) throw new BadRequestException("Provider is not linked to an account.");
    const status = this.requiredStatus(body.status, ACCOUNT_STATUSES, "account");
    const reason = this.requiredReason(body.reason);
    const user = await this.prisma.user.findUnique({ where: { id: provider.userId } });
    if (!user) throw new NotFoundException("Provider account not found.");
    if (user.status === status) return { providerId, accountId: user.id, status };

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { status: status as "ACTIVE" | "SUSPENDED" | "ARCHIVED" } });
      await tx.providerGovernanceHistory.create({
        data: { providerId, domain: "ACCOUNT", targetId: user.id, fromStatus: user.status, toStatus: status, reason, actorId: principal.accountId },
      });
    });
    await this.audit.write({
      actorId: principal.accountId,
      action: "ADMIN_PROVIDER_ACCOUNT_STATUS_CHANGED",
      objectType: "USER",
      objectId: user.id,
      purpose: "PROVIDER_ADMINISTRATION",
      result: "SUCCESS",
      metadata: { providerId, fromStatus: user.status, toStatus: status, reason },
    });
    return { providerId, accountId: user.id, status };
  }

  async updateProviderStatus(principal: AuthPrincipal, providerId: string, body: StatusPatch) {
    const provider = await this.requireProvider(providerId);
    const status = this.requiredStatus(body.status, PROVIDER_STATUSES, "provider");
    const reason = this.requiredReason(body.reason);
    if (provider.status === status) return { id: provider.id, status };

    await this.prisma.$transaction(async (tx) => {
      await tx.provider.update({ where: { id: providerId }, data: { status: status as any } });
      await tx.providerGovernanceHistory.create({
        data: { providerId, domain: "PROVIDER", targetId: providerId, fromStatus: provider.status, toStatus: status, reason, actorId: principal.accountId },
      });
    });
    await this.audit.write({
      actorId: principal.accountId,
      action: "ADMIN_PROVIDER_STATUS_CHANGED",
      objectType: "PROVIDER",
      objectId: providerId,
      purpose: "PROVIDER_ADMINISTRATION",
      result: "SUCCESS",
      metadata: { fromStatus: provider.status, toStatus: status, reason },
    });
    return { id: provider.id, status };
  }

  async addCredential(principal: AuthPrincipal, providerId: string, body: CredentialInput) {
    await this.requireProvider(providerId);
    const type = body.type?.trim().toLowerCase();
    if (!type) throw new BadRequestException("Credential type is required.");
    const status = body.status ? this.requiredStatus(body.status, CREDENTIAL_BASE_STATUSES, "credential") : "PENDING";
    const created = await this.prisma.providerCredential.create({
      data: {
        providerId,
        type,
        issuer: this.optional(body.issuer),
        number: this.optional(body.number),
        validFrom: this.date(body.validFrom, "validFrom"),
        validUntil: this.date(body.validUntil, "validUntil"),
        status,
        verifications: {
          create: { status, note: this.optional(body.note), actorId: principal.accountId },
        },
      },
      include: { documents: true, verifications: { orderBy: { createdAt: "desc" } } },
    });
    await this.prisma.providerGovernanceHistory.create({
      data: { providerId, domain: "CREDENTIAL", targetId: created.id, fromStatus: null, toStatus: status, reason: this.optional(body.note), actorId: principal.accountId, metadata: { credentialType: type } as Prisma.InputJsonValue },
    });
    await this.audit.write({
      actorId: principal.accountId,
      action: "ADMIN_PROVIDER_CREDENTIAL_CREATED",
      objectType: "PROVIDER_CREDENTIAL",
      objectId: created.id,
      purpose: "PROVIDER_ADMINISTRATION",
      result: "SUCCESS",
      metadata: { providerId, type, status },
    });
    return created;
  }

  async renewCredential(principal: AuthPrincipal, providerId: string, credentialId: string, body: CredentialInput) {
    const previous = await this.requireCredential(providerId, credentialId);
    const type = body.type?.trim().toLowerCase() || previous.type;
    const created = await this.prisma.providerCredential.create({
      data: {
        providerId,
        type,
        issuer: body.issuer !== undefined ? this.optional(body.issuer) : previous.issuer,
        number: body.number !== undefined ? this.optional(body.number) : previous.number,
        validFrom: body.validFrom !== undefined ? this.date(body.validFrom, "validFrom") : new Date(),
        validUntil: this.date(body.validUntil, "validUntil"),
        status: "PENDING",
        renewedFromCredentialId: previous.id,
        verifications: { create: { status: "PENDING", note: this.optional(body.note) ?? "License renewal created.", actorId: principal.accountId } },
      },
      include: { documents: true, verifications: true },
    });
    await this.prisma.providerGovernanceHistory.create({
      data: { providerId, domain: "CREDENTIAL_RENEWAL", targetId: created.id, fromStatus: previous.status, toStatus: "PENDING", reason: this.optional(body.note), actorId: principal.accountId, metadata: { renewedFromCredentialId: previous.id, credentialType: type } as Prisma.InputJsonValue },
    });
    await this.audit.write({
      actorId: principal.accountId,
      action: "ADMIN_PROVIDER_CREDENTIAL_RENEWAL_CREATED",
      objectType: "PROVIDER_CREDENTIAL",
      objectId: created.id,
      purpose: "PROVIDER_ADMINISTRATION",
      result: "SUCCESS",
      metadata: { providerId, renewedFromCredentialId: previous.id, type },
    });
    return created;
  }

  async updateCredentialStatus(principal: AuthPrincipal, providerId: string, credentialId: string, body: StatusPatch) {
    const credential = await this.requireCredential(providerId, credentialId);
    const status = this.requiredStatus(body.status, CREDENTIAL_BASE_STATUSES, "credential");
    const reason = this.requiredReason(body.reason);
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.providerCredential.update({ where: { id: credentialId }, data: { status } });
      await tx.providerCredentialVerification.create({ data: { credentialId, status, note: reason, actorId: principal.accountId } });
      await tx.providerGovernanceHistory.create({
        data: { providerId, domain: "CREDENTIAL", targetId: credentialId, fromStatus: credential.status, toStatus: status, reason, actorId: principal.accountId, metadata: { credentialType: credential.type } as Prisma.InputJsonValue },
      });
      return row;
    });
    await this.audit.write({
      actorId: principal.accountId,
      action: "ADMIN_PROVIDER_CREDENTIAL_STATUS_CHANGED",
      objectType: "PROVIDER_CREDENTIAL",
      objectId: credentialId,
      purpose: "PROVIDER_ADMINISTRATION",
      result: "SUCCESS",
      metadata: { providerId, fromStatus: credential.status, toStatus: status, reason },
    });
    return updated;
  }

  async uploadCredentialDocument(principal: AuthPrincipal, providerId: string, credentialId: string, input: CredentialDocumentInput) {
    const credential = await this.requireCredential(providerId, credentialId, true);
    if ((credential.documents?.length ?? 0) >= 10) throw new BadRequestException("A credential can contain at most 10 PDF documents.");
    const fileName = input.fileName?.trim();
    if (!fileName || fileName.length > 180 || !fileName.toLowerCase().endsWith(".pdf")) {
      throw new BadRequestException("Credential document fileName must be a PDF name up to 180 characters.");
    }
    const mediaType = input.mediaType?.trim().toLowerCase() || "application/pdf";
    if (mediaType !== "application/pdf") throw new BadRequestException("Credential documents must use application/pdf.");
    const compact = input.contentBase64?.replace(/\s+/g, "") ?? "";
    if (!compact || compact.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) {
      throw new BadRequestException("Credential document contentBase64 must be valid base64.");
    }
    const bytes = Uint8Array.from(Buffer.from(compact, "base64"));
    const scan = await this.documentScanner.assertClean(bytes, mediaType);
    const encrypted = await this.documentEnvelope.encryptBytes(bytes);
    const objectKey = `credentialing/providers/${providerId}/${credentialId}/${randomUUID()}.cpenc`;
    await this.documentStorage.put(objectKey, encrypted.ciphertext);
    try {
      const document = await this.prisma.providerCredentialDocument.create({
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
      });
      await this.audit.write({
        actorId: principal.accountId,
        action: "ADMIN_PROVIDER_CREDENTIAL_DOCUMENT_UPLOADED",
        objectType: "PROVIDER_CREDENTIAL_DOCUMENT",
        objectId: document.id,
        purpose: "PROVIDER_ADMINISTRATION",
        result: "SUCCESS",
        metadata: { providerId, credentialId, fileName, byteLength: bytes.byteLength },
      });
      return document;
    } catch (error) {
      await this.documentStorage.remove(objectKey).catch(() => undefined);
      throw error;
    }
  }

  async credentialDocumentContent(principal: AuthPrincipal, providerId: string, credentialId: string, documentId: string) {
    await this.requireCredential(providerId, credentialId);
    const document = await this.prisma.providerCredentialDocument.findFirst({ where: { id: documentId, credentialId } });
    if (!document) throw new NotFoundException("Credential document not found.");
    const ciphertext = await this.documentStorage.get(document.objectKey);
    const bytes = await this.documentEnvelope.decryptBytes({
      version: 1,
      algorithm: "AES-256-GCM",
      keyId: document.blobKeyId,
      wrappedKey: document.blobWrappedKey,
      iv: document.blobIv,
      ciphertext,
    });
    await this.audit.write({
      actorId: principal.accountId,
      action: "ADMIN_PROVIDER_CREDENTIAL_DOCUMENT_READ",
      objectType: "PROVIDER_CREDENTIAL_DOCUMENT",
      objectId: document.id,
      purpose: "PROVIDER_ADMINISTRATION",
      result: "SUCCESS",
      metadata: { providerId, credentialId },
    });
    return { ...document, contentBase64: Buffer.from(bytes).toString("base64") };
  }

  async deleteCredentialDocument(principal: AuthPrincipal, providerId: string, credentialId: string, documentId: string) {
    await this.requireCredential(providerId, credentialId);
    const document = await this.prisma.providerCredentialDocument.findFirst({
      where: { id: documentId, credentialId },
    });
    if (!document) throw new NotFoundException("Credential document not found.");

    const sourceDocument = document.sourceOnboardingDocumentId
      ? await this.prisma.onboardingCredentialDocument.findUnique({ where: { id: document.sourceOnboardingDocumentId } })
      : await this.prisma.onboardingCredentialDocument.findUnique({ where: { objectKey: document.objectKey } });

    await this.prisma.providerCredentialDocument.delete({ where: { id: document.id } });
    if (!sourceDocument) {
      await this.documentStorage.remove(document.objectKey).catch(() => undefined);
    }

    await this.audit.write({
      actorId: principal.accountId,
      action: "ADMIN_PROVIDER_CREDENTIAL_DOCUMENT_DELETED",
      objectType: "PROVIDER_CREDENTIAL_DOCUMENT",
      objectId: document.id,
      purpose: "PROVIDER_ADMINISTRATION",
      result: "SUCCESS",
      metadata: {
        providerId,
        credentialId,
        fileName: document.fileName,
        archivedOnboardingEvidenceRetained: Boolean(sourceDocument),
      },
    });
    return { id: document.id, deleted: true, archivedOnboardingEvidenceRetained: Boolean(sourceDocument) };
  }

  private async requireProvider(providerId: string, full = false): Promise<any> {
    const provider = await this.prisma.provider.findUnique({
      where: { id: providerId },
      include: {
        user: { select: { id: true, email: true, status: true, createdAt: true, updatedAt: true } },
        doctorProfile: { include: { specialties: { include: { specialty: true } } } },
        otherProviderProfile: { include: { category: true } },
        credentials: {
          orderBy: { createdAt: "desc" },
          include: {
            documents: full ? { orderBy: { createdAt: "asc" } } : { select: { id: true } },
            verifications: { orderBy: { createdAt: "desc" }, ...(full ? {} : { take: 1 }) },
          },
        },
        ...(full ? { governanceHistory: { orderBy: { createdAt: "desc" }, take: 200 } } : {}),
      },
    });
    if (!provider) throw new NotFoundException("Provider not found.");
    return provider;
  }

  private async requireCredential(providerId: string, credentialId: string, full = false): Promise<any> {
    const credential = await this.prisma.providerCredential.findFirst({
      where: { id: credentialId, providerId },
      ...(full ? { include: { documents: { orderBy: { createdAt: "asc" as const } }, verifications: { orderBy: { createdAt: "desc" as const } } } } : {}),
    });
    if (!credential) throw new NotFoundException("Provider credential not found.");
    return credential;
  }

  private async warningDays(): Promise<number[]> {
    const policy = await this.prisma.credentialExpiryPolicy.findUnique({ where: { code: "GLOBAL" }, select: { warningDays: true } });
    const values = Array.isArray(policy?.warningDays)
      ? policy!.warningDays.filter((value): value is number => Number.isInteger(value) && Number(value) > 0).map(Number)
      : [];
    return values.length ? values.sort((a, b) => b - a) : [...DEFAULT_WARNING_DAYS];
  }

  private presentProvider(provider: any, warningDays: number[], detailed = false) {
    const now = new Date();
    const credentials = (provider.credentials ?? []).map((credential: any) => ({
      ...credential,
      effectiveStatus: this.effectiveCredentialStatus(credential, warningDays, now),
      daysRemaining: credential.validUntil ? Math.floor((new Date(credential.validUntil).getTime() - now.getTime()) / DAY_MS) : null,
      documentCount: Array.isArray(credential.documents) ? credential.documents.length : 0,
    }));
    const requiredTypes = provider.class === "DOCTOR"
      ? ["medical-license"]
      : provider.otherProviderProfile?.category?.active
        ? jsonStringArray(provider.otherProviderProfile.category.requiredCredentialTypes)
        : [];
    const currentTypes = new Set(credentials
      .filter((credential: any) => credential.effectiveStatus === "VALID" || credential.effectiveStatus === "EXPIRING_SOON")
      .map((credential: any) => credential.type.trim().toLowerCase()));
    const missingRequiredCredentialTypes = requiredTypes.filter((type) => !currentTypes.has(type));
    const accountStatus = provider.user?.status ?? "UNLINKED";
    const operationallyBlocked = accountStatus !== "ACTIVE" || provider.status !== "ACTIVE" || missingRequiredCredentialTypes.length > 0;
    return {
      ...provider,
      credentials,
      governanceHistory: detailed ? provider.governanceHistory ?? [] : undefined,
      requiredCredentialTypes: requiredTypes,
      missingRequiredCredentialTypes,
      operationallyBlocked,
      operationalBlockReasons: [
        ...(accountStatus !== "ACTIVE" ? ["ACCOUNT_NOT_ACTIVE"] : []),
        ...(provider.status !== "ACTIVE" ? ["PROVIDER_NOT_ACTIVE"] : []),
        ...(missingRequiredCredentialTypes.length ? ["REQUIRED_CREDENTIAL_NOT_CURRENT"] : []),
      ],
    };
  }

  private effectiveCredentialStatus(credential: any, warningDays: number[], now: Date): string {
    const stored = String(credential.status ?? "").toUpperCase();
    if (stored === "REJECTED" || stored === "REVOKED" || stored === "PENDING") return stored;
    if (stored !== "VALID" && stored !== "VERIFIED") return stored || "PENDING";
    const validFrom = credential.validFrom ? new Date(credential.validFrom) : null;
    const validUntil = credential.validUntil ? new Date(credential.validUntil) : null;
    if (validFrom && validFrom.getTime() > now.getTime()) return "PENDING";
    if (validUntil && validUntil.getTime() <= now.getTime()) return "EXPIRED";
    const maxWindow = Math.max(...warningDays);
    if (validUntil && Math.ceil((validUntil.getTime() - now.getTime()) / DAY_MS) <= maxWindow) return "EXPIRING_SOON";
    return "VALID";
  }

  private page(value?: string): number {
    if (!value) return 1;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1_000_000) throw new BadRequestException("page must be a positive integer.");
    return parsed;
  }

  private pageSize(value?: string): number {
    if (!value) return 10;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || ![10, 25, 50, 100].includes(parsed)) throw new BadRequestException("pageSize must be one of 10, 25, 50 or 100.");
    return parsed;
  }

  private requiredStatus(value: string | undefined, allowed: Set<string>, domain: string): string {
    const normalized = value?.trim().toUpperCase() ?? "";
    if (!allowed.has(normalized)) throw new BadRequestException(`Invalid ${domain} status.`);
    return normalized;
  }

  private requiredReason(value: string | undefined): string {
    const reason = value?.trim() ?? "";
    if (reason.length < 3) throw new BadRequestException("A reason of at least 3 characters is required.");
    if (reason.length > 1000) throw new BadRequestException("Reason is too long.");
    return reason;
  }

  private optional(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const cleaned = value.trim();
    return cleaned || null;
  }

  private date(value: unknown, name: string): Date | null {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string") throw new BadRequestException(`${name} must be an ISO date.`);
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new BadRequestException(`${name} must be an ISO date.`);
    return date;
  }
}

@Controller("admin/provider-administration")
@RequirePermissions("PROVIDER_REVIEW")
class AdminProviderAdministrationController {
  constructor(private readonly providers: AdminProviderAdministrationService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  directory(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Query("class") providerClass?: string,
    @Query("q") query?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    return this.providers.directory(principal, providerClass, query, page, pageSize);
  }

  @Get(":providerId")
  @Header("Cache-Control", "no-store")
  detail(@CurrentPrincipal() principal: AuthPrincipal, @Param("providerId") providerId: string) {
    return this.providers.detail(principal, providerId);
  }

  @Patch(":providerId/profile")
  updateProfile(@CurrentPrincipal() principal: AuthPrincipal, @Param("providerId") providerId: string, @Body() body: ProfilePatch) {
    return this.providers.updateProfile(principal, providerId, body ?? {});
  }

  @Patch(":providerId/account-status")
  accountStatus(@CurrentPrincipal() principal: AuthPrincipal, @Param("providerId") providerId: string, @Body() body: StatusPatch) {
    return this.providers.updateAccountStatus(principal, providerId, body ?? {});
  }

  @Patch(":providerId/provider-status")
  providerStatus(@CurrentPrincipal() principal: AuthPrincipal, @Param("providerId") providerId: string, @Body() body: StatusPatch) {
    return this.providers.updateProviderStatus(principal, providerId, body ?? {});
  }

  @Post(":providerId/credentials")
  addCredential(@CurrentPrincipal() principal: AuthPrincipal, @Param("providerId") providerId: string, @Body() body: CredentialInput) {
    return this.providers.addCredential(principal, providerId, body ?? {});
  }

  @Post(":providerId/credentials/:credentialId/renew")
  renewCredential(@CurrentPrincipal() principal: AuthPrincipal, @Param("providerId") providerId: string, @Param("credentialId") credentialId: string, @Body() body: CredentialInput) {
    return this.providers.renewCredential(principal, providerId, credentialId, body ?? {});
  }

  @Patch(":providerId/credentials/:credentialId/status")
  credentialStatus(@CurrentPrincipal() principal: AuthPrincipal, @Param("providerId") providerId: string, @Param("credentialId") credentialId: string, @Body() body: StatusPatch) {
    return this.providers.updateCredentialStatus(principal, providerId, credentialId, body ?? {});
  }

  @Post(":providerId/credentials/:credentialId/documents")
  uploadCredentialDocument(@CurrentPrincipal() principal: AuthPrincipal, @Param("providerId") providerId: string, @Param("credentialId") credentialId: string, @Body() body: CredentialDocumentInput) {
    return this.providers.uploadCredentialDocument(principal, providerId, credentialId, body ?? {});
  }

  @Delete(":providerId/credentials/:credentialId/documents/:documentId")
  deleteCredentialDocument(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("providerId") providerId: string,
    @Param("credentialId") credentialId: string,
    @Param("documentId") documentId: string,
  ) {
    return this.providers.deleteCredentialDocument(principal, providerId, credentialId, documentId);
  }

  @Get(":providerId/credentials/:credentialId/documents/:documentId/content")
  @Header("Cache-Control", "no-store")
  credentialDocumentContent(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("providerId") providerId: string,
    @Param("credentialId") credentialId: string,
    @Param("documentId") documentId: string,
  ) {
    return this.providers.credentialDocumentContent(principal, providerId, credentialId, documentId);
  }
}

@Module({
  imports: [DocumentsModule],
  controllers: [AdminProviderAdministrationController],
  providers: [AdminProviderAdministrationService],
})
export class AdminProviderAdministrationModule {}
