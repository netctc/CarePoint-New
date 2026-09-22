import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { AuthPrincipal, IdentityRole } from "@carepoint/identity";
import { Prisma } from "@prisma/client";
import { DatabaseAuditService } from "../infrastructure/audit/audit.service";
import { PrismaService } from "../infrastructure/prisma/prisma.module";
import { carePointRuntimeFeatures } from "../infrastructure/release/private-pilot-policy";

const FEATURE_KEY = /^[A-Z][A-Z0-9_]{2,79}$/;
const DIMENSION = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/;
const JURISDICTION = /^[A-Z0-9][A-Z0-9_-]{0,39}$/;
const REASON_CODE = /^[A-Z][A-Z0-9_]{2,79}$/;
const ROLES = new Set<IdentityRole>(["PATIENT", "DOCTOR", "OTHER_PROVIDER", "ADMIN", "SUPPORT"]);

export interface CreateFeatureFlagInput {
  key?: string;
  description?: string;
  defaultEnabled?: boolean;
}

export interface UpsertFeatureAssignmentInput {
  environment?: string;
  jurisdiction?: string;
  role?: string;
  providerCategory?: string;
  enabled?: boolean;
  reasonCode?: string;
}

export interface FeatureDecision {
  key: string;
  enabled: boolean;
  source: "HARD_CEILING" | "FLAG_DEFAULT" | "ASSIGNMENT" | "MISSING_FLAG" | "INACTIVE_FLAG";
  environment: string;
  jurisdiction: string;
  role: IdentityRole;
  providerCategory: string;
  assignmentId: string | null;
}

export function carePointRuntimeJurisdiction(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.CAREPOINT_JURISDICTION?.trim().toUpperCase() || "GLOBAL";
  if (!JURISDICTION.test(raw)) throw new Error("CAREPOINT_JURISDICTION must be a safe 1-40 character jurisdiction code.");
  return raw;
}

export function carePointRuntimeEnvironment(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.NODE_ENV?.trim().toLowerCase() || "development";
  if (!DIMENSION.test(raw)) throw new Error("NODE_ENV must be a safe feature-policy environment value.");
  return raw;
}

@Injectable()
export class FeaturePolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
  ) {}

  async assertEnabled(principal: AuthPrincipal, featureKey: string, route: string | null): Promise<void> {
    const decision = await this.evaluate(principal, featureKey);
    if (decision.enabled) return;
    await this.audit.write({
      actorId: principal.accountId,
      action: "FEATURE_FLAG_DENIED",
      objectType: "FEATURE_FLAG",
      objectId: decision.key,
      purpose: "FEATURE_POLICY",
      result: "DENIED",
      metadata: {
        source: decision.source,
        environment: decision.environment,
        jurisdiction: decision.jurisdiction,
        role: decision.role,
        providerCategory: decision.providerCategory,
        assignmentId: decision.assignmentId,
        route,
      },
    });
    throw new NotFoundException("Feature is not available.");
  }

  async evaluate(principal: AuthPrincipal, rawKey: string): Promise<FeatureDecision> {
    const key = this.featureKey(rawKey);
    const environment = carePointRuntimeEnvironment();
    const jurisdiction = carePointRuntimeJurisdiction();
    const providerCategory = await this.providerCategory(principal);
    const base = { key, environment, jurisdiction, role: principal.role, providerCategory };

    if (!this.hardCeilingEnabled(key)) {
      return { ...base, enabled: false, source: "HARD_CEILING", assignmentId: null };
    }

    const flag = await this.prisma.featureFlag.findUnique({
      where: { key },
      include: { assignments: { where: { active: true } } },
    });
    if (!flag) return { ...base, enabled: false, source: "MISSING_FLAG", assignmentId: null };
    if (!flag.active) return { ...base, enabled: false, source: "INACTIVE_FLAG", assignmentId: null };

    const matches = flag.assignments
      .filter((assignment) => this.matches(assignment.environment, environment))
      .filter((assignment) => this.matches(assignment.jurisdiction, jurisdiction))
      .filter((assignment) => this.matches(assignment.role, principal.role))
      .filter((assignment) => this.matches(assignment.providerCategory, providerCategory))
      .map((assignment) => ({
        assignment,
        specificity: this.specificity(assignment.environment, assignment.jurisdiction, assignment.role, assignment.providerCategory),
      }))
      .sort((left, right) => {
        if (left.specificity !== right.specificity) return right.specificity - left.specificity;
        if (left.assignment.enabled !== right.assignment.enabled) return left.assignment.enabled ? 1 : -1;
        if (left.assignment.version !== right.assignment.version) return right.assignment.version - left.assignment.version;
        return left.assignment.id.localeCompare(right.assignment.id);
      });

    const selected = matches[0]?.assignment;
    if (!selected) {
      return { ...base, enabled: flag.defaultEnabled, source: "FLAG_DEFAULT", assignmentId: null };
    }
    return { ...base, enabled: selected.enabled, source: "ASSIGNMENT", assignmentId: selected.id };
  }

  async listForAdmin() {
    const environment = carePointRuntimeEnvironment();
    const jurisdiction = carePointRuntimeJurisdiction();
    const rows = await this.prisma.featureFlag.findMany({
      include: { assignments: { orderBy: [{ environment: "asc" }, { jurisdiction: "asc" }, { role: "asc" }, { providerCategory: "asc" }] } },
      orderBy: { key: "asc" },
    });
    return {
      serverContext: { environment, jurisdiction },
      flags: rows.map((flag) => ({
        id: flag.id,
        key: flag.key,
        description: flag.description,
        defaultEnabled: flag.defaultEnabled,
        active: flag.active,
        version: flag.version,
        hardCeilingEnabled: this.hardCeilingEnabled(flag.key),
        createdAt: flag.createdAt,
        updatedAt: flag.updatedAt,
        assignments: flag.assignments.map((assignment) => ({
          id: assignment.id,
          environment: assignment.environment,
          jurisdiction: assignment.jurisdiction,
          role: assignment.role,
          providerCategory: assignment.providerCategory,
          enabled: assignment.enabled,
          active: assignment.active,
          version: assignment.version,
          reasonCode: assignment.reasonCode,
          updatedAt: assignment.updatedAt,
        })),
      })),
    };
  }

  async createFlag(principal: AuthPrincipal, input: CreateFeatureFlagInput) {
    const key = this.featureKey(input.key);
    const description = this.optionalText(input.description, 300, "description");
    if (input.defaultEnabled !== undefined && typeof input.defaultEnabled !== "boolean") {
      throw new BadRequestException("defaultEnabled must be boolean.");
    }
    const flag = await this.prisma.featureFlag.create({
      data: {
        key,
        description,
        defaultEnabled: input.defaultEnabled ?? true,
        createdByActorId: principal.accountId,
        updatedByActorId: principal.accountId,
      },
    });
    await this.audit.write({
      actorId: principal.accountId,
      action: "FEATURE_FLAG_CREATED",
      objectType: "FEATURE_FLAG",
      objectId: flag.id,
      purpose: "FEATURE_POLICY",
      result: "SUCCESS",
      metadata: { key: flag.key, defaultEnabled: flag.defaultEnabled },
    });
    return flag;
  }

  async upsertAssignment(principal: AuthPrincipal, flagId: string, input: UpsertFeatureAssignmentInput) {
    if (typeof input.enabled !== "boolean") throw new BadRequestException("enabled must be boolean.");
    const flag = await this.prisma.featureFlag.findUnique({ where: { id: flagId }, select: { id: true, key: true } });
    if (!flag) throw new NotFoundException("Feature flag not found.");

    const environment = this.environment(input.environment);
    const jurisdiction = this.jurisdiction(input.jurisdiction);
    const role = this.role(input.role);
    const providerCategory = await this.category(input.providerCategory);
    const reasonCode = this.reasonCode(input.reasonCode);

    const assignment = await this.prisma.$transaction(async (tx) => {
      const current = await tx.featureAssignment.findUnique({
        where: {
          featureFlagId_environment_jurisdiction_role_providerCategory: {
            featureFlagId: flag.id,
            environment,
            jurisdiction,
            role,
            providerCategory,
          },
        },
      });
      if (!current) {
        return tx.featureAssignment.create({
          data: {
            featureFlagId: flag.id,
            environment,
            jurisdiction,
            role,
            providerCategory,
            enabled: input.enabled!,
            reasonCode,
            updatedByActorId: principal.accountId,
          },
        });
      }
      return tx.featureAssignment.update({
        where: { id: current.id },
        data: {
          enabled: input.enabled!,
          active: true,
          reasonCode,
          version: { increment: 1 },
          updatedByActorId: principal.accountId,
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    await this.audit.write({
      actorId: principal.accountId,
      action: "FEATURE_ASSIGNMENT_UPSERTED",
      objectType: "FEATURE_ASSIGNMENT",
      objectId: assignment.id,
      purpose: "FEATURE_POLICY",
      result: "SUCCESS",
      metadata: {
        featureKey: flag.key,
        environment,
        jurisdiction,
        role,
        providerCategory,
        enabled: assignment.enabled,
        version: assignment.version,
        reasonCode,
      },
    });
    return assignment;
  }

  private async providerCategory(principal: AuthPrincipal): Promise<string> {
    if (principal.role !== "OTHER_PROVIDER") return "*";
    const provider = await this.prisma.provider.findFirst({
      where: { userId: principal.accountId, status: "ACTIVE" },
      select: { otherProviderProfile: { select: { category: { select: { slug: true } } } } },
    });
    return provider?.otherProviderProfile?.category.slug ?? "*";
  }

  private hardCeilingEnabled(key: string): boolean {
    const runtime = carePointRuntimeFeatures(process.env);
    if (key === "TELEHEALTH") return runtime.telehealth;
    if (key === "PAYMENTS") return runtime.payments;
    if (key === "PATIENT_SELF_REGISTRATION") return runtime.patientSelfRegistration;
    if (key === "EXTERNAL_NOTIFICATIONS") return runtime.externalNotifications;
    return true;
  }

  private matches(assignment: string, actual: string): boolean {
    return assignment === "*" || assignment === actual;
  }

  private specificity(...dimensions: string[]): number {
    return dimensions.reduce((score, value) => score + (value === "*" ? 0 : 1), 0);
  }

  private featureKey(value: unknown): string {
    if (typeof value !== "string") throw new BadRequestException("feature key is required.");
    const key = value.trim().toUpperCase();
    if (!FEATURE_KEY.test(key)) throw new BadRequestException("feature key must be an uppercase safe identifier.");
    return key;
  }

  private environment(value: unknown): string {
    if (value === undefined || value === null || value === "") return "*";
    if (typeof value !== "string") throw new BadRequestException("environment must be text.");
    const normalized = value.trim().toLowerCase();
    if (normalized === "*") return normalized;
    if (!DIMENSION.test(normalized)) throw new BadRequestException("environment is invalid.");
    return normalized;
  }

  private jurisdiction(value: unknown): string {
    if (value === undefined || value === null || value === "") return "*";
    if (typeof value !== "string") throw new BadRequestException("jurisdiction must be text.");
    const normalized = value.trim().toUpperCase();
    if (normalized === "*") return normalized;
    if (!JURISDICTION.test(normalized)) throw new BadRequestException("jurisdiction is invalid.");
    return normalized;
  }

  private role(value: unknown): string {
    if (value === undefined || value === null || value === "") return "*";
    if (typeof value !== "string") throw new BadRequestException("role must be text.");
    const normalized = value.trim().toUpperCase();
    if (normalized === "*") return normalized;
    if (!ROLES.has(normalized as IdentityRole)) throw new BadRequestException("role is invalid.");
    return normalized;
  }

  private async category(value: unknown): Promise<string> {
    if (value === undefined || value === null || value === "") return "*";
    if (typeof value !== "string") throw new BadRequestException("providerCategory must be text.");
    const normalized = value.trim().toLowerCase();
    if (normalized === "*") return normalized;
    if (!DIMENSION.test(normalized)) throw new BadRequestException("providerCategory is invalid.");
    const category = await this.prisma.providerCategory.findUnique({ where: { slug: normalized }, select: { active: true } });
    if (!category?.active) throw new BadRequestException("providerCategory must reference an active provider category.");
    return normalized;
  }

  private reasonCode(value: unknown): string | null {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string") throw new BadRequestException("reasonCode must be text.");
    const normalized = value.trim().toUpperCase();
    if (!REASON_CODE.test(normalized)) throw new BadRequestException("reasonCode must be a safe uppercase code.");
    return normalized;
  }

  private optionalText(value: unknown, max: number, field: string): string | null {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string") throw new BadRequestException(`${field} must be text.`);
    const text = value.trim();
    if (!text || text.length > max) throw new BadRequestException(`${field} must contain 1-${max} characters.`);
    return text;
  }
}
