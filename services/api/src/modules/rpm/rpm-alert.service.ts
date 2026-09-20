import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { AuthPrincipal } from "@carepoint/identity";
import type { EncryptedEnvelope } from "@carepoint/security";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { ClinicalEnvelopeService } from "../clinical/clinical-envelope.service";
import {
  assertRuleAllowedByPolicy,
  evaluateAlertRule,
  nextAlertStatus,
  normalizeAlertPolicyConfig,
  normalizeAlertRuleConfig,
  normalizeAlertRuleStatus,
  normalizeAlertSeverity,
  normalizeAlertWorkflowAction,
  normalizePatientActionKey,
  normalizeReasonCode,
  type AlertPolicyConfig,
  type AlertRuleConfig,
} from "./rpm-alert.engine";

const CARE_PLAN_CONSENT_VERSION = "care-plan-v1";
const TREATMENT_LOOKBACK_DAYS = 365;
const TREATMENT_LOOKAHEAD_DAYS = 30;
const MAX_INBOX = 200;

type Labels = { en: string; ar?: string; fr?: string; es?: string };
type EnvelopeRow = { algorithm: string; keyId: string; wrappedKey: string; iv: string; ciphertext: string };
type StoredObservation = {
  schemaVersion: 1;
  metricCode: string;
  metricVersion: number;
  originalValue: number;
  originalUnitCode: string;
  canonicalValue: number;
  canonicalUnitCode: string;
};

export interface CreateAlertPolicyInput { code: string; labels: Labels; }
export interface CreateAlertPolicyVersionInput { config: unknown; }
export interface CreateAlertRuleInput {
  policyVersionId: string;
  metricCode: string;
  severity: string;
  patientActionKey: string;
  effectiveFrom: string;
  effectiveUntil?: string | null;
  rule: unknown;
}
export interface UpdateAlertRuleInput {
  expectedVersion: number;
  status?: string;
  severity?: string;
  patientActionKey?: string;
  effectiveUntil?: string | null;
  reasonCode?: string | null;
  rule?: unknown;
}
export interface AlertActionInput { action: string; reasonCode?: string | null; }

@Injectable()
export class RpmAlertService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly envelope: ClinicalEnvelopeService,
  ) {}

  async adminPolicies() {
    return this.prisma.alertPolicy.findMany({
      include: { versions: { orderBy: { version: "desc" } } },
      orderBy: { code: "asc" },
    });
  }

  async createPolicy(principal: AuthPrincipal, input: CreateAlertPolicyInput) {
    const code = this.token(input?.code, "code");
    const labels = this.labels(input?.labels);
    return this.prisma.alertPolicy.create({
      data: { code, labels: labels as unknown as Prisma.InputJsonValue },
    });
  }

  async createPolicyVersion(principal: AuthPrincipal, policyId: string, input: CreateAlertPolicyVersionInput) {
    const id = this.id(policyId, "policyId");
    const config = normalizeAlertPolicyConfig(input?.config);
    for (const code of config.metricCodes) {
      const metric = await this.prisma.observationType.findUnique({ where: { code }, select: { active: true } });
      if (!metric?.active) throw new BadRequestException(`Active ObservationType required for ${code}.`);
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "AlertPolicy" WHERE id = ${id} FOR UPDATE`);
      const policy = await tx.alertPolicy.findUnique({ where: { id } });
      if (!policy?.active) throw new NotFoundException("Active alert policy not found.");
      const latest = await tx.alertPolicyVersion.findFirst({ where: { policyId: id }, orderBy: { version: "desc" }, select: { version: true } });
      return tx.alertPolicyVersion.create({
        data: {
          policyId: id,
          version: (latest?.version ?? 0) + 1,
          status: "DRAFT",
          config: config as unknown as Prisma.InputJsonValue,
          createdByActorId: principal.accountId,
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async activatePolicyVersion(principal: AuthPrincipal, policyId: string, version: number) {
    const id = this.id(policyId, "policyId");
    if (!Number.isInteger(version) || version < 1) throw new BadRequestException("version must be a positive integer.");
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "AlertPolicy" WHERE id = ${id} FOR UPDATE`);
      const target = await tx.alertPolicyVersion.findUnique({ where: { policyId_version: { policyId: id, version } } });
      if (!target) throw new NotFoundException("Alert policy version not found.");
      if (target.status === "ACTIVE") return target;
      if (target.status !== "DRAFT") throw new ConflictException("Only a DRAFT alert policy version can be activated.");
      const now = new Date();
      await tx.alertPolicyVersion.updateMany({ where: { policyId: id, status: "ACTIVE" }, data: { status: "RETIRED", retiredAt: now } });
      const active = await tx.alertPolicyVersion.update({ where: { id: target.id }, data: { status: "ACTIVE", activatedAt: now, retiredAt: null } });
      await this.audit.writeClinicalInTransaction(tx, {
        actorId: principal.accountId,
        action: "ALERT_POLICY_ACTIVATED",
        objectType: "ALERT_POLICY_VERSION",
        objectId: active.id,
        purpose: "CLINICAL_CONFIGURATION",
        result: "SUCCESS",
        metadata: { domain: "RPM", resourceId: active.id, resourceVersion: active.version, decision: "ALLOW" },
      });
      return active;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async createRule(principal: AuthPrincipal, carePlanId: string, input: CreateAlertRuleInput) {
    const access = await this.requireOwnedCarePlan(principal, carePlanId, "WRITE");
    const policy = await this.activePolicyVersion(this.id(input?.policyVersionId, "policyVersionId"));
    const metricCode = this.token(input?.metricCode, "metricCode");
    const severity = normalizeAlertSeverity(input?.severity);
    const patientActionKey = normalizePatientActionKey(input?.patientActionKey);
    const config = normalizeAlertRuleConfig(input?.rule);
    assertRuleAllowedByPolicy(policy.config, { metricCode, severity, patientActionKey, config });
    const metric = await this.prisma.observationType.findUnique({ where: { code: metricCode }, select: { active: true } });
    if (!metric?.active) throw new BadRequestException("Active ObservationType is required.");
    const effectiveFrom = this.iso(input?.effectiveFrom, "effectiveFrom");
    const effectiveUntil = this.isoOptional(input?.effectiveUntil, "effectiveUntil");
    if (effectiveUntil && effectiveUntil <= effectiveFrom) throw new BadRequestException("effectiveUntil must be after effectiveFrom.");
    const encrypted = await this.envelope.encryptRecord({ schemaVersion: 1, ...config });
    return this.prisma.$transaction(async (tx) => {
      const rule = await tx.carePlanAlertRule.create({
        data: {
          carePlanId: access.plan.id,
          patientId: access.plan.patientId,
          ownerProviderId: access.provider.id,
          policyVersionId: policy.id,
          metricCode,
          severity,
          patientActionKey,
          status: "ACTIVE",
          version: 1,
          effectiveFrom,
          ...(effectiveUntil ? { effectiveUntil } : {}),
          createdByActorId: principal.accountId,
          ...this.envelopeData(encrypted),
        },
      });
      await tx.carePlanAlertRuleRevision.create({
        data: {
          ruleId: rule.id,
          version: 1,
          policyVersionId: policy.id,
          severity,
          patientActionKey,
          status: "ACTIVE",
          effectiveFrom,
          ...(effectiveUntil ? { effectiveUntil } : {}),
          authorActorId: principal.accountId,
          ...this.envelopeData(encrypted),
        },
      });
      await this.audit.writeClinicalInTransaction(tx, {
        actorId: principal.accountId,
        action: "CARE_PLAN_ALERT_RULE_CREATED",
        objectType: "CARE_PLAN_ALERT_RULE",
        objectId: rule.id,
        purpose: "TREATMENT",
        result: "SUCCESS",
        metadata: { domain: "RPM", patientId: access.plan.patientId, providerId: access.provider.id, resourceId: rule.id, resourceVersion: 1, decision: "ALLOW" },
      });
      return this.presentRule(rule, config);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async listRules(principal: AuthPrincipal, carePlanId: string) {
    const access = await this.requireOwnedCarePlan(principal, carePlanId, "READ");
    const rows = await this.prisma.carePlanAlertRule.findMany({ where: { carePlanId: access.plan.id }, orderBy: { createdAt: "asc" }, take: 100 });
    const items = [];
    for (const row of rows) items.push(this.presentRule(row, await this.decryptRule(row)));
    return { carePlanId: access.plan.id, patientId: access.plan.patientId, items };
  }

  async updateRule(principal: AuthPrincipal, carePlanId: string, ruleId: string, input: UpdateAlertRuleInput) {
    const access = await this.requireOwnedCarePlan(principal, carePlanId, "WRITE");
    const row = await this.prisma.carePlanAlertRule.findFirst({ where: { id: ruleId, carePlanId: access.plan.id } });
    if (!row) throw new NotFoundException("Care Plan alert rule not found.");
    const expectedVersion = this.positiveInteger(input?.expectedVersion, "expectedVersion");
    if (row.version !== expectedVersion) throw new ConflictException({ message: "Alert rule version conflict.", currentVersion: row.version });
    const policy = await this.activePolicyVersion(row.policyVersionId);
    const currentConfig = await this.decryptRule(row);
    const config = input?.rule === undefined ? currentConfig : normalizeAlertRuleConfig(input.rule);
    const severity = input?.severity === undefined ? normalizeAlertSeverity(row.severity) : normalizeAlertSeverity(input.severity);
    const patientActionKey = input?.patientActionKey === undefined ? row.patientActionKey : normalizePatientActionKey(input.patientActionKey);
    const status = input?.status === undefined ? row.status : normalizeAlertRuleStatus(input.status);
    const effectiveUntil = input?.effectiveUntil === undefined ? row.effectiveUntil : this.isoOptional(input.effectiveUntil, "effectiveUntil");
    assertRuleAllowedByPolicy(policy.config, { metricCode: row.metricCode, severity, patientActionKey, config });
    const encrypted = await this.envelope.encryptRecord({ schemaVersion: 1, ...config });
    const reasonCode = normalizeReasonCode(input?.reasonCode);
    const nextVersion = expectedVersion + 1;
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "CarePlanAlertRule" WHERE id = ${row.id} FOR UPDATE`);
      const current = await tx.carePlanAlertRule.findUnique({ where: { id: row.id } });
      if (!current || current.version !== expectedVersion) throw new ConflictException({ message: "Alert rule version conflict.", currentVersion: current?.version ?? null });
      const rule = await tx.carePlanAlertRule.update({
        where: { id: row.id },
        data: { version: nextVersion, severity, patientActionKey, status, effectiveUntil, ...this.envelopeData(encrypted) },
      });
      await tx.carePlanAlertRuleRevision.create({
        data: {
          ruleId: rule.id,
          version: nextVersion,
          policyVersionId: rule.policyVersionId,
          severity,
          patientActionKey,
          status,
          effectiveFrom: rule.effectiveFrom,
          effectiveUntil,
          authorActorId: principal.accountId,
          ...(reasonCode ? { reasonCode } : {}),
          ...this.envelopeData(encrypted),
        },
      });
      return rule;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return this.presentRule(updated, config);
  }

  async evaluateObservation(observationId: string) {
    const id = this.id(observationId, "observationId");
    const observation = await this.prisma.observation.findUnique({
      where: { id },
      include: { observationType: { select: { code: true } } },
    });
    if (!observation) throw new NotFoundException("Observation not found.");
    const payload = await this.decryptObservation(observation);
    const now = observation.observedAt;
    const rules = await this.prisma.carePlanAlertRule.findMany({
      where: {
        patientId: observation.patientId,
        metricCode: observation.observationType.code,
        status: "ACTIVE",
        effectiveFrom: { lte: now },
        AND: [{ OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: now } }] }],
      },
      orderBy: { createdAt: "asc" },
      take: 100,
    });
    const created = [];
    for (const rule of rules) {
      let policy: { id: string; config: AlertPolicyConfig };
      try { policy = await this.activePolicyVersion(rule.policyVersionId); } catch { continue; }
      const config = await this.decryptRule(rule);
      try {
        assertRuleAllowedByPolicy(policy.config, {
          metricCode: rule.metricCode,
          severity: normalizeAlertSeverity(rule.severity),
          patientActionKey: rule.patientActionKey,
          config,
        });
      } catch { continue; }
      if (!evaluateAlertRule(payload.canonicalValue, config)) continue;
      try {
        const alert = await this.prisma.clinicalAlert.create({
          data: {
            patientId: rule.patientId,
            carePlanId: rule.carePlanId,
            ownerProviderId: rule.ownerProviderId,
            ruleId: rule.id,
            ruleVersion: rule.version,
            sourceObservationId: observation.id,
            metricCode: rule.metricCode,
            severity: rule.severity,
            patientActionKey: rule.patientActionKey,
            status: "OPEN",
          },
        });
        await this.audit.writeClinical({
          action: "CLINICAL_ALERT_CREATED",
          objectType: "CLINICAL_ALERT",
          objectId: alert.id,
          purpose: "CLINICAL_MONITORING",
          result: "SUCCESS",
          metadata: { domain: "RPM", patientId: alert.patientId, providerId: alert.ownerProviderId, resourceId: alert.id, resourceVersion: alert.ruleVersion, sourceId: observation.id, decision: "ALLOW" },
        });
        created.push(alert.id);
      } catch (error) {
        if (!this.isUniqueConflict(error)) throw error;
      }
    }
    return { observationId: observation.id, evaluatedRules: rules.length, createdAlertIds: created, automatedDiagnosis: false };
  }

  async providerInbox(principal: AuthPrincipal, severity?: string) {
    const provider = await this.requireDoctor(principal);
    const normalizedSeverity = severity?.trim() ? normalizeAlertSeverity(severity) : undefined;
    const rows = await this.prisma.clinicalAlert.findMany({
      where: { ownerProviderId: provider.id, status: { not: "RESOLVED" }, ...(normalizedSeverity ? { severity: normalizedSeverity } : {}) },
      orderBy: [{ severity: "desc" }, { createdAt: "asc" }],
      take: MAX_INBOX,
    });
    const items = [];
    for (const row of rows) {
      if (await this.currentDoctorReadAccess(provider.id, row.patientId)) items.push(this.providerAlert(row));
    }
    return { providerId: provider.id, items };
  }

  async act(principal: AuthPrincipal, alertId: string, input: AlertActionInput) {
    const provider = await this.requireDoctor(principal);
    const id = this.id(alertId, "alertId");
    const alert = await this.prisma.clinicalAlert.findUnique({ where: { id } });
    if (!alert || alert.ownerProviderId !== provider.id) throw new NotFoundException("Clinical alert not found.");
    if (!(await this.currentDoctorReadAccess(provider.id, alert.patientId))) throw new ForbiddenException("Clinical alert access denied.");
    const action = normalizeAlertWorkflowAction(input?.action);
    if (action === "VIEWED") throw new BadRequestException("VIEWED is reserved for the patient projection.");
    const reasonCode = normalizeReasonCode(input?.reasonCode, action === "RESOLVE" || action === "ESCALATE");
    const nextStatus = nextAlertStatus(alert.status, action);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "ClinicalAlert" WHERE id = ${id} FOR UPDATE`);
      const current = await tx.clinicalAlert.findUnique({ where: { id } });
      if (!current || current.ownerProviderId !== provider.id) throw new ConflictException("Clinical alert changed.");
      const changedAt = new Date();
      const updated = await tx.clinicalAlert.update({
        where: { id },
        data: {
          status: nextStatus,
          ...(action === "ASSIGN" ? { assigneeProviderId: provider.id } : {}),
          ...(action === "ACKNOWLEDGE" || action === "ASSIGN" ? { acknowledgedAt: current.acknowledgedAt ?? changedAt } : {}),
          ...(action === "RESOLVE" ? { resolvedAt: changedAt } : {}),
        },
      });
      await tx.clinicalAlertAction.create({
        data: { alertId: id, action, actorId: principal.accountId, actorRole: principal.role, ...(reasonCode ? { reasonCode } : {}) },
      });
      await this.audit.writeClinicalInTransaction(tx, {
        actorId: principal.accountId,
        action: `CLINICAL_ALERT_${action}`,
        objectType: "CLINICAL_ALERT",
        objectId: id,
        purpose: "CLINICAL_MONITORING",
        result: "SUCCESS",
        metadata: { domain: "RPM", patientId: alert.patientId, providerId: provider.id, resourceId: id, decision: "ALLOW" },
      });
      return this.providerAlert(updated);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async patientAlerts(principal: AuthPrincipal) {
    const patient = await this.requirePatient(principal);
    const rows = await this.prisma.clinicalAlert.findMany({ where: { patientId: patient.id }, orderBy: { createdAt: "desc" }, take: 100 });
    const items = [];
    for (const row of rows) {
      const viewed = await this.prisma.clinicalAlertAction.findFirst({ where: { alertId: row.id, actorId: principal.accountId, action: "VIEWED" }, select: { id: true } });
      items.push(this.patientAlert(row, Boolean(viewed)));
    }
    return { patientId: patient.id, items };
  }

  async markPatientViewed(principal: AuthPrincipal, alertId: string) {
    const patient = await this.requirePatient(principal);
    const id = this.id(alertId, "alertId");
    const alert = await this.prisma.clinicalAlert.findFirst({ where: { id, patientId: patient.id } });
    if (!alert) throw new NotFoundException("Clinical alert not found.");
    const existing = await this.prisma.clinicalAlertAction.findFirst({ where: { alertId: id, actorId: principal.accountId, action: "VIEWED" } });
    if (!existing) await this.prisma.clinicalAlertAction.create({ data: { alertId: id, action: "VIEWED", actorId: principal.accountId, actorRole: principal.role } });
    return this.patientAlert(alert, true);
  }

  async adminDashboard() {
    const [open, acknowledged, escalated, resolved, critical] = await Promise.all([
      this.prisma.clinicalAlert.count({ where: { status: "OPEN" } }),
      this.prisma.clinicalAlert.count({ where: { status: "ACKNOWLEDGED" } }),
      this.prisma.clinicalAlert.count({ where: { status: "ESCALATED" } }),
      this.prisma.clinicalAlert.count({ where: { status: "RESOLVED" } }),
      this.prisma.clinicalAlert.count({ where: { status: { not: "RESOLVED" }, severity: "CRITICAL" } }),
    ]);
    return { aggregateOnly: true, counts: { open, acknowledged, escalated, resolved, criticalOpen: critical } };
  }

  async adminQueue() {
    const rows = await this.prisma.clinicalAlert.findMany({ where: { status: { not: "RESOLVED" } }, orderBy: [{ severity: "desc" }, { createdAt: "asc" }], take: MAX_INBOX });
    return {
      items: rows.map((row) => ({
        id: row.id,
        severity: row.severity,
        status: row.status,
        metricCode: row.metricCode,
        ownerProviderId: row.ownerProviderId,
        assigneeProviderId: row.assigneeProviderId,
        createdAt: row.createdAt,
        patientIdentityIncluded: false,
      })),
    };
  }

  private async activePolicyVersion(id: string): Promise<{ id: string; config: AlertPolicyConfig }> {
    const row = await this.prisma.alertPolicyVersion.findUnique({ where: { id }, include: { policy: true } });
    if (!row || row.status !== "ACTIVE" || !row.policy.active) throw new ConflictException("Active alert policy version is required.");
    return { id: row.id, config: normalizeAlertPolicyConfig(row.config) };
  }

  private async requireOwnedCarePlan(principal: AuthPrincipal, carePlanId: string, action: "READ" | "WRITE") {
    const provider = await this.requireDoctor(principal);
    const plan = await this.prisma.carePlan.findUnique({ where: { id: this.id(carePlanId, "carePlanId") } });
    if (!plan || plan.ownerProviderId !== provider.id) throw new NotFoundException("Owned Care Plan not found.");
    if (!(await this.currentDoctorAccess(provider.id, plan.patientId, action))) throw new ForbiddenException("Care Plan alert-rule access denied.");
    return { provider, plan };
  }

  private async requireDoctor(principal: AuthPrincipal) {
    if (principal.role !== "DOCTOR") throw new ForbiddenException("RPM clinician access requires DOCTOR role.");
    const provider = await this.prisma.provider.findUnique({ where: { userId: principal.accountId }, select: { id: true, class: true, status: true } });
    if (!provider || provider.class !== "DOCTOR" || provider.status !== "ACTIVE") throw new ForbiddenException("An active doctor provider profile is required.");
    return provider;
  }

  private currentDoctorReadAccess(providerId: string, patientId: string) {
    return this.currentDoctorAccess(providerId, patientId, "READ");
  }

  private async currentDoctorAccess(providerId: string, patientId: string, action: "READ" | "WRITE") {
    const now = new Date();
    const from = new Date(now.getTime() - TREATMENT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const to = new Date(now.getTime() + TREATMENT_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);
    const scopes = action === "WRITE" ? ["CARE_PLAN_WRITE"] : ["CARE_PLAN_READ", "CARE_PLAN_WRITE"];
    const [relationship, consent] = await Promise.all([
      this.prisma.appointment.findFirst({ where: { providerId, patientId, status: { in: ["CONFIRMED", "COMPLETED"] }, startsAt: { gte: from, lte: to } }, select: { id: true } }),
      this.prisma.consent.findFirst({ where: { patientId, scope: { in: scopes }, version: CARE_PLAN_CONSENT_VERSION, purpose: "TREATMENT", state: "GRANTED", AND: [{ OR: [{ providerId }, { providerId: null }] }, { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }] }, select: { id: true } }),
    ]);
    return Boolean(relationship && consent);
  }

  private async requirePatient(principal: AuthPrincipal) {
    if (principal.role !== "PATIENT") throw new ForbiddenException("Patient RPM access requires PATIENT role.");
    const patient = await this.prisma.patientProfile.findUnique({ where: { userId: principal.accountId }, select: { id: true } });
    if (!patient) throw new NotFoundException("Patient profile not found.");
    return patient;
  }

  private async decryptRule(row: EnvelopeRow): Promise<AlertRuleConfig> {
    const raw = await this.envelope.decryptRecord<Record<string, unknown>>({ version: 1, algorithm: row.algorithm as "AES-256-GCM", keyId: row.keyId, wrappedKey: row.wrappedKey, iv: row.iv, ciphertext: row.ciphertext });
    return normalizeAlertRuleConfig(raw);
  }

  private async decryptObservation(row: EnvelopeRow): Promise<StoredObservation> {
    return this.envelope.decryptRecord<StoredObservation>({ version: 1, algorithm: row.algorithm as "AES-256-GCM", keyId: row.keyId, wrappedKey: row.wrappedKey, iv: row.iv, ciphertext: row.ciphertext });
  }

  private envelopeData(envelope: EncryptedEnvelope) {
    return { algorithm: envelope.algorithm, keyId: envelope.keyId, wrappedKey: envelope.wrappedKey, iv: envelope.iv, ciphertext: envelope.ciphertext };
  }

  private presentRule(row: any, config: AlertRuleConfig) {
    return { id: row.id, carePlanId: row.carePlanId, patientId: row.patientId, policyVersionId: row.policyVersionId, metricCode: row.metricCode, severity: row.severity, patientActionKey: row.patientActionKey, status: row.status, version: row.version, effectiveFrom: row.effectiveFrom, effectiveUntil: row.effectiveUntil, rule: config, automatedClinicalInference: false };
  }

  private providerAlert(row: any) {
    return { id: row.id, patientId: row.patientId, carePlanId: row.carePlanId, ruleId: row.ruleId, ruleVersion: row.ruleVersion, metricCode: row.metricCode, severity: row.severity, status: row.status, sourceObservationId: row.sourceObservationId, patientActionKey: row.patientActionKey, assigneeProviderId: row.assigneeProviderId, createdAt: row.createdAt, acknowledgedAt: row.acknowledgedAt, resolvedAt: row.resolvedAt };
  }

  private patientAlert(row: any, viewed: boolean) {
    return { id: row.id, carePlanId: row.carePlanId, metricCode: row.metricCode, severity: row.severity, status: row.status, patientActionKey: row.patientActionKey, sourceObservationId: row.sourceObservationId, createdAt: row.createdAt, viewed, automatedDiagnosis: false };
  }

  private labels(value: unknown): Labels {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestException("labels must be an object.");
    const raw = value as Record<string, unknown>;
    const output: Partial<Labels> = {};
    for (const locale of ["en", "ar", "fr", "es"] as const) {
      const item = raw[locale];
      if (item == null) continue;
      if (typeof item !== "string" || !item.trim() || item.trim().length > 300) throw new BadRequestException(`labels.${locale} is invalid.`);
      output[locale] = item.trim();
    }
    if (!output.en) throw new BadRequestException("labels.en is required.");
    return output as Labels;
  }

  private token(value: unknown, field: string) {
    if (typeof value !== "string") throw new BadRequestException(`${field} is required.`);
    const normalized = value.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_:-]{1,79}$/.test(normalized)) throw new BadRequestException(`${field} is invalid.`);
    return normalized;
  }

  private id(value: unknown, field: string) {
    if (typeof value !== "string") throw new BadRequestException(`${field} is required.`);
    const normalized = value.trim();
    if (!/^[A-Za-z0-9_.:-]{1,180}$/.test(normalized)) throw new BadRequestException(`${field} is invalid.`);
    return normalized;
  }

  private iso(value: unknown, field: string) {
    if (typeof value !== "string") throw new BadRequestException(`${field} is required.`);
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) throw new BadRequestException(`${field} is invalid.`);
    return date;
  }

  private isoOptional(value: unknown, field: string): Date | null {
    if (value == null || value === "") return null;
    return this.iso(value, field);
  }

  private positiveInteger(value: unknown, field: string) {
    if (!Number.isInteger(value) || Number(value) < 1) throw new BadRequestException(`${field} must be a positive integer.`);
    return Number(value);
  }

  private isUniqueConflict(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002";
  }
}
