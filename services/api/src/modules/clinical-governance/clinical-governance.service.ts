import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  Permissions,
  roleHasPermission,
  type AuthPrincipal,
  type IdentityRole,
} from "@carepoint/identity";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { sanitizeClinicalAuditMetadata } from "../../infrastructure/audit/clinical-audit-metadata";
import { parseProviderCategoryCapabilities } from "../providers/provider-category-capabilities";
import {
  ClinicalConsentPolicies,
  normalizeTemporaryShareExpiry,
  normalizeTemporaryShareScopes,
} from "./clinical-consent-policy";
import {
  ConsentPolicyGovernanceService,
  RUNTIME_CONSENT_JURISDICTION,
} from "./consent-policy-governance.service";

const ROLES: readonly IdentityRole[] = ["PATIENT", "DOCTOR", "OTHER_PROVIDER", "ADMIN", "SUPPORT"];
const MAX_AUDIT_CANDIDATES = 500;

export interface CreateTemporaryClinicalShareInput {
  providerId: string;
  scopes: string[];
  expiresAt: string;
}

export interface ClinicalProvenanceQuery {
  patientId: string;
  domain?: string;
  limit?: number;
}

export interface ClinicalAuditQuery {
  actorId?: string;
  objectType?: string;
  objectId?: string;
  action?: string;
  purpose?: string;
  result?: string;
  patientId?: string;
  providerId?: string;
  from?: string;
  to?: string;
  limit?: number;
}

@Injectable()
export class ClinicalGovernanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly consentPolicies: ConsentPolicyGovernanceService,
  ) {}

  policies() {
    return {
      purposeModel: ["TREATMENT"],
      policies: ClinicalConsentPolicies,
      temporaryShareMaximumMinutes: 24 * 60,
    };
  }

  async accessMatrix() {
    const categories = await this.prisma.providerCategory.findMany({
      where: { active: true },
      select: {
        id: true,
        slug: true,
        family: true,
        capabilities: true,
      },
      orderBy: { slug: "asc" },
    });
    return {
      roles: ROLES.map((role) => ({
        role,
        permissions: Permissions.filter((permission) => roleHasPermission(role, permission)),
      })),
      clinicalConsentPolicies: ClinicalConsentPolicies,
      otherProviderCategories: categories.map((category) => ({
        id: category.id,
        slug: category.slug,
        family: category.family,
        capabilities: parseProviderCategoryCapabilities(category.capabilities),
      })),
      invariants: {
        consentDoesNotBypassRole: true,
        consentDoesNotBypassCategoryCapability: true,
        consentDoesNotBypassTreatmentContext: true,
        adminHasNoImplicitPatientClinicalRead: true,
      },
    };
  }

  async createTemporaryShare(
    principal: AuthPrincipal,
    input: CreateTemporaryClinicalShareInput,
  ) {
    const patient = await this.requirePatient(principal);
    const providerId = this.requiredId(input?.providerId, "providerId");
    const provider = await this.prisma.provider.findUnique({
      where: { id: providerId },
      select: { id: true, displayName: true, status: true, class: true },
    });
    if (!provider || provider.status !== "ACTIVE") {
      throw new BadRequestException("Temporary share target provider must be active.");
    }
    const scopes = normalizeTemporaryShareScopes(input?.scopes);
    const expiresAt = normalizeTemporaryShareExpiry(input?.expiresAt);
    const governedScopes = await Promise.all(scopes.map((item) => this.consentPolicies.validateGrant({
      scope: item.scope,
      version: item.version,
      purpose: "TREATMENT",
      providerRole: provider.class,
      expiresAt,
      jurisdiction: RUNTIME_CONSENT_JURISDICTION,
      temporaryShare: true,
    })));

    const created = await this.prisma.$transaction(async (tx) => {
      const consentIds: string[] = [];
      for (const item of governedScopes) {
        const consent = await tx.consent.create({
          data: {
            patientId: patient.id,
            providerId: provider.id,
            scope: item.scope,
            version: item.version,
            purpose: "TREATMENT",
            state: "GRANTED",
            expiresAt,
            policyVersionId: item.policyVersionId,
            policyJurisdiction: item.policyJurisdiction,
          },
        });
        consentIds.push(consent.id);
      }
      const share = await tx.temporaryClinicalShare.create({
        data: {
          patientId: patient.id,
          providerId: provider.id,
          scopes: governedScopes.map((item) => item.scope) as unknown as Prisma.InputJsonValue,
          consentIds: consentIds as unknown as Prisma.InputJsonValue,
          purpose: "TREATMENT",
          expiresAt,
          createdByActorId: principal.accountId,
        },
      });
      await this.audit.writeClinicalInTransaction(tx, {
        actorId: principal.accountId,
        action: "TEMPORARY_CLINICAL_SHARE_CREATED",
        objectType: "TEMPORARY_CLINICAL_SHARE",
        objectId: share.id,
        purpose: "TREATMENT",
        result: "SUCCESS",
        metadata: {
          domain: "TEMPORARY_CLINICAL_SHARE",
          shareId: share.id,
          patientId: patient.id,
          providerId: provider.id,
          itemCount: governedScopes.length,
          policyVersionIds: governedScopes.map((item) => item.policyVersionId).filter(Boolean),
          decision: "ALLOW",
        },
      });
      return share;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return {
      id: created.id,
      providerId: provider.id,
      providerName: provider.displayName,
      providerClass: provider.class,
      scopes: created.scopes,
      purpose: created.purpose,
      expiresAt: created.expiresAt,
      revokedAt: created.revokedAt,
      state: "ACTIVE",
      createdAt: created.createdAt,
    };
  }

  async listTemporaryShares(principal: AuthPrincipal) {
    const patient = await this.requirePatient(principal);
    const rows = await this.prisma.temporaryClinicalShare.findMany({
      where: { patientId: patient.id },
      include: { provider: { select: { displayName: true, status: true, class: true } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    const now = Date.now();
    return {
      patientId: patient.id,
      items: rows.map((row) => ({
        id: row.id,
        providerId: row.providerId,
        providerName: row.provider.displayName,
        providerClass: row.provider.class,
        providerStatus: row.provider.status,
        scopes: row.scopes,
        purpose: row.purpose,
        expiresAt: row.expiresAt,
        revokedAt: row.revokedAt,
        state: row.revokedAt
          ? "REVOKED"
          : row.expiresAt.getTime() <= now
            ? "EXPIRED"
            : "ACTIVE",
        createdAt: row.createdAt,
      })),
    };
  }

  async revokeTemporaryShare(principal: AuthPrincipal, shareId: string) {
    const patient = await this.requirePatient(principal);
    const id = this.requiredId(shareId, "shareId");
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "TemporaryClinicalShare" WHERE id = ${id} FOR UPDATE`);
      const share = await tx.temporaryClinicalShare.findUnique({ where: { id } });
      if (!share) throw new NotFoundException("Temporary clinical share not found.");
      if (share.patientId !== patient.id) throw new ForbiddenException("Temporary clinical share access denied.");
      if (share.revokedAt) return share;

      const consentIds = this.jsonStringArray(share.consentIds);
      const now = new Date();
      if (consentIds.length > 0) {
        await tx.consent.updateMany({
          where: {
            id: { in: consentIds },
            patientId: patient.id,
            state: "GRANTED",
          },
          data: { state: "REVOKED", revokedAt: now },
        });
      }
      const revoked = await tx.temporaryClinicalShare.update({
        where: { id },
        data: { revokedAt: now },
      });
      await this.audit.writeClinicalInTransaction(tx, {
        actorId: principal.accountId,
        action: "TEMPORARY_CLINICAL_SHARE_REVOKED",
        objectType: "TEMPORARY_CLINICAL_SHARE",
        objectId: revoked.id,
        purpose: "TREATMENT",
        result: "SUCCESS",
        metadata: {
          domain: "TEMPORARY_CLINICAL_SHARE",
          shareId: revoked.id,
          patientId: patient.id,
          providerId: revoked.providerId,
          itemCount: consentIds.length,
          decision: "ALLOW",
        },
      });
      return revoked;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return {
      id: result.id,
      providerId: result.providerId,
      scopes: result.scopes,
      purpose: result.purpose,
      expiresAt: result.expiresAt,
      revokedAt: result.revokedAt,
      state: "REVOKED",
      createdAt: result.createdAt,
    };
  }


  async provenanceExplorer(principal: AuthPrincipal, input: ClinicalProvenanceQuery) {
    const patientId = this.requiredId(input?.patientId, "patientId");
    const domain = this.provenanceDomain(input?.domain);
    const limit = this.limit(input?.limit);
    const patient = await this.prisma.patientProfile.findUnique({
      where: { id: patientId },
      select: { id: true },
    });
    if (!patient) throw new NotFoundException("Patient not found.");

    const [profileRows, observationRows, questionnaireRows] = await Promise.all([
      domain === "ALL" || domain === "CLINICAL_PROFILE"
        ? this.prisma.clinicalProfileEntry.findMany({
            where: { patientId },
            select: {
              id: true,
              kind: true,
              status: true,
              version: true,
              verificationStatus: true,
              sourceType: true,
              sourceActorId: true,
              verifiedByActorId: true,
              verifiedAt: true,
              createdAt: true,
              updatedAt: true,
            },
            orderBy: { updatedAt: "desc" },
            take: limit,
          })
        : Promise.resolve([]),
      domain === "ALL" || domain === "OBSERVATION"
        ? this.prisma.observation.findMany({
            where: { patientId },
            select: {
              id: true,
              observedAt: true,
              sourceType: true,
              sourceId: true,
              createdByActorId: true,
              createdAt: true,
              observationType: { select: { code: true } },
              observationTypeVersion: { select: { version: true } },
              _count: { select: { contextRevisions: true, correctionRevisions: true } },
            },
            orderBy: { createdAt: "desc" },
            take: limit,
          })
        : Promise.resolve([]),
      domain === "ALL" || domain === "QUESTIONNAIRE"
        ? this.prisma.questionnaireResponse.findMany({
            where: { patientId },
            select: {
              id: true,
              sequence: true,
              completedAt: true,
              sourceType: true,
              sourceActorId: true,
              createdAt: true,
              questionnaire: { select: { code: true } },
              questionnaireVersion: { select: { version: true } },
            },
            orderBy: { createdAt: "desc" },
            take: limit,
          })
        : Promise.resolve([]),
    ]);

    const items = [
      ...profileRows.map((row) => ({
        id: row.id,
        patientId,
        domain: "CLINICAL_PROFILE" as const,
        resourceType: "CLINICAL_PROFILE_ENTRY",
        resourceCode: row.kind,
        resourceStatus: row.status,
        resourceVersion: row.version,
        schemaVersion: null,
        sourceType: row.sourceType,
        sourceId: null,
        sourceActorId: row.sourceActorId,
        verificationStatus: row.verificationStatus,
        verifiedByActorId: row.verifiedByActorId,
        verifiedAt: row.verifiedAt,
        revisionCount: row.version,
        effectiveAt: null,
        recordedAt: row.createdAt,
        updatedAt: row.updatedAt,
      })),
      ...observationRows.map((row) => ({
        id: row.id,
        patientId,
        domain: "OBSERVATION" as const,
        resourceType: "OBSERVATION",
        resourceCode: row.observationType.code,
        resourceStatus: null,
        resourceVersion: 1 + row._count.correctionRevisions,
        schemaVersion: row.observationTypeVersion.version,
        sourceType: row.sourceType,
        sourceId: row.sourceId,
        sourceActorId: row.createdByActorId,
        verificationStatus: null,
        verifiedByActorId: null,
        verifiedAt: null,
        revisionCount: 1 + row._count.contextRevisions + row._count.correctionRevisions,
        effectiveAt: row.observedAt,
        recordedAt: row.createdAt,
        updatedAt: row.createdAt,
      })),
      ...questionnaireRows.map((row) => ({
        id: row.id,
        patientId,
        domain: "QUESTIONNAIRE" as const,
        resourceType: "QUESTIONNAIRE_RESPONSE",
        resourceCode: row.questionnaire.code,
        resourceStatus: null,
        resourceVersion: row.sequence,
        schemaVersion: row.questionnaireVersion.version,
        sourceType: row.sourceType,
        sourceId: null,
        sourceActorId: row.sourceActorId,
        verificationStatus: null,
        verifiedByActorId: null,
        verifiedAt: null,
        revisionCount: row.sequence,
        effectiveAt: row.completedAt,
        recordedAt: row.createdAt,
        updatedAt: row.createdAt,
      })),
    ]
      .sort((left, right) => right.recordedAt.getTime() - left.recordedAt.getTime())
      .slice(0, limit);

    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "ADMIN_CLINICAL_PROVENANCE_READ",
      objectType: "PATIENT",
      objectId: patientId,
      purpose: "ACCESS_GOVERNANCE",
      result: "SUCCESS",
      metadata: {
        domain: "CLINICAL_PROVENANCE",
        patientId,
        itemCount: items.length,
        decision: "ALLOW",
      },
    });

    return {
      patientId,
      domain,
      limit,
      contentIncluded: false,
      immutableReadOnly: true,
      items,
    };
  }

  async auditExplorer(input: ClinicalAuditQuery) {
    const limit = this.limit(input.limit);
    const occurredAt = this.dateFilter(input.from, input.to);
    const where: Prisma.AuditEventWhereInput = {
      ...(input.actorId?.trim() ? { actorId: input.actorId.trim() } : {}),
      ...(input.objectType?.trim() ? { objectType: input.objectType.trim().toUpperCase() } : {}),
      ...(input.objectId?.trim() ? { objectId: input.objectId.trim() } : {}),
      ...(input.action?.trim() ? { action: input.action.trim().toUpperCase() } : {}),
      ...(input.purpose?.trim() ? { purpose: input.purpose.trim().toUpperCase() } : {}),
      ...(input.result?.trim() ? { result: input.result.trim().toUpperCase() } : {}),
      ...(occurredAt ? { occurredAt } : {}),
    };
    const rows = await this.prisma.auditEvent.findMany({
      where,
      orderBy: { occurredAt: "desc" },
      take: MAX_AUDIT_CANDIDATES,
    });
    const patientId = input.patientId?.trim();
    const providerId = input.providerId?.trim();
    const filtered = rows.filter((row) => {
      if (!patientId && !providerId) return true;
      const metadata = sanitizeClinicalAuditMetadata(this.object(row.metadata));
      if (patientId && metadata.patientId !== patientId) return false;
      if (providerId && metadata.providerId !== providerId) return false;
      return true;
    });
    return {
      limit,
      candidateLimit: MAX_AUDIT_CANDIDATES,
      items: filtered.slice(0, limit).map((row) => ({
        id: row.id,
        actorId: row.actorId,
        action: row.action,
        objectType: row.objectType,
        objectId: row.objectId,
        purpose: row.purpose,
        result: row.result,
        metadata: sanitizeClinicalAuditMetadata(this.object(row.metadata)),
        occurredAt: row.occurredAt,
      })),
    };
  }

  private async requirePatient(principal: AuthPrincipal) {
    if (principal.role !== "PATIENT") {
      throw new ForbiddenException("Patient clinical sharing requires PATIENT role.");
    }
    const patient = await this.prisma.patientProfile.findUnique({
      where: { userId: principal.accountId },
      select: { id: true },
    });
    if (!patient) throw new NotFoundException("Patient profile not found.");
    return patient;
  }

  private jsonStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === "string");
  }

  private requiredId(value: unknown, field: string): string {
    if (typeof value !== "string") throw new BadRequestException(`${field} is required.`);
    const normalized = value.trim();
    if (!/^[A-Za-z0-9_.:-]{1,180}$/.test(normalized)) {
      throw new BadRequestException(`${field} is invalid.`);
    }
    return normalized;
  }

  private provenanceDomain(value: unknown): "ALL" | "CLINICAL_PROFILE" | "OBSERVATION" | "QUESTIONNAIRE" {
    if (value == null || value === "") return "ALL";
    if (typeof value !== "string") throw new BadRequestException("domain is invalid.");
    const normalized = value.trim().toUpperCase();
    if (!["ALL", "CLINICAL_PROFILE", "OBSERVATION", "QUESTIONNAIRE"].includes(normalized)) {
      throw new BadRequestException("domain is invalid.");
    }
    return normalized as "ALL" | "CLINICAL_PROFILE" | "OBSERVATION" | "QUESTIONNAIRE";
  }

  private limit(value: unknown): number {
    const number = value == null ? 100 : Number(value);
    if (!Number.isInteger(number) || number < 1) return 100;
    return Math.min(number, 200);
  }

  private dateFilter(from?: string, to?: string): Prisma.DateTimeFilter | undefined {
    const filter: Prisma.DateTimeFilter = {};
    if (from?.trim()) {
      const value = new Date(from);
      if (!Number.isFinite(value.getTime())) throw new BadRequestException("from must be a valid ISO date-time.");
      filter.gte = value;
    }
    if (to?.trim()) {
      const value = new Date(to);
      if (!Number.isFinite(value.getTime())) throw new BadRequestException("to must be a valid ISO date-time.");
      filter.lte = value;
    }
    return Object.keys(filter).length > 0 ? filter : undefined;
  }

  private object(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }
}
