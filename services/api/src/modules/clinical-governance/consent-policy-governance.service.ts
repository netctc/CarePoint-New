import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { AuthPrincipal, IdentityRole } from "@carepoint/identity";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import {
  ClinicalConsentPolicies,
  resolveClinicalConsentPolicy,
  validateClinicalConsentGrantContract,
  type ClinicalConsentPolicy,
} from "./clinical-consent-policy";

export const RUNTIME_CONSENT_JURISDICTION = "GLOBAL";
const REQUIRED_LOCALES = ["en", "ar", "fr", "es"] as const;
const MAX_POLICY_GRANT_MINUTES = 365 * 24 * 60;

export interface CreateConsentPolicyDefinitionInput {
  scopePattern: string;
  jurisdiction?: string;
}
export interface CreateConsentPolicyVersionInput {
  titleLabels: unknown;
  bodyLabels: unknown;
  allowedPurposes?: unknown;
  eligibleRoles?: unknown;
  temporaryShareable?: boolean;
  requireExpiry?: boolean;
  maxGrantMinutes?: number | null;
  regrantAllowed?: boolean;
}
export interface ManagedConsentGrantInput {
  scope: string;
  version: string;
  purpose: string | null;
  providerRole?: IdentityRole | null;
  expiresAt?: Date | null;
  jurisdiction?: string | null;
  temporaryShare?: boolean;
  regrant?: boolean;
}
export type ConsentPolicyPresentation = {
  id: string;
  revision: number;
  jurisdiction: string;
  titleLabels: Prisma.JsonValue;
  bodyLabels: Prisma.JsonValue;
  regrantAllowed: boolean;
};

@Injectable()
export class ConsentPolicyGovernanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
  ) {}

  async catalog() {
    const policies = await this.prisma.consentPolicyDefinition.findMany({
      include: { versions: { orderBy: { version: "desc" } } },
      orderBy: [{ scopePattern: "asc" }, { jurisdiction: "asc" }],
    });
    return {
      runtimeJurisdiction: RUNTIME_CONSENT_JURISDICTION,
      safetyCeiling: ClinicalConsentPolicies,
      policies: policies.map((policy) => ({
        id: policy.id,
        scopePattern: policy.scopePattern,
        jurisdiction: policy.jurisdiction,
        active: policy.active,
        versions: policy.versions.map((version) => this.presentVersion(version, policy.jurisdiction)),
      })),
      invariants: {
        managedPolicyCannotExpandScope: true,
        managedPolicyCannotExpandRole: true,
        managedPolicyCannotExpandPurpose: true,
        managedPolicyCannotEnableTemporaryShareBeyondCore: true,
        historicalConsentPinsPolicyVersion: true,
      },
    };
  }

  async createDefinition(principal: AuthPrincipal, input: CreateConsentPolicyDefinitionInput) {
    const scopePattern = this.scopePattern(input?.scopePattern);
    const jurisdiction = this.jurisdiction(input?.jurisdiction);
    const existing = await this.prisma.consentPolicyDefinition.findUnique({
      where: { scopePattern_jurisdiction: { scopePattern, jurisdiction } },
    });
    if (existing) throw new ConflictException("Consent policy definition already exists.");
    const created = await this.prisma.consentPolicyDefinition.create({ data: { scopePattern, jurisdiction } });
    await this.audit.write({
      actorId: principal.accountId,
      action: "CONSENT_POLICY_DEFINITION_CREATED",
      objectType: "CONSENT_POLICY_DEFINITION",
      objectId: created.id,
      purpose: "ACCESS_GOVERNANCE",
      result: "SUCCESS",
      metadata: { scopePattern, jurisdiction, safetyCeilingEnforced: true },
    });
    return created;
  }

  async createVersion(
    principal: AuthPrincipal,
    policyIdRaw: string,
    input: CreateConsentPolicyVersionInput,
  ) {
    const policyId = this.id(policyIdRaw, "policyId");
    const definition = await this.prisma.consentPolicyDefinition.findUnique({ where: { id: policyId } });
    if (!definition || !definition.active) throw new NotFoundException("Active consent policy definition not found.");
    const ceiling = this.ceiling(definition.scopePattern);
    const normalized = this.normalizeVersionInput(input, ceiling);

    const created = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "ConsentPolicyDefinition" WHERE id = ${policyId} FOR UPDATE`);
      const latest = await tx.consentPolicyVersion.findFirst({
        where: { policyId },
        orderBy: { version: "desc" },
        select: { version: true },
      });
      return tx.consentPolicyVersion.create({
        data: {
          policyId,
          version: (latest?.version ?? 0) + 1,
          status: "DRAFT",
          titleLabels: normalized.titleLabels as Prisma.InputJsonValue,
          bodyLabels: normalized.bodyLabels as Prisma.InputJsonValue,
          allowedPurposes: normalized.allowedPurposes as unknown as Prisma.InputJsonValue,
          eligibleRoles: normalized.eligibleRoles as unknown as Prisma.InputJsonValue,
          temporaryShareable: normalized.temporaryShareable,
          requireExpiry: normalized.requireExpiry,
          maxGrantMinutes: normalized.maxGrantMinutes,
          regrantAllowed: normalized.regrantAllowed,
          createdByActorId: principal.accountId,
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    await this.audit.write({
      actorId: principal.accountId,
      action: "CONSENT_POLICY_VERSION_CREATED",
      objectType: "CONSENT_POLICY_VERSION",
      objectId: created.id,
      purpose: "ACCESS_GOVERNANCE",
      result: "SUCCESS",
      metadata: {
        scopePattern: definition.scopePattern,
        jurisdiction: definition.jurisdiction,
        policyRevision: created.version,
        safetyCeilingEnforced: true,
      },
    });
    return this.presentVersion(created, definition.jurisdiction);
  }

  async activate(principal: AuthPrincipal, policyIdRaw: string, versionRaw: string | number) {
    const policyId = this.id(policyIdRaw, "policyId");
    const version = this.positiveInteger(versionRaw, "version");
    const definition = await this.prisma.consentPolicyDefinition.findUnique({ where: { id: policyId } });
    if (!definition || !definition.active) throw new NotFoundException("Active consent policy definition not found.");
    const ceiling = this.ceiling(definition.scopePattern);
    const target = await this.prisma.consentPolicyVersion.findUnique({
      where: { policyId_version: { policyId, version } },
    });
    if (!target) throw new NotFoundException("Consent policy version not found.");
    if (target.status === "ACTIVE") return this.presentVersion(target, definition.jurisdiction);
    if (target.status !== "DRAFT") throw new ConflictException("Only a DRAFT consent policy version can be activated.");
    this.assertStoredVersionWithinCeiling(target, ceiling);

    const now = new Date();
    const active = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "ConsentPolicyDefinition" WHERE id = ${policyId} FOR UPDATE`);
      await tx.consentPolicyVersion.updateMany({
        where: { policyId, status: "ACTIVE" },
        data: { status: "RETIRED", retiredAt: now },
      });
      return tx.consentPolicyVersion.update({
        where: { id: target.id },
        data: { status: "ACTIVE", activatedAt: now, retiredAt: null },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    await this.audit.write({
      actorId: principal.accountId,
      action: "CONSENT_POLICY_VERSION_ACTIVATED",
      objectType: "CONSENT_POLICY_VERSION",
      objectId: active.id,
      purpose: "ACCESS_GOVERNANCE",
      result: "SUCCESS",
      metadata: {
        scopePattern: definition.scopePattern,
        jurisdiction: definition.jurisdiction,
        policyRevision: active.version,
        safetyCeilingEnforced: true,
      },
    });
    return this.presentVersion(active, definition.jurisdiction);
  }

  async validateGrant(input: ManagedConsentGrantInput) {
    const base = validateClinicalConsentGrantContract({
      scope: input.scope,
      version: input.version,
      purpose: input.purpose,
      providerRole: input.providerRole ?? null,
    });
    const ceiling = resolveClinicalConsentPolicy(base.scope);
    if (!ceiling) return { ...base, policyVersionId: null, policyJurisdiction: null, policy: null as ConsentPolicyPresentation | null };

    const jurisdiction = this.jurisdiction(input.jurisdiction);
    const active = await this.activeVersion(ceiling.scopePattern, jurisdiction);
    if (!active) return { ...base, policyVersionId: null, policyJurisdiction: null, policy: null as ConsentPolicyPresentation | null };
    this.assertStoredVersionWithinCeiling(active.version, ceiling);

    const roles = this.jsonStrings(active.version.eligibleRoles);
    const purposes = this.jsonStrings(active.version.allowedPurposes);
    if (input.providerRole && !roles.includes(input.providerRole)) {
      throw new BadRequestException(`Managed consent policy does not allow provider role '${input.providerRole}'.`);
    }
    if (base.purpose && !purposes.includes(base.purpose)) {
      throw new BadRequestException(`Managed consent policy does not allow purpose '${base.purpose}'.`);
    }
    if (input.temporaryShare && !active.version.temporaryShareable) {
      throw new BadRequestException("Managed consent policy does not allow temporary sharing.");
    }
    if (input.regrant && !active.version.regrantAllowed) {
      throw new BadRequestException("Managed consent policy does not allow re-grant.");
    }
    this.assertExpiry(active.version.requireExpiry, active.version.maxGrantMinutes, input.expiresAt ?? null);

    return {
      ...base,
      policyVersionId: active.version.id,
      policyJurisdiction: active.policy.jurisdiction,
      policy: this.presentation(active.version, active.policy.jurisdiction),
    };
  }

  async presentationsByIds(ids: string[]) {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return new Map<string, ConsentPolicyPresentation>();
    const rows = await this.prisma.consentPolicyVersion.findMany({
      where: { id: { in: unique } },
      include: { policy: { select: { jurisdiction: true } } },
    });
    return new Map(rows.map((row) => [row.id, this.presentation(row, row.policy.jurisdiction)]));
  }

  private async activeVersion(scopePattern: string, jurisdiction: string) {
    const find = (targetJurisdiction: string) => this.prisma.consentPolicyDefinition.findUnique({
      where: { scopePattern_jurisdiction: { scopePattern, jurisdiction: targetJurisdiction } },
      include: {
        versions: {
          where: { status: "ACTIVE" },
          orderBy: { version: "desc" },
          take: 1,
        },
      },
    });
    const exact = await find(jurisdiction);
    if (exact?.active && exact.versions[0]) return { policy: exact, version: exact.versions[0] };
    if (jurisdiction !== RUNTIME_CONSENT_JURISDICTION) {
      const fallback = await find(RUNTIME_CONSENT_JURISDICTION);
      if (fallback?.active && fallback.versions[0]) return { policy: fallback, version: fallback.versions[0] };
    }
    return null;
  }

  private normalizeVersionInput(input: CreateConsentPolicyVersionInput, ceiling: ClinicalConsentPolicy) {
    const titleLabels = this.labels(input?.titleLabels, "titleLabels", 160);
    const bodyLabels = this.labels(input?.bodyLabels, "bodyLabels", 4000);
    const allowedPurposes = this.subset(input?.allowedPurposes ?? [...ceiling.allowedPurposes], [...ceiling.allowedPurposes], "allowedPurposes");
    const eligibleRoles = this.subset(input?.eligibleRoles ?? [...ceiling.eligibleRoles], [...ceiling.eligibleRoles], "eligibleRoles") as IdentityRole[];
    if (eligibleRoles.length === 0) throw new BadRequestException("eligibleRoles must contain at least one safety-ceiling role.");
    const temporaryShareable = input?.temporaryShareable === true;
    if (temporaryShareable && !ceiling.temporaryShareable) {
      throw new BadRequestException("Managed policy cannot enable temporary sharing beyond the core safety policy.");
    }
    const requireExpiry = input?.requireExpiry === true;
    const maxGrantMinutes = this.optionalMinutes(input?.maxGrantMinutes);
    if (requireExpiry && maxGrantMinutes == null) throw new BadRequestException("maxGrantMinutes is required when requireExpiry=true.");
    return {
      titleLabels, bodyLabels, allowedPurposes, eligibleRoles, temporaryShareable,
      requireExpiry, maxGrantMinutes, regrantAllowed: input?.regrantAllowed !== false,
    };
  }

  private assertStoredVersionWithinCeiling(
    row: {
      eligibleRoles: Prisma.JsonValue; allowedPurposes: Prisma.JsonValue;
      temporaryShareable: boolean; requireExpiry: boolean; maxGrantMinutes: number | null;
    },
    ceiling: ClinicalConsentPolicy,
  ) {
    const purposes = this.subset(row.allowedPurposes, [...ceiling.allowedPurposes], "allowedPurposes");
    const roles = this.subset(row.eligibleRoles, [...ceiling.eligibleRoles], "eligibleRoles");
    if (purposes.length === 0 || roles.length === 0) throw new ConflictException("Stored managed policy has an empty authorization subset.");
    if (row.temporaryShareable && !ceiling.temporaryShareable) {
      throw new ConflictException("Stored managed policy exceeds temporary-share safety ceiling.");
    }
    if (row.requireExpiry && row.maxGrantMinutes == null) throw new ConflictException("Stored managed policy has invalid expiry configuration.");
  }

  private assertExpiry(requireExpiry: boolean, maxGrantMinutes: number | null, expiresAt: Date | null) {
    if (requireExpiry && !expiresAt) throw new BadRequestException("This consent policy requires an expiry.");
    if (!expiresAt) return;
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) throw new BadRequestException("Consent expiry must be a future date.");
    if (maxGrantMinutes != null) {
      const delta = (expiresAt.getTime() - Date.now()) / 60000;
      if (delta > maxGrantMinutes) throw new BadRequestException(`Consent expiry exceeds managed policy maximum of ${maxGrantMinutes} minutes.`);
    }
  }

  private ceiling(scopePattern: string) {
    const ceiling = ClinicalConsentPolicies.find((item) => item.scopePattern === scopePattern);
    if (!ceiling) throw new BadRequestException("scopePattern is outside the clinical consent safety ceiling.");
    return ceiling;
  }
  private scopePattern(value: unknown) {
    if (typeof value !== "string") throw new BadRequestException("scopePattern is required.");
    const normalized = value.trim().toUpperCase(); this.ceiling(normalized); return normalized;
  }
  private jurisdiction(value: unknown) {
    const normalized = typeof value === "string" && value.trim() ? value.trim().toUpperCase() : RUNTIME_CONSENT_JURISDICTION;
    if (!/^[A-Z][A-Z0-9_-]{1,31}$/.test(normalized)) throw new BadRequestException("jurisdiction is invalid.");
    return normalized;
  }
  private labels(value: unknown, field: string, maxLength: number) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestException(`${field} must contain EN/AR/FR/ES text.`);
    const raw = value as Record<string, unknown>; const result: Record<string, string> = {};
    for (const locale of REQUIRED_LOCALES) {
      const text = typeof raw[locale] === "string" ? raw[locale].trim() : "";
      if (!text || text.length > maxLength || /\p{Cc}/u.test(text)) throw new BadRequestException(`${field}.${locale} is required and must be <= ${maxLength} characters.`);
      result[locale] = text;
    }
    return result;
  }
  private subset(raw: unknown, ceiling: string[], field: string) {
    if (!Array.isArray(raw)) throw new BadRequestException(`${field} must be an array.`);
    const values = [...new Set(raw.map((item) => {
      if (typeof item !== "string") throw new BadRequestException(`${field} values must be strings.`);
      return item.trim().toUpperCase();
    }).filter(Boolean))];
    for (const value of values) if (!ceiling.includes(value)) throw new BadRequestException(`${field} cannot expand beyond the core safety policy: ${value}.`);
    return values;
  }
  private optionalMinutes(value: unknown) {
    if (value == null || value === "") return null;
    const normalized = Number(value);
    if (!Number.isInteger(normalized) || normalized < 5 || normalized > MAX_POLICY_GRANT_MINUTES) throw new BadRequestException(`maxGrantMinutes must be between 5 and ${MAX_POLICY_GRANT_MINUTES}.`);
    return normalized;
  }
  private positiveInteger(value: unknown, field: string) {
    const normalized = typeof value === "string" ? Number(value) : value;
    if (!Number.isInteger(normalized) || Number(normalized) < 1) throw new BadRequestException(`${field} must be a positive integer.`);
    return Number(normalized);
  }
  private id(value: unknown, field: string) {
    if (typeof value !== "string" || !/^[A-Za-z0-9_.:-]{1,180}$/.test(value.trim())) throw new BadRequestException(`${field} is invalid.`);
    return value.trim();
  }
  private jsonStrings(value: Prisma.JsonValue) {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  }
  private presentation(
    row: { id: string; version: number; titleLabels: Prisma.JsonValue; bodyLabels: Prisma.JsonValue; regrantAllowed: boolean },
    jurisdiction: string,
  ): ConsentPolicyPresentation {
    return { id: row.id, revision: row.version, jurisdiction, titleLabels: row.titleLabels, bodyLabels: row.bodyLabels, regrantAllowed: row.regrantAllowed };
  }
  private presentVersion(
    row: {
      id: string; policyId: string; version: number; status: string; titleLabels: Prisma.JsonValue; bodyLabels: Prisma.JsonValue;
      allowedPurposes: Prisma.JsonValue; eligibleRoles: Prisma.JsonValue; temporaryShareable: boolean; requireExpiry: boolean;
      maxGrantMinutes: number | null; regrantAllowed: boolean; activatedAt: Date | null; retiredAt: Date | null; createdAt: Date;
    },
    jurisdiction: string,
  ) {
    return {
      id: row.id, policyId: row.policyId, version: row.version, status: row.status, jurisdiction,
      titleLabels: row.titleLabels, bodyLabels: row.bodyLabels,
      allowedPurposes: this.jsonStrings(row.allowedPurposes), eligibleRoles: this.jsonStrings(row.eligibleRoles),
      temporaryShareable: row.temporaryShareable, requireExpiry: row.requireExpiry, maxGrantMinutes: row.maxGrantMinutes,
      regrantAllowed: row.regrantAllowed, activatedAt: row.activatedAt, retiredAt: row.retiredAt, createdAt: row.createdAt,
    };
  }
}
