import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { AuthPrincipal } from "@carepoint/identity";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";

const ROLES = new Set(["PATIENT", "DOCTOR", "OTHER_PROVIDER", "ADMIN", "SUPPORT"]);

export interface FeatureAssignmentInput {
  environment?: string | null;
  jurisdiction?: string | null;
  role?: string | null;
  providerCategoryId?: string | null;
  enabled: boolean;
  priority?: number;
}

export interface CreateFeatureFlagInput {
  key: string;
  defaultEnabled: boolean;
  reasonCode?: string;
  assignments?: FeatureAssignmentInput[];
}

export interface PublishFeatureFlagVersionInput {
  expectedVersion: number;
  defaultEnabled: boolean;
  reasonCode: string;
  assignments?: FeatureAssignmentInput[];
}

type NormalizedAssignment = {
  selectorKey: string;
  environment: string | null;
  jurisdiction: string | null;
  role: string | null;
  providerCategoryId: string | null;
  enabled: boolean;
  priority: number;
};

@Injectable()
export class FeatureFlagService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
  ) {}

  async list() {
    const flags = await this.prisma.featureFlag.findMany({ orderBy: { key: "asc" } });
    const items = await Promise.all(flags.map(async (flag) => {
      const version = await this.prisma.featureFlagVersion.findUnique({
        where: { featureFlagId_version: { featureFlagId: flag.id, version: flag.currentVersion } },
        include: { assignments: { orderBy: [{ priority: "desc" }, { selectorKey: "asc" }] } },
      });
      return { ...flag, version };
    }));
    return { items };
  }

  async create(principal: AuthPrincipal, input: CreateFeatureFlagInput) {
    const key = this.featureKey(input?.key);
    const defaultEnabled = this.boolean(input?.defaultEnabled, "defaultEnabled");
    const reasonCode = this.optionalReason(input?.reasonCode);
    const assignments = await this.normalizeAssignments(input?.assignments ?? []);

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const flag = await tx.featureFlag.create({ data: { key, currentVersion: 1, active: true } });
        const version = await tx.featureFlagVersion.create({
          data: {
            featureFlagId: flag.id,
            version: 1,
            defaultEnabled,
            createdByActorId: principal.accountId,
            reasonCode,
          },
        });
        if (assignments.length) {
          await tx.featureAssignment.createMany({
            data: assignments.map((rule) => ({
              ...rule,
              featureFlagVersionId: version.id,
              createdByActorId: principal.accountId,
            })),
          });
        }
        await this.audit.writeInTransaction(tx, {
          actorId: principal.accountId,
          action: "FEATURE_FLAG_CREATED",
          objectType: "FEATURE_FLAG",
          objectId: flag.id,
          result: "SUCCESS",
          metadata: { key, version: 1, defaultEnabled, assignmentCount: assignments.length, reasonCode },
        });
        return flag;
      });
      return this.getById(created.id);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("Feature flag key already exists.");
      }
      throw error;
    }
  }

  async publish(principal: AuthPrincipal, featureFlagIdInput: string, input: PublishFeatureFlagVersionInput) {
    const featureFlagId = this.identifier(featureFlagIdInput, "featureFlagId");
    const expectedVersion = this.positiveInteger(input?.expectedVersion, "expectedVersion");
    const defaultEnabled = this.boolean(input?.defaultEnabled, "defaultEnabled");
    const reasonCode = this.reason(input?.reasonCode);
    const assignments = await this.normalizeAssignments(input?.assignments ?? []);

    await this.prisma.$transaction(async (tx) => {
      await this.audit.reserveIntegrityChainForSerializableTransaction(tx);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "FeatureFlag" WHERE id = ${featureFlagId} FOR UPDATE`);
      const current = await tx.featureFlag.findUnique({ where: { id: featureFlagId } });
      if (!current) throw new NotFoundException("Feature flag not found.");
      if (current.currentVersion !== expectedVersion) {
        throw new ConflictException({ message: "Feature flag version conflict.", currentVersion: current.currentVersion });
      }
      const nextVersion = current.currentVersion + 1;
      const version = await tx.featureFlagVersion.create({
        data: {
          featureFlagId,
          version: nextVersion,
          defaultEnabled,
          createdByActorId: principal.accountId,
          reasonCode,
        },
      });
      if (assignments.length) {
        await tx.featureAssignment.createMany({
          data: assignments.map((rule) => ({
            ...rule,
            featureFlagVersionId: version.id,
            createdByActorId: principal.accountId,
          })),
        });
      }
      await tx.featureFlag.update({ where: { id: featureFlagId }, data: { currentVersion: nextVersion } });
      await this.audit.writeInTransaction(tx, {
        actorId: principal.accountId,
        action: "FEATURE_FLAG_VERSION_PUBLISHED",
        objectType: "FEATURE_FLAG",
        objectId: featureFlagId,
        result: "SUCCESS",
        metadata: {
          key: current.key,
          previousVersion: current.currentVersion,
          version: nextVersion,
          defaultEnabled,
          assignmentCount: assignments.length,
          reasonCode,
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return this.getById(featureFlagId);
  }

  async assertEnabled(principal: AuthPrincipal, featureKeyInput: string): Promise<void> {
    const decision = await this.evaluate(principal, featureKeyInput);
    if (!decision.enabled) {
      throw new ForbiddenException({
        message: "Feature is disabled by server policy.",
        featureKey: decision.featureKey,
        policyVersion: decision.policyVersion,
      });
    }
  }

  async evaluate(principal: AuthPrincipal, featureKeyInput: string) {
    const featureKey = this.featureKey(featureKeyInput);
    const flag = await this.prisma.featureFlag.findUnique({ where: { key: featureKey } });
    if (!flag || !flag.active) {
      return { featureKey, enabled: false, policyVersion: null, matchedSelectorKey: null, reason: "MISSING_OR_INACTIVE" };
    }
    const version = await this.prisma.featureFlagVersion.findUnique({
      where: { featureFlagId_version: { featureFlagId: flag.id, version: flag.currentVersion } },
      include: { assignments: true },
    });
    if (!version) {
      return { featureKey, enabled: false, policyVersion: flag.currentVersion, matchedSelectorKey: null, reason: "VERSION_MISSING" };
    }

    const context = await this.runtimeContext(principal);
    const matches = version.assignments
      .filter((rule) => (
        (!rule.environment || rule.environment === context.environment)
        && (!rule.jurisdiction || rule.jurisdiction === context.jurisdiction)
        && (!rule.role || rule.role === context.role)
        && (!rule.providerCategoryId || rule.providerCategoryId === context.providerCategoryId)
      ))
      .map((rule) => ({
        rule,
        specificity: [rule.environment, rule.jurisdiction, rule.role, rule.providerCategoryId].filter(Boolean).length,
      }))
      .sort((a, b) => b.specificity - a.specificity || b.rule.priority - a.rule.priority || a.rule.selectorKey.localeCompare(b.rule.selectorKey));

    const selected = matches[0]?.rule ?? null;
    return {
      featureKey,
      enabled: selected?.enabled ?? version.defaultEnabled,
      policyVersion: version.version,
      matchedSelectorKey: selected?.selectorKey ?? null,
      reason: selected ? "ASSIGNMENT" : "DEFAULT",
    };
  }

  private async getById(id: string) {
    const flag = await this.prisma.featureFlag.findUnique({ where: { id } });
    if (!flag) throw new NotFoundException("Feature flag not found.");
    const version = await this.prisma.featureFlagVersion.findUnique({
      where: { featureFlagId_version: { featureFlagId: id, version: flag.currentVersion } },
      include: { assignments: { orderBy: [{ priority: "desc" }, { selectorKey: "asc" }] } },
    });
    return { ...flag, version };
  }

  private async runtimeContext(principal: AuthPrincipal) {
    let providerCategoryId: string | null = null;
    if (principal.role === "OTHER_PROVIDER") {
      const provider = await this.prisma.provider.findUnique({
        where: { userId: principal.accountId },
        select: { otherProviderProfile: { select: { categoryId: true } } },
      });
      providerCategoryId = provider?.otherProviderProfile?.categoryId ?? null;
    }
    return {
      environment: this.runtimeToken(process.env.CAREPOINT_ENVIRONMENT ?? process.env.NODE_ENV ?? "development"),
      jurisdiction: process.env.CAREPOINT_JURISDICTION ? this.runtimeToken(process.env.CAREPOINT_JURISDICTION) : null,
      role: principal.role,
      providerCategoryId,
    };
  }

  private async normalizeAssignments(inputs: FeatureAssignmentInput[]): Promise<NormalizedAssignment[]> {
    if (!Array.isArray(inputs) || inputs.length > 100) throw new BadRequestException("assignments must contain at most 100 rules.");
    const normalized: NormalizedAssignment[] = [];
    const seen = new Set<string>();
    for (const input of inputs) {
      const environment = input.environment ? this.runtimeToken(input.environment) : null;
      const jurisdiction = input.jurisdiction ? this.runtimeToken(input.jurisdiction) : null;
      const role = input.role ? String(input.role).trim().toUpperCase() : null;
      if (role && !ROLES.has(role)) throw new BadRequestException("assignment role is invalid.");
      const providerCategoryId = input.providerCategoryId ? this.identifier(input.providerCategoryId, "providerCategoryId") : null;
      if (providerCategoryId) {
        const category = await this.prisma.providerCategory.findUnique({ where: { id: providerCategoryId }, select: { id: true, active: true } });
        if (!category?.active) throw new BadRequestException("providerCategoryId must reference an active provider category.");
      }
      const enabled = this.boolean(input.enabled, "assignment.enabled");
      const priority = input.priority === undefined ? 0 : this.integer(input.priority, "assignment.priority", -1000, 1000);
      const selectorKey = `env=${environment ?? "*"}|jur=${jurisdiction ?? "*"}|role=${role ?? "*"}|cat=${providerCategoryId ?? "*"}`;
      if (seen.has(selectorKey)) throw new BadRequestException(`Duplicate feature selector '${selectorKey}'.`);
      seen.add(selectorKey);
      normalized.push({ selectorKey, environment, jurisdiction, role, providerCategoryId, enabled, priority });
    }
    return normalized;
  }

  private featureKey(value: unknown) {
    if (typeof value !== "string") throw new BadRequestException("feature key is required.");
    const normalized = value.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_]{1,79}$/.test(normalized)) throw new BadRequestException("feature key is invalid.");
    return normalized;
  }

  private runtimeToken(value: unknown) {
    if (typeof value !== "string") throw new BadRequestException("feature selector token is invalid.");
    const normalized = value.trim().toUpperCase();
    if (!/^[A-Z0-9_.:-]{1,80}$/.test(normalized)) throw new BadRequestException("feature selector token is invalid.");
    return normalized;
  }

  private identifier(value: unknown, field: string) {
    if (typeof value !== "string") throw new BadRequestException(`${field} is required.`);
    const normalized = value.trim();
    if (!/^[A-Za-z0-9_.:-]{1,180}$/.test(normalized)) throw new BadRequestException(`${field} is invalid.`);
    return normalized;
  }

  private boolean(value: unknown, field: string): boolean {
    if (typeof value !== "boolean") throw new BadRequestException(`${field} must be boolean.`);
    return value;
  }

  private positiveInteger(value: unknown, field: string) {
    return this.integer(value, field, 1, Number.MAX_SAFE_INTEGER);
  }

  private integer(value: unknown, field: string, min: number, max: number) {
    if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) {
      throw new BadRequestException(`${field} must be an integer between ${min} and ${max}.`);
    }
    return Number(value);
  }

  private reason(value: unknown) {
    if (typeof value !== "string") throw new BadRequestException("reasonCode is required.");
    const normalized = value.trim().toUpperCase();
    if (!/^[A-Z0-9_.:-]{2,80}$/.test(normalized)) throw new BadRequestException("reasonCode is invalid.");
    return normalized;
  }

  private optionalReason(value: unknown) {
    if (value === undefined || value === null || value === "") return null;
    return this.reason(value);
  }
}
