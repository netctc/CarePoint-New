import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { createHash } from "node:crypto";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import {
  DataRetentionClasses,
  dataResidencyConfiguration,
  parseDataRetentionPolicy,
  retentionBatchSize,
  retentionExecutionEnabled,
  type DataRetentionClassName,
  type DataRetentionPolicy,
  type DataRetentionRule,
} from "../../infrastructure/data-governance/data-governance-policy";
import { DocumentStorageService } from "../documents/document-storage.service";

type HoldScope = "PATIENT" | "OBJECT" | "DATA_CLASS";
type HoldRecord = {
  id: string;
  scope: HoldScope;
  scopeId: string | null;
  objectType: string | null;
  dataClass: DataRetentionClassName | null;
  expiresAt: Date | null;
};

type RetentionRunInput = {
  mode?: unknown;
  approvalReference?: unknown;
};

type RetentionClassResult = {
  dataClass: DataRetentionClassName;
  action: string;
  examined: number;
  held: number;
  processed: number;
  truncated: boolean;
};

const holdReasonCodes = new Set(["LEGAL", "CLINICAL", "REGULATORY", "INVESTIGATION"]);

@Injectable()
export class DataGovernanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly storage: DocumentStorageService,
  ) {}

  async status() {
    const policy = this.policy();
    const residency = dataResidencyConfiguration(process.env, false);
    const activeHolds = await this.prisma.dataRetentionHold.count({
      where: { status: "ACTIVE", OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    });
    return {
      residency,
      retention: {
        policyVersion: policy?.version ?? null,
        rules: policy ? DataRetentionClasses.map((dataClass) => policy.rules[dataClass]) : [],
        executionEnabled: retentionExecutionEnabled(process.env),
        executionMode: process.env.DATA_RETENTION_EXECUTION_MODE?.trim() || null,
        batchSize: retentionBatchSize(process.env),
        activeHoldCount: activeHolds,
      },
      invariants: {
        auditGenericDeletionAllowed: false,
        rawPhiInRetentionAuditMetadataAllowed: false,
        destructivePolicyRequiresExplicitApprovalReference: true,
      },
    };
  }

  async listHolds() {
    return this.prisma.dataRetentionHold.findMany({
      orderBy: { createdAt: "desc" },
      take: 500,
    });
  }

  async createHold(principal: AuthPrincipal, input: Record<string, unknown>) {
    const scope = this.holdScope(input.scope);
    const dataClass = input.dataClass === undefined || input.dataClass === null ? null : this.dataClass(input.dataClass);
    const scopeId = this.optionalOpaqueId(input.scopeId, "scopeId");
    const objectType = this.optionalObjectType(input.objectType);
    const reasonCode = this.reasonCode(input.reasonCode);
    const approvalReference = this.safeReference(input.approvalReference, "approvalReference");
    const expiresAt = this.optionalFutureDate(input.expiresAt);

    if (scope === "DATA_CLASS") {
      if (!dataClass || scopeId || objectType) throw new BadRequestException("DATA_CLASS hold requires dataClass and forbids scopeId/objectType.");
    } else if (scope === "PATIENT") {
      if (!scopeId || objectType) throw new BadRequestException("PATIENT hold requires scopeId and forbids objectType.");
      const patient = await this.prisma.patientProfile.findUnique({ where: { id: scopeId }, select: { id: true } });
      if (!patient) throw new NotFoundException("Patient retention-hold target not found.");
    } else {
      if (!scopeId || !objectType || !dataClass) throw new BadRequestException("OBJECT hold requires scopeId, objectType and dataClass.");
    }

    const hold = await this.prisma.dataRetentionHold.create({
      data: {
        scope,
        scopeId,
        objectType,
        dataClass,
        reasonCode,
        approvalReference,
        placedByActorId: principal.accountId,
        expiresAt,
      },
    });
    await this.audit.write({
      actorId: principal.accountId,
      action: "DATA_RETENTION_HOLD_PLACED",
      objectType: "DATA_RETENTION_HOLD",
      objectId: hold.id,
      purpose: "DATA_GOVERNANCE",
      result: "SUCCESS",
      metadata: {
        scope,
        dataClass,
        reasonCode,
        approvalReferenceHash: this.pseudonym(approvalReference),
        expires: Boolean(expiresAt),
      },
    });
    return hold;
  }

  async releaseHold(principal: AuthPrincipal, holdId: string, input: Record<string, unknown>) {
    const id = this.opaqueId(holdId, "holdId");
    const approvalReference = this.safeReference(input.approvalReference, "approvalReference");
    const hold = await this.prisma.dataRetentionHold.findUnique({ where: { id } });
    if (!hold) throw new NotFoundException("Retention hold not found.");
    if (hold.status === "RELEASED") return hold;
    const updated = await this.prisma.dataRetentionHold.update({
      where: { id },
      data: { status: "RELEASED", releasedAt: new Date(), releasedByActorId: principal.accountId },
    });
    await this.audit.write({
      actorId: principal.accountId,
      action: "DATA_RETENTION_HOLD_RELEASED",
      objectType: "DATA_RETENTION_HOLD",
      objectId: hold.id,
      purpose: "DATA_GOVERNANCE",
      result: "SUCCESS",
      metadata: { approvalReferenceHash: this.pseudonym(approvalReference), dataClass: hold.dataClass, scope: hold.scope },
    });
    return updated;
  }

  async runRetention(principal: AuthPrincipal, input: RetentionRunInput) {
    const policy = this.policy(true)!;
    const mode = input.mode === "EXECUTE" ? "EXECUTE" : input.mode === "DRY_RUN" ? "DRY_RUN" : null;
    if (!mode) throw new BadRequestException("mode must be DRY_RUN or EXECUTE.");
    if (mode === "EXECUTE") this.assertExecutionApproval(input.approvalReference);

    const now = new Date();
    const holds = await this.activeHolds(now);
    const batchSize = retentionBatchSize(process.env);
    try {
      const results: RetentionClassResult[] = [];
      for (const dataClass of DataRetentionClasses) {
        results.push(await this.applyRule(policy.rules[dataClass], mode === "EXECUTE", now, batchSize, holds));
      }
      const totals = results.reduce((sum, row) => ({
        examined: sum.examined + row.examined,
        held: sum.held + row.held,
        processed: sum.processed + row.processed,
      }), { examined: 0, held: 0, processed: 0 });
      await this.audit.write({
        actorId: principal.accountId,
        action: mode === "EXECUTE" ? "DATA_RETENTION_RUN_EXECUTED" : "DATA_RETENTION_RUN_DRY_RUN",
        objectType: "DATA_RETENTION_POLICY",
        objectId: null,
        purpose: "DATA_GOVERNANCE",
        result: "SUCCESS",
        metadata: { policyVersion: policy.version, mode, ...totals },
      });
      return { policyVersion: policy.version, mode, runAt: now.toISOString(), totals, results };
    } catch (error) {
      await this.audit.write({
        actorId: principal.accountId,
        action: "DATA_RETENTION_RUN_FAILED",
        objectType: "DATA_RETENTION_POLICY",
        objectId: null,
        purpose: "DATA_GOVERNANCE",
        result: "FAILED",
        metadata: { policyVersion: policy.version, mode },
      }).catch(() => undefined);
      throw error;
    }
  }

  private async applyRule(rule: DataRetentionRule, execute: boolean, now: Date, batchSize: number, holds: HoldRecord[]): Promise<RetentionClassResult> {
    if (rule.action === "PRESERVE") return { dataClass: rule.dataClass, action: rule.action, examined: 0, held: 0, processed: 0, truncated: false };
    const cutoff = new Date(now.getTime() - (rule.retentionDays ?? 0) * 86_400_000);
    switch (rule.dataClass) {
      case "AUTH_EPHEMERAL": return this.processAuth(rule, cutoff, execute, batchSize, holds);
      case "CLINICAL_RECORD": return this.processClinicalRecords(rule, cutoff, execute, batchSize, holds);
      case "CLINICAL_DOCUMENT": return this.processClinicalDocuments(rule, cutoff, execute, batchSize, holds, now);
      case "DIAGNOSTIC_REPORT": return this.processDiagnosticReports(rule, cutoff, execute, batchSize, holds);
      case "COMMUNICATION": return this.processCommunications(rule, cutoff, execute, batchSize, holds);
      default: throw new Error(`${rule.dataClass} destructive retention handler is not available.`);
    }
  }

  private async processAuth(rule: DataRetentionRule, cutoff: Date, execute: boolean, batchSize: number, holds: HoldRecord[]): Promise<RetentionClassResult> {
    const classHeld = holds.some((hold) => this.holdMatches(hold, rule.dataClass));
    const [challenges, sessions] = await Promise.all([
      this.prisma.authChallenge.findMany({ where: { OR: [{ expiresAt: { lt: cutoff } }, { consumedAt: { lt: cutoff } }] }, select: { id: true }, take: batchSize }),
      this.prisma.authSession.findMany({ where: { OR: [{ refreshExpiresAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }] }, select: { id: true }, take: batchSize }),
    ]);
    const examined = challenges.length + sessions.length;
    if (classHeld) return { dataClass: rule.dataClass, action: rule.action, examined, held: examined, processed: 0, truncated: challenges.length === batchSize || sessions.length === batchSize };
    if (execute) {
      await this.prisma.$transaction([
        this.prisma.authChallenge.deleteMany({ where: { id: { in: challenges.map((item) => item.id) } } }),
        this.prisma.authSession.deleteMany({ where: { id: { in: sessions.map((item) => item.id) } } }),
      ]);
    }
    return { dataClass: rule.dataClass, action: rule.action, examined, held: 0, processed: execute ? examined : 0, truncated: challenges.length === batchSize || sessions.length === batchSize };
  }

  private async processClinicalRecords(rule: DataRetentionRule, cutoff: Date, execute: boolean, batchSize: number, holds: HoldRecord[]): Promise<RetentionClassResult> {
    const rows = await this.prisma.clinicalRecord.findMany({ where: { createdAt: { lt: cutoff } }, select: { id: true, patientId: true }, take: batchSize, orderBy: { createdAt: "asc" } });
    const allowed = rows.filter((row) => !holds.some((hold) => this.holdMatches(hold, rule.dataClass, row.patientId, "CLINICAL_RECORD", row.id)));
    if (execute && allowed.length) await this.prisma.clinicalRecord.deleteMany({ where: { id: { in: allowed.map((item) => item.id) } } });
    return this.result(rule, rows.length, rows.length - allowed.length, execute ? allowed.length : 0, rows.length === batchSize);
  }

  private async processClinicalDocuments(rule: DataRetentionRule, cutoff: Date, execute: boolean, batchSize: number, holds: HoldRecord[], now: Date): Promise<RetentionClassResult> {
    const rows = await this.prisma.clinicalDocument.findMany({
      where: { createdAt: { lt: cutoff }, status: { not: "REMOVED" } },
      select: { id: true, patientId: true, objectKey: true },
      take: batchSize,
      orderBy: { createdAt: "asc" },
    });
    const allowed = rows.filter((row) => !holds.some((hold) => this.holdMatches(hold, rule.dataClass, row.patientId, "CLINICAL_DOCUMENT", row.id)));
    if (execute) {
      for (const row of allowed) {
        if (row.objectKey) await this.storage.remove(row.objectKey);
        await this.prisma.clinicalDocument.update({
          where: { id: row.id },
          data: {
            patientId: `anon-${this.pseudonym(row.patientId)}`,
            providerId: null,
            encounterRef: null,
            orderId: null,
            status: "REMOVED",
            objectKey: null,
            mediaType: null,
            byteLength: null,
            contentDigest: null,
            blobAlgorithm: null,
            blobKeyId: null,
            blobWrappedKey: null,
            blobIv: null,
            metadataAlgorithm: "RETENTION_PURGED",
            metadataKeyId: "RETENTION_PURGED",
            metadataWrappedKey: "RETENTION_PURGED",
            metadataIv: "RETENTION_PURGED",
            metadataCiphertext: "RETENTION_PURGED",
            releasedToPatient: false,
            releasedAt: null,
            removedAt: now,
            createdByAccountId: "RETENTION_PURGED",
          },
        });
      }
    }
    return this.result(rule, rows.length, rows.length - allowed.length, execute ? allowed.length : 0, rows.length === batchSize);
  }

  private async processDiagnosticReports(rule: DataRetentionRule, cutoff: Date, execute: boolean, batchSize: number, holds: HoldRecord[]): Promise<RetentionClassResult> {
    const rows = await this.prisma.diagnosticReport.findMany({ where: { createdAt: { lt: cutoff } }, select: { id: true, patientId: true }, take: batchSize, orderBy: { createdAt: "asc" } });
    const allowed = rows.filter((row) => !holds.some((hold) => this.holdMatches(hold, rule.dataClass, row.patientId, "DIAGNOSTIC_REPORT", row.id)));
    if (execute && allowed.length) await this.prisma.diagnosticReport.deleteMany({ where: { id: { in: allowed.map((item) => item.id) } } });
    return this.result(rule, rows.length, rows.length - allowed.length, execute ? allowed.length : 0, rows.length === batchSize);
  }

  private async processCommunications(rule: DataRetentionRule, cutoff: Date, execute: boolean, batchSize: number, holds: HoldRecord[]): Promise<RetentionClassResult> {
    const rows = await this.prisma.careConversation.findMany({
      where: { status: "CLOSED", closedAt: { lt: cutoff } },
      select: { id: true, patientId: true },
      take: batchSize,
      orderBy: { closedAt: "asc" },
    });
    const allowed = rows.filter((row) => !holds.some((hold) => this.holdMatches(hold, rule.dataClass, row.patientId, "CARE_CONVERSATION", row.id)));
    if (execute && allowed.length) await this.prisma.careConversation.deleteMany({ where: { id: { in: allowed.map((item) => item.id) } } });
    return this.result(rule, rows.length, rows.length - allowed.length, execute ? allowed.length : 0, rows.length === batchSize);
  }

  private result(rule: DataRetentionRule, examined: number, held: number, processed: number, truncated: boolean): RetentionClassResult {
    return { dataClass: rule.dataClass, action: rule.action, examined, held, processed, truncated };
  }

  private async activeHolds(now: Date): Promise<HoldRecord[]> {
    const rows = await this.prisma.dataRetentionHold.findMany({
      where: { status: "ACTIVE", OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      select: { id: true, scope: true, scopeId: true, objectType: true, dataClass: true, expiresAt: true },
    });
    return rows as HoldRecord[];
  }

  private holdMatches(hold: HoldRecord, dataClass: DataRetentionClassName, patientId?: string, objectType?: string, objectId?: string): boolean {
    if (hold.dataClass && hold.dataClass !== dataClass) return false;
    if (hold.scope === "DATA_CLASS") return hold.dataClass === dataClass;
    if (hold.scope === "PATIENT") return Boolean(patientId && hold.scopeId === patientId);
    return Boolean(objectId && objectType && hold.scopeId === objectId && hold.objectType === objectType);
  }

  private policy(required = false): DataRetentionPolicy | null {
    try {
      return parseDataRetentionPolicy(process.env.DATA_RETENTION_POLICY_JSON, required);
    } catch (error) {
      if (required) throw new BadRequestException(error instanceof Error ? error.message : "Invalid retention policy.");
      return null;
    }
  }

  private assertExecutionApproval(raw: unknown): void {
    if (!retentionExecutionEnabled(process.env)) throw new ForbiddenException("Retention execution is disabled by deployment policy.");
    const configured = process.env.DATA_RETENTION_APPROVAL_REFERENCE?.trim();
    if (!configured) throw new ForbiddenException("Retention execution approval is not configured.");
    const supplied = typeof raw === "string" ? raw.trim() : "";
    if (!supplied || supplied !== configured) throw new ForbiddenException("Retention execution approval reference does not match the deployment-approved policy.");
  }

  private holdScope(value: unknown): HoldScope {
    if (value !== "PATIENT" && value !== "OBJECT" && value !== "DATA_CLASS") throw new BadRequestException("scope must be PATIENT, OBJECT or DATA_CLASS.");
    return value;
  }

  private dataClass(value: unknown): DataRetentionClassName {
    if (typeof value !== "string" || !(DataRetentionClasses as readonly string[]).includes(value)) throw new BadRequestException("Unsupported dataClass.");
    return value as DataRetentionClassName;
  }

  private reasonCode(value: unknown): string {
    if (typeof value !== "string" || !holdReasonCodes.has(value)) throw new BadRequestException("reasonCode must be LEGAL, CLINICAL, REGULATORY or INVESTIGATION.");
    return value;
  }

  private optionalOpaqueId(value: unknown, name: string): string | null {
    if (value === undefined || value === null || value === "") return null;
    return this.opaqueId(value, name);
  }

  private opaqueId(value: unknown, name: string): string {
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new BadRequestException(`${name} must be an opaque identifier.`);
    return value;
  }

  private optionalObjectType(value: unknown): string | null {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string" || !/^[A-Z0-9_]{1,64}$/.test(value)) throw new BadRequestException("objectType must be an uppercase opaque object type.");
    return value;
  }

  private safeReference(value: unknown, name: string): string {
    if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(value)) throw new BadRequestException(`${name} must be an opaque non-secret reference.`);
    return value;
  }

  private optionalFutureDate(value: unknown): Date | null {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string") throw new BadRequestException("expiresAt must be an ISO-8601 date-time.");
    const date = new Date(value);
    if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) throw new BadRequestException("expiresAt must be a future ISO-8601 date-time.");
    return date;
  }

  private pseudonym(value: string): string {
    return createHash("sha256").update(value).digest("hex").slice(0, 32);
  }
}
