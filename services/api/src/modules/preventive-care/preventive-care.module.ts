import { createHash } from "node:crypto";
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { AuthPrincipal } from "@carepoint/identity";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { ClinicalModule } from "../clinical/clinical.module";
import { ClinicalEnvelopeService } from "../clinical/clinical-envelope.service";
import { DependentsModule } from "../dependents/dependents.module";
import { PatientContextService } from "../dependents/dependents.service";
import {
  evaluatePreventiveRule,
  type PreventiveImmunization,
  type PreventiveTrigger,
} from "./preventive-care.engine";

const REQUIRED_LOCALES = ["en", "ar", "fr", "es"] as const;
const STATUSES = new Set(["DRAFT", "PUBLISHED", "RETIRED"]);
const TRIGGERS = new Set(["AGE_WINDOW", "IMMUNIZATION_INTERVAL"]);
const ACTIONS = new Set(["DISMISSED", "POSTPONED"]);

type CreateRuleInput = { code?: unknown };
type CreateVersionInput = {
  labels?: unknown;
  descriptionLabels?: unknown;
  sourceLabels?: unknown;
  sourceReference?: unknown;
  jurisdiction?: unknown;
  triggerType?: unknown;
  minAgeYears?: unknown;
  maxAgeYears?: unknown;
  vaccineCodeSystem?: unknown;
  vaccineCode?: unknown;
  intervalDays?: unknown;
  allowDismiss?: unknown;
  allowPostpone?: unknown;
  maxPostponeDays?: unknown;
};
type PatientActionInput = {
  action?: unknown;
  postponedUntil?: unknown;
  idempotencyKey?: unknown;
};
type HealthPayload = { schemaVersion: number; basics?: { dateOfBirth?: string | null } };
type ImmunizationPayload = {
  schemaVersion: number;
  occurredOn: string;
  vaccineCodeSystem?: string;
  vaccineCode?: string;
};

@Injectable()
class PreventiveCareService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly contexts: PatientContextService,
    private readonly envelope: ClinicalEnvelopeService,
  ) {}

  async adminList() {
    const items = await this.prisma.preventiveCareRule.findMany({
      include: { versions: { orderBy: { version: "desc" } } },
      orderBy: { code: "asc" },
    });
    return {
      items: items.map((rule) => ({
        id: rule.id,
        code: rule.code,
        active: rule.active,
        versions: rule.versions.map((version) => this.presentVersion(version)),
      })),
      runtimeJurisdictionMode: "GLOBAL_ONLY_UNTIL_CANONICAL_PATIENT_JURISDICTION",
    };
  }

  async createRule(principal: AuthPrincipal, input: CreateRuleInput) {
    const code = this.code(input?.code);
    if (await this.prisma.preventiveCareRule.findUnique({ where: { code } })) {
      throw new ConflictException("Preventive-care rule code already exists.");
    }
    const row = await this.prisma.preventiveCareRule.create({ data: { code } });
    await this.audit.write({
      actorId: principal.accountId,
      action: "PREVENTIVE_CARE_RULE_CREATED",
      objectType: "PREVENTIVE_CARE_RULE",
      objectId: row.id,
      purpose: "CLINICAL_CONFIGURATION",
      result: "SUCCESS",
      metadata: { code, diagnosisInference: false },
    });
    return row;
  }

  async createVersion(principal: AuthPrincipal, ruleIdRaw: string, input: CreateVersionInput) {
    const ruleId = this.id(ruleIdRaw, "ruleId");
    const rule = await this.prisma.preventiveCareRule.findUnique({ where: { id: ruleId } });
    if (!rule) throw new NotFoundException("Preventive-care rule not found.");
    const data = this.versionInput(input);
    const aggregate = await this.prisma.preventiveCareRuleVersion.aggregate({
      where: { ruleId },
      _max: { version: true },
    });
    const version = (aggregate._max.version ?? 0) + 1;
    const row = await this.prisma.preventiveCareRuleVersion.create({
      data: {
        ruleId,
        version,
        status: "DRAFT",
        labels: data.labels as Prisma.InputJsonValue,
        descriptionLabels: data.descriptionLabels as Prisma.InputJsonValue,
        sourceLabels: data.sourceLabels as Prisma.InputJsonValue,
        sourceReference: data.sourceReference,
        jurisdiction: data.jurisdiction,
        triggerType: data.triggerType,
        minAgeYears: data.minAgeYears,
        maxAgeYears: data.maxAgeYears,
        vaccineCodeSystem: data.vaccineCodeSystem,
        vaccineCode: data.vaccineCode,
        intervalDays: data.intervalDays,
        allowDismiss: data.allowDismiss,
        allowPostpone: data.allowPostpone,
        maxPostponeDays: data.maxPostponeDays,
        createdByActorId: principal.accountId,
      },
    });
    await this.audit.write({
      actorId: principal.accountId,
      action: "PREVENTIVE_CARE_RULE_VERSION_CREATED",
      objectType: "PREVENTIVE_CARE_RULE_VERSION",
      objectId: row.id,
      purpose: "CLINICAL_CONFIGURATION",
      result: "SUCCESS",
      metadata: {
        ruleId,
        version,
        jurisdiction: data.jurisdiction,
        triggerType: data.triggerType,
        diagnosisInference: false,
      },
    });
    return this.presentVersion(row);
  }

  async publish(principal: AuthPrincipal, ruleIdRaw: string, versionRaw: string) {
    const ruleId = this.id(ruleIdRaw, "ruleId");
    const version = this.positiveInteger(versionRaw, "version");
    const row = await this.prisma.preventiveCareRuleVersion.findUnique({
      where: { ruleId_version: { ruleId, version } },
      include: { rule: true },
    });
    if (!row || !row.rule.active) throw new NotFoundException("Preventive-care rule version not found.");
    if (row.status === "PUBLISHED") return this.presentVersion(row);
    if (row.status !== "DRAFT") throw new ConflictException("Only DRAFT preventive-care versions can be published.");
    const now = new Date();
    const published = await this.prisma.$transaction(async (tx) => {
      await tx.preventiveCareRuleVersion.updateMany({
        where: { ruleId, status: "PUBLISHED" },
        data: { status: "RETIRED", retiredAt: now },
      });
      return tx.preventiveCareRuleVersion.update({
        where: { id: row.id },
        data: { status: "PUBLISHED", publishedAt: now, retiredAt: null },
      });
    });
    await this.audit.write({
      actorId: principal.accountId,
      action: "PREVENTIVE_CARE_RULE_VERSION_PUBLISHED",
      objectType: "PREVENTIVE_CARE_RULE_VERSION",
      objectId: published.id,
      purpose: "CLINICAL_CONFIGURATION",
      result: "SUCCESS",
      metadata: {
        ruleId,
        version,
        jurisdiction: published.jurisdiction,
        triggerType: published.triggerType,
        diagnosisInference: false,
      },
    });
    return this.presentVersion(published);
  }

  async patientList(principal: AuthPrincipal) {
    if (principal.role !== "PATIENT") throw new ForbiddenException("Patient account is required.");
    const context = await this.contexts.resolveEffectivePatient(principal, "CLINICAL_READ");
    const now = new Date();
    const versions = await this.prisma.preventiveCareRuleVersion.findMany({
      where: { status: "PUBLISHED", rule: { active: true } },
      include: { rule: { select: { id: true, code: true } } },
      orderBy: [{ rule: { code: "asc" } }, { version: "desc" }],
    });
    const global = versions.filter((version) => version.jurisdiction === "GLOBAL");
    const skippedJurisdiction = versions.length - global.length;

    const [dateOfBirth, immunizations] = await Promise.all([
      this.dateOfBirth(context.patientId),
      global.some((item) => item.triggerType === "IMMUNIZATION_INTERVAL")
        ? this.immunizations(context.patientId)
        : Promise.resolve([] as PreventiveImmunization[]),
    ]);
    const versionIds = global.map((item) => item.id);
    const actions = versionIds.length === 0
      ? []
      : await this.prisma.preventiveCareAction.findMany({
          where: { patientId: context.patientId, ruleVersionId: { in: versionIds } },
          orderBy: { createdAt: "desc" },
          take: 1000,
        });
    const latestAction = new Map<string, (typeof actions)[number]>();
    for (const action of actions) {
      if (!latestAction.has(action.ruleVersionId)) latestAction.set(action.ruleVersionId, action);
    }

    let skippedProfile = 0;
    let evaluated = 0;
    const items = [];
    for (const version of global) {
      const evaluation = evaluatePreventiveRule(
        this.trigger(version),
        dateOfBirth,
        immunizations,
        now,
      );
      if (evaluation.reason === "AGE_UNAVAILABLE") skippedProfile += 1;
      if (!evaluation.due) continue;
      evaluated += 1;
      const action = latestAction.get(version.id);
      if (action?.action === "DISMISSED") continue;
      if (action?.action === "POSTPONED" && action.postponedUntil && action.postponedUntil.getTime() > now.getTime()) {
        continue;
      }
      items.push({
        ruleId: version.rule.id,
        ruleVersionId: version.id,
        code: version.rule.code,
        version: version.version,
        labels: version.labels,
        descriptionLabels: version.descriptionLabels,
        sourceLabels: version.sourceLabels,
        sourceReference: version.sourceReference,
        jurisdiction: version.jurisdiction,
        triggerType: version.triggerType,
        allowDismiss: version.allowDismiss,
        allowPostpone: version.allowPostpone,
        maxPostponeDays: version.maxPostponeDays,
        evaluation,
        latestAction: action
          ? {
              action: action.action,
              postponedUntil: action.postponedUntil,
              createdAt: action.createdAt,
            }
          : null,
      });
    }

    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "PREVENTIVE_CARE_LIST_READ",
      objectType: "PATIENT",
      objectId: context.patientId,
      purpose: context.mode === "DEPENDENT" ? "PROXY_PATIENT_ACCESS" : "PATIENT_ACCESS",
      result: "SUCCESS",
      metadata: {
        domain: "PREVENTIVE_CARE",
        patientId: context.patientId,
        dueItemCount: items.length,
        evaluatedDueCount: evaluated,
        skippedJurisdiction,
        skippedProfile,
        diagnosisInference: false,
        decision: "ALLOW",
      },
    });
    return {
      patientId: context.patientId,
      mode: context.mode,
      generatedAt: now,
      items,
      evaluation: {
        jurisdictionMode: "GLOBAL_ONLY_UNTIL_CANONICAL_PATIENT_JURISDICTION",
        skippedJurisdiction,
        skippedProfile,
        diagnosisInference: false,
      },
    };
  }

  async patientAction(principal: AuthPrincipal, ruleVersionIdRaw: string, input: PatientActionInput) {
    if (principal.role !== "PATIENT") throw new ForbiddenException("Patient account is required.");
    const context = await this.contexts.resolveEffectivePatient(principal, "CLINICAL_WRITE");
    const ruleVersionId = this.id(ruleVersionIdRaw, "ruleVersionId");
    const action = String(input?.action ?? "").trim().toUpperCase();
    if (!ACTIONS.has(action)) throw new BadRequestException("action must be DISMISSED or POSTPONED.");
    const version = await this.prisma.preventiveCareRuleVersion.findUnique({
      where: { id: ruleVersionId },
      include: { rule: true },
    });
    if (!version || !version.rule.active || version.status !== "PUBLISHED") {
      throw new NotFoundException("Published preventive-care rule version not found.");
    }
    if (version.jurisdiction !== "GLOBAL") {
      throw new ConflictException("This jurisdiction-specific rule is not active until patient jurisdiction is canonical.");
    }
    if (action === "DISMISSED" && !version.allowDismiss) throw new ConflictException("This reminder cannot be dismissed.");
    if (action === "POSTPONED" && !version.allowPostpone) throw new ConflictException("This reminder cannot be postponed.");

    let postponedUntil: Date | null = null;
    if (action === "POSTPONED") {
      if (typeof input?.postponedUntil !== "string") throw new BadRequestException("postponedUntil is required.");
      postponedUntil = new Date(input.postponedUntil);
      if (!Number.isFinite(postponedUntil.getTime()) || postponedUntil.getTime() <= Date.now()) {
        throw new BadRequestException("postponedUntil must be a future ISO date-time.");
      }
      const max = Date.now() + version.maxPostponeDays * 86_400_000;
      if (postponedUntil.getTime() > max) throw new BadRequestException("postponedUntil exceeds this rule's maximum.");
    }
    const idempotencyKey = this.idempotency(input?.idempotencyKey);
    const requestDigest = createHash("sha256").update(JSON.stringify({
      patientId: context.patientId,
      ruleVersionId,
      action,
      postponedUntil: postponedUntil?.toISOString() ?? null,
    })).digest("hex");
    const replay = await this.prisma.preventiveCareAction.findUnique({
      where: { patientId_idempotencyKey: { patientId: context.patientId, idempotencyKey } },
    });
    if (replay) {
      if (replay.requestDigest !== requestDigest) throw new ConflictException("idempotencyKey is bound to another preventive-care action.");
      return this.presentAction(replay);
    }

    const created = await this.prisma.preventiveCareAction.create({
      data: {
        patientId: context.patientId,
        actorAccountId: principal.accountId,
        ruleVersionId,
        action,
        postponedUntil,
        idempotencyKey,
        requestDigest,
      },
    });
    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: `PREVENTIVE_CARE_${action}`,
      objectType: "PREVENTIVE_CARE_RULE_VERSION",
      objectId: ruleVersionId,
      purpose: context.mode === "DEPENDENT" ? "PROXY_PATIENT_ACCESS" : "PATIENT_ACCESS",
      result: "SUCCESS",
      metadata: {
        domain: "PREVENTIVE_CARE",
        patientId: context.patientId,
        resourceId: ruleVersionId,
        ruleCode: version.rule.code,
        ruleVersion: version.version,
        action,
        ...(postponedUntil ? { postponedUntil: postponedUntil.toISOString() } : {}),
        diagnosisInference: false,
        decision: "ALLOW",
      },
    });
    return this.presentAction(created);
  }

  private async dateOfBirth(patientId: string) {
    const profile = await this.prisma.patientHealthProfile.findUnique({ where: { patientId } });
    if (!profile) return null;
    const payload = await this.envelope.decryptRecord<HealthPayload>({
      version: 1,
      algorithm: profile.algorithm as "AES-256-GCM",
      keyId: profile.keyId,
      wrappedKey: profile.wrappedKey,
      iv: profile.iv,
      ciphertext: profile.ciphertext,
    });
    return payload.basics?.dateOfBirth ?? null;
  }

  private async immunizations(patientId: string): Promise<PreventiveImmunization[]> {
    const rows = await this.prisma.immunization.findMany({
      where: { patientId, status: "COMPLETED" },
      orderBy: { occurredOn: "desc" },
      take: 500,
    });
    const items: PreventiveImmunization[] = [];
    for (const row of rows) {
      const payload = await this.envelope.decryptRecord<ImmunizationPayload>({
        version: 1,
        algorithm: row.algorithm as "AES-256-GCM",
        keyId: row.keyId,
        wrappedKey: row.wrappedKey,
        iv: row.iv,
        ciphertext: row.ciphertext,
      });
      items.push({
        occurredOn: payload.occurredOn,
        vaccineCodeSystem: payload.vaccineCodeSystem ?? null,
        vaccineCode: payload.vaccineCode ?? null,
      });
    }
    return items;
  }

  private trigger(version: {
    triggerType: string;
    minAgeYears: number | null;
    maxAgeYears: number | null;
    vaccineCodeSystem: string | null;
    vaccineCode: string | null;
    intervalDays: number | null;
  }): PreventiveTrigger {
    return {
      triggerType: version.triggerType as PreventiveTrigger["triggerType"],
      minAgeYears: version.minAgeYears,
      maxAgeYears: version.maxAgeYears,
      vaccineCodeSystem: version.vaccineCodeSystem,
      vaccineCode: version.vaccineCode,
      intervalDays: version.intervalDays,
    };
  }

  private versionInput(input: CreateVersionInput) {
    const triggerType = String(input?.triggerType ?? "").trim().toUpperCase();
    if (!TRIGGERS.has(triggerType)) throw new BadRequestException("triggerType must be AGE_WINDOW or IMMUNIZATION_INTERVAL.");
    const minAgeYears = this.optionalInteger(input?.minAgeYears, 0, 130, "minAgeYears");
    const maxAgeYears = this.optionalInteger(input?.maxAgeYears, 0, 130, "maxAgeYears");
    if (minAgeYears != null && maxAgeYears != null && minAgeYears > maxAgeYears) {
      throw new BadRequestException("minAgeYears cannot exceed maxAgeYears.");
    }
    if (triggerType === "AGE_WINDOW" && minAgeYears == null && maxAgeYears == null) {
      throw new BadRequestException("AGE_WINDOW requires minAgeYears and/or maxAgeYears.");
    }
    const vaccineCodeSystem = this.optionalText(input?.vaccineCodeSystem, 160);
    const vaccineCode = this.optionalCode(input?.vaccineCode);
    const intervalDays = this.optionalInteger(input?.intervalDays, 1, 36500, "intervalDays");
    if (triggerType === "IMMUNIZATION_INTERVAL" && (!vaccineCodeSystem || !vaccineCode || intervalDays == null)) {
      throw new BadRequestException("IMMUNIZATION_INTERVAL requires vaccineCodeSystem, vaccineCode, and intervalDays.");
    }
    const jurisdiction = String(input?.jurisdiction ?? "GLOBAL").trim().toUpperCase();
    if (!/^(GLOBAL|[A-Z]{2})$/.test(jurisdiction)) throw new BadRequestException("jurisdiction must be GLOBAL or ISO alpha-2.");
    const allowDismiss = this.boolean(input?.allowDismiss, true, "allowDismiss");
    const allowPostpone = this.boolean(input?.allowPostpone, true, "allowPostpone");
    const maxPostponeDays = this.integer(input?.maxPostponeDays ?? 365, 1, 3650, "maxPostponeDays");
    return {
      labels: this.localized(input?.labels, "labels", 120),
      descriptionLabels: this.localized(input?.descriptionLabels, "descriptionLabels", 600),
      sourceLabels: this.localized(input?.sourceLabels, "sourceLabels", 160),
      sourceReference: this.text(input?.sourceReference, "sourceReference", 300),
      jurisdiction,
      triggerType,
      minAgeYears,
      maxAgeYears,
      vaccineCodeSystem: triggerType === "IMMUNIZATION_INTERVAL" ? vaccineCodeSystem : null,
      vaccineCode: triggerType === "IMMUNIZATION_INTERVAL" ? vaccineCode : null,
      intervalDays: triggerType === "IMMUNIZATION_INTERVAL" ? intervalDays : null,
      allowDismiss,
      allowPostpone,
      maxPostponeDays,
    };
  }

  private localized(raw: unknown, field: string, max: number) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new BadRequestException(`${field} must be localized.`);
    const value = raw as Record<string, unknown>;
    const result: Record<string, string> = {};
    for (const locale of REQUIRED_LOCALES) result[locale] = this.text(value[locale], `${field}.${locale}`, max);
    return result;
  }

  private code(value: unknown) {
    if (typeof value !== "string") throw new BadRequestException("code is required.");
    const normalized = value.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_:-]{2,79}$/.test(normalized)) throw new BadRequestException("code is invalid.");
    return normalized;
  }

  private optionalCode(value: unknown) {
    if (value == null || value === "") return null;
    if (typeof value !== "string") throw new BadRequestException("vaccineCode is invalid.");
    const normalized = value.trim();
    if (normalized.length < 1 || normalized.length > 120 || /\p{Cc}/u.test(normalized)) throw new BadRequestException("vaccineCode is invalid.");
    return normalized;
  }

  private text(value: unknown, field: string, max: number) {
    if (typeof value !== "string") throw new BadRequestException(`${field} is required.`);
    const normalized = value.trim();
    if (!normalized || normalized.length > max || /\p{Cc}/u.test(normalized)) throw new BadRequestException(`${field} is invalid.`);
    return normalized;
  }

  private optionalText(value: unknown, max: number) {
    if (value == null || value === "") return null;
    if (typeof value !== "string") throw new BadRequestException("Text value is invalid.");
    const normalized = value.trim();
    if (!normalized || normalized.length > max || /\p{Cc}/u.test(normalized)) throw new BadRequestException("Text value is invalid.");
    return normalized;
  }

  private integer(value: unknown, min: number, max: number, field: string) {
    if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) throw new BadRequestException(`${field} must be between ${min} and ${max}.`);
    return Number(value);
  }

  private optionalInteger(value: unknown, min: number, max: number, field: string) {
    if (value == null || value === "") return null;
    return this.integer(value, min, max, field);
  }

  private boolean(value: unknown, fallback: boolean, field: string) {
    if (value == null) return fallback;
    if (typeof value !== "boolean") throw new BadRequestException(`${field} must be boolean.`);
    return value;
  }

  private id(value: unknown, field: string) {
    if (typeof value !== "string" || !/^[A-Za-z0-9_.:-]{1,180}$/.test(value.trim())) throw new BadRequestException(`${field} is invalid.`);
    return value.trim();
  }

  private idempotency(value: unknown) {
    if (typeof value !== "string") throw new BadRequestException("idempotencyKey is required.");
    const normalized = value.trim();
    if (normalized.length < 8 || normalized.length > 128 || /\p{Cc}/u.test(normalized)) throw new BadRequestException("idempotencyKey is invalid.");
    return normalized;
  }

  private positiveInteger(value: unknown, field: string) {
    const parsed = typeof value === "string" ? Number(value) : value;
    if (!Number.isInteger(parsed) || Number(parsed) < 1) throw new BadRequestException(`${field} must be a positive integer.`);
    return Number(parsed);
  }

  private presentVersion(row: {
    id: string; ruleId: string; version: number; status: string; labels: Prisma.JsonValue;
    descriptionLabels: Prisma.JsonValue; sourceLabels: Prisma.JsonValue; sourceReference: string;
    jurisdiction: string; triggerType: string; minAgeYears: number | null; maxAgeYears: number | null;
    vaccineCodeSystem: string | null; vaccineCode: string | null; intervalDays: number | null;
    allowDismiss: boolean; allowPostpone: boolean; maxPostponeDays: number;
    publishedAt: Date | null; retiredAt: Date | null; createdAt: Date;
  }) {
    if (!STATUSES.has(row.status)) throw new ConflictException("Preventive-care rule status is invalid.");
    return {
      id: row.id, ruleId: row.ruleId, version: row.version, status: row.status,
      labels: row.labels, descriptionLabels: row.descriptionLabels, sourceLabels: row.sourceLabels,
      sourceReference: row.sourceReference, jurisdiction: row.jurisdiction, triggerType: row.triggerType,
      minAgeYears: row.minAgeYears, maxAgeYears: row.maxAgeYears,
      vaccineCodeSystem: row.vaccineCodeSystem, vaccineCode: row.vaccineCode, intervalDays: row.intervalDays,
      allowDismiss: row.allowDismiss, allowPostpone: row.allowPostpone, maxPostponeDays: row.maxPostponeDays,
      publishedAt: row.publishedAt, retiredAt: row.retiredAt, createdAt: row.createdAt,
      diagnosisInference: false,
    };
  }

  private presentAction(row: {
    id: string; patientId: string; ruleVersionId: string; action: string;
    postponedUntil: Date | null; createdAt: Date;
  }) {
    return {
      id: row.id,
      patientId: row.patientId,
      ruleVersionId: row.ruleVersionId,
      action: row.action,
      postponedUntil: row.postponedUntil,
      createdAt: row.createdAt,
    };
  }
}

@Controller("admin/preventive-care/rules")
class AdminPreventiveCareController {
  constructor(private readonly preventive: PreventiveCareService) {}

  @RequirePermissions("CATALOG_MANAGE")
  @Get()
  list() { return this.preventive.adminList(); }

  @RequirePermissions("CATALOG_MANAGE")
  @Post()
  create(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: CreateRuleInput) {
    return this.preventive.createRule(principal, body ?? {});
  }

  @RequirePermissions("CATALOG_MANAGE")
  @Post(":ruleId/versions")
  version(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("ruleId") ruleId: string,
    @Body() body: CreateVersionInput,
  ) {
    return this.preventive.createVersion(principal, ruleId, body ?? {});
  }

  @RequirePermissions("CATALOG_MANAGE")
  @Post(":ruleId/versions/:version/publish")
  publish(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("ruleId") ruleId: string,
    @Param("version") version: string,
  ) {
    return this.preventive.publish(principal, ruleId, version);
  }
}

@Controller("patient/preventive-care")
class PatientPreventiveCareController {
  constructor(private readonly preventive: PreventiveCareService) {}

  @RequirePermissions("PATIENT_READ_HEALTH_PROFILE")
  @Get()
  @Header("Cache-Control", "no-store")
  list(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.preventive.patientList(principal);
  }

  @RequirePermissions("PATIENT_MANAGE_CLINICAL_PROFILE")
  @Post(":ruleVersionId/actions")
  @Header("Cache-Control", "no-store")
  action(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("ruleVersionId") ruleVersionId: string,
    @Body() body: PatientActionInput,
  ) {
    return this.preventive.patientAction(principal, ruleVersionId, body ?? {});
  }
}

@Module({
  imports: [DependentsModule, ClinicalModule],
  controllers: [AdminPreventiveCareController, PatientPreventiveCareController],
  providers: [PreventiveCareService],
})
export class PreventiveCareModule {}
