import { createHash } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  principalHasAnyPermission,
  type AuthPrincipal,
  type Permission,
} from "@carepoint/identity";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { isMfaAssuredSessionId } from "../../security/privileged-mfa-policy";
import { ClinicalEnvelopeService } from "../clinical/clinical-envelope.service";

const MIN_TTL_MINUTES = 5;
const MAX_TTL_MINUTES = 60;
const DEFAULT_TTL_MINUTES = 30;

const BREAK_GLASS_SCOPES = new Set<Permission>([
  "CLINICAL_RECORD_READ",
  "CLINICAL_HEALTH_PROFILE_READ",
  "CLINICAL_QUESTIONNAIRE_READ",
  "CLINICAL_OBSERVATION_READ",
  "CLINICAL_PROFILE_READ",
  "CLINICAL_PATIENT_SNAPSHOT_READ",
  "CLINICAL_ORDER_READ",
  "CLINICAL_DOCUMENT_READ",
  "CLINICAL_MEDIA_READ",
]);

const EMERGENCY_REASON_CODES = new Set([
  "LIFE_THREATENING_EMERGENCY",
  "UNCONSCIOUS_OR_UNABLE_TO_CONSENT",
  "EMERGENCY_TRANSFER",
  "CRITICAL_INFORMATION_REQUIRED",
]);

const REVIEW_OUTCOMES = new Set([
  "APPROPRIATE",
  "INAPPROPRIATE",
  "NEEDS_FOLLOW_UP",
]);

const REVIEW_REASON_CODES = new Set([
  "POLICY_CONFORMANT",
  "PATIENT_SAFETY_JUSTIFIED",
  "INSUFFICIENT_JUSTIFICATION",
  "SCOPE_EXCESSIVE",
  "FOLLOW_UP_REQUIRED",
]);

type EmergencyGrantViewRow = {
  id: string;
  patientId: string;
  providerId: string;
  actorId: string;
  sessionId: string;
  scope: string;
  purpose: string;
  reasonCode: string;
  status: string;
  requestedTtlMinutes: number;
  grantedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  reviewStatus: string;
  reviewedAt: Date | null;
  reviewOutcome: string | null;
  createdAt: Date;
};

export interface CreateEmergencyAccessInput {
  patientId: string;
  scope: string;
  reasonCode: string;
  ttlMinutes?: number;
  idempotencyKey: string;
}

export interface ReviewEmergencyAccessInput {
  outcome: string;
  reasonCode: string;
}

@Injectable()
export class EmergencyAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly envelope: ClinicalEnvelopeService,
  ) {}

  async create(principal: AuthPrincipal, input: CreateEmergencyAccessInput) {
    const actor = await this.requireDoctor(principal, true);
    const patientId = this.identifier(input?.patientId, "patientId");
    const scope = this.scope(input?.scope);
    const reasonCode = this.enumToken(input?.reasonCode, "reasonCode", EMERGENCY_REASON_CODES);
    const ttlMinutes = this.ttl(input?.ttlMinutes);
    const idempotencyKey = this.identifier(input?.idempotencyKey, "idempotencyKey");

    if (!principalHasAnyPermission(principal, [scope])) {
      await this.denied(principal, patientId, scope, "REQUESTED_SCOPE_NOT_GRANTED");
      throw new ForbiddenException("Requested emergency scope is not granted to this role.");
    }

    const patient = await this.prisma.patientProfile.findUnique({
      where: { id: patientId },
      select: { id: true },
    });
    if (!patient) throw new NotFoundException("Patient not found.");

    const requestDigest = this.digest({ patientId, scope, reasonCode, ttlMinutes });
    const replay = await this.prisma.emergencyAccessGrant.findUnique({
      where: { actorId_idempotencyKey: { actorId: principal.accountId, idempotencyKey } },
    });
    if (replay) return this.replayOrConflict(replay, requestDigest);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMinutes * 60_000);
    try {
      const grant = await this.prisma.emergencyAccessGrant.create({
        data: {
          patientId,
          providerId: actor.providerId,
          actorId: principal.accountId,
          sessionId: principal.sessionId,
          scope,
          purpose: "EMERGENCY_TREATMENT",
          reasonCode,
          requestedTtlMinutes: ttlMinutes,
          idempotencyKey,
          requestDigest,
          expiresAt,
        },
      });
      await this.audit.writeClinical({
        actorId: principal.accountId,
        action: "EMERGENCY_ACCESS_GRANTED",
        objectType: "EMERGENCY_ACCESS_GRANT",
        objectId: grant.id,
        purpose: "EMERGENCY_TREATMENT",
        result: "SUCCESS",
        metadata: {
          domain: "EMERGENCY_ACCESS",
          patientId,
          providerId: actor.providerId,
          scope,
          reasonCode,
          ttlMinutes,
          mfaAssured: true,
          reviewRequired: true,
          decision: "ALLOW",
        },
      });
      return this.present(grant);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const existing = await this.prisma.emergencyAccessGrant.findUnique({
          where: { actorId_idempotencyKey: { actorId: principal.accountId, idempotencyKey } },
        });
        if (existing) return this.replayOrConflict(existing, requestDigest);
      }
      throw error;
    }
  }

  async listMine(principal: AuthPrincipal) {
    const actor = await this.requireDoctor(principal, false);
    const rows = await this.prisma.emergencyAccessGrant.findMany({
      where: { providerId: actor.providerId, actorId: principal.accountId },
      orderBy: { grantedAt: "desc" },
      take: 100,
    });
    return { items: rows.map((row) => this.present(row)) };
  }

  async revokeMine(principal: AuthPrincipal, grantId: string) {
    const actor = await this.requireDoctor(principal, false);
    const id = this.identifier(grantId, "grantId");
    const grant = await this.prisma.emergencyAccessGrant.findFirst({
      where: { id, providerId: actor.providerId, actorId: principal.accountId },
    });
    if (!grant) throw new NotFoundException("Emergency access grant not found.");
    if (grant.status === "REVOKED") return this.present(grant);
    const updated = await this.prisma.emergencyAccessGrant.update({
      where: { id },
      data: {
        status: "REVOKED",
        revokedAt: new Date(),
        revokedByActorId: principal.accountId,
      },
    });
    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "EMERGENCY_ACCESS_REVOKED",
      objectType: "EMERGENCY_ACCESS_GRANT",
      objectId: id,
      purpose: "EMERGENCY_TREATMENT",
      result: "SUCCESS",
      metadata: {
        domain: "EMERGENCY_ACCESS",
        patientId: grant.patientId,
        providerId: grant.providerId,
        scope: grant.scope,
        decision: "REVOKE",
      },
    });
    return this.present(updated);
  }

  async activeReadGrant(principal: AuthPrincipal, patientId: string, scopeInput: string) {
    if (principal.role !== "DOCTOR" || !isMfaAssuredSessionId(principal.sessionId)) return null;
    const scope = this.scope(scopeInput);
    if (!principalHasAnyPermission(principal, [scope])) return null;
    const provider = await this.prisma.provider.findUnique({
      where: { userId: principal.accountId },
      select: { id: true, status: true },
    });
    if (!provider || provider.status !== "ACTIVE") return null;
    const grant = await this.prisma.emergencyAccessGrant.findFirst({
      where: {
        patientId,
        providerId: provider.id,
        actorId: principal.accountId,
        scope,
        status: "ACTIVE",
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { grantedAt: "desc" },
    });
    if (!grant) return null;
    await this.auditGrantUse(principal, grant);
    return { id: grant.id, scope: grant.scope, expiresAt: grant.expiresAt };
  }

  async readClinicalProfile(principal: AuthPrincipal, grantId: string) {
    const grant = await this.requireOwnedActiveGrant(principal, grantId, "CLINICAL_PROFILE_READ");
    const rows = await this.prisma.clinicalProfileEntry.findMany({
      where: { patientId: grant.patientId },
      orderBy: [{ kind: "asc" }, { updatedAt: "desc" }],
      take: 200,
    });
    const items = [];
    for (const row of rows) {
      const stored = await this.envelope.decryptRecord<{ schemaVersion: 1; payload: unknown }>({
        version: 1,
        algorithm: row.algorithm as "AES-256-GCM",
        keyId: row.keyId,
        wrappedKey: row.wrappedKey,
        iv: row.iv,
        ciphertext: row.ciphertext,
      });
      items.push({
        id: row.id,
        patientId: row.patientId,
        kind: row.kind,
        status: row.status,
        version: row.version,
        data: stored.payload,
        verificationStatus: row.verificationStatus,
        provenance: {
          sourceType: row.sourceType,
          sourceActorId: row.sourceActorId,
          verifiedByActorId: row.verifiedByActorId,
          verifiedAt: row.verifiedAt,
          recordedAt: row.createdAt,
          updatedAt: row.updatedAt,
        },
      });
    }
    await this.auditGrantUse(principal, grant);
    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "CLINICAL_PROFILE_LIST_READ",
      objectType: "PATIENT",
      objectId: grant.patientId,
      purpose: "EMERGENCY_TREATMENT",
      result: "SUCCESS",
      metadata: {
        domain: "CLINICAL_PROFILE",
        accessBasis: "BREAK_GLASS",
        emergencyAccessGrantId: grant.id,
        patientId: grant.patientId,
        providerId: grant.providerId,
        itemCount: items.length,
        decision: "ALLOW",
      },
    });
    return {
      patientId: grant.patientId,
      accessBasis: "BREAK_GLASS",
      emergencyAccessGrant: {
        id: grant.id,
        scope: grant.scope,
        expiresAt: grant.expiresAt,
      },
      items,
    };
  }

  async reviewQueue(principal: AuthPrincipal, reviewStatus = "PENDING") {
    this.requireAdmin(principal);
    const normalized = reviewStatus.trim().toUpperCase();
    if (!new Set(["PENDING", "REVIEWED"]).has(normalized)) {
      throw new BadRequestException("reviewStatus must be PENDING or REVIEWED.");
    }
    const rows = await this.prisma.emergencyAccessGrant.findMany({
      where: { reviewStatus: normalized },
      orderBy: { grantedAt: "asc" },
      take: 200,
    });
    return { items: rows.map((row) => this.present(row)) };
  }

  async review(principal: AuthPrincipal, grantId: string, input: ReviewEmergencyAccessInput) {
    this.requireAdmin(principal);
    const id = this.identifier(grantId, "grantId");
    const outcome = this.enumToken(input?.outcome, "outcome", REVIEW_OUTCOMES);
    const reasonCode = this.enumToken(input?.reasonCode, "reasonCode", REVIEW_REASON_CODES);
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "EmergencyAccessGrant" WHERE id = ${id} FOR UPDATE`);
      const current = await tx.emergencyAccessGrant.findUnique({ where: { id } });
      if (!current) throw new NotFoundException("Emergency access grant not found.");
      if (current.reviewStatus === "REVIEWED") throw new ConflictException("Emergency access grant is already reviewed.");
      const now = new Date();
      const shouldRevoke = outcome === "INAPPROPRIATE" && current.status === "ACTIVE" && current.expiresAt > now;
      const grant = await tx.emergencyAccessGrant.update({
        where: { id },
        data: {
          reviewStatus: "REVIEWED",
          reviewedAt: now,
          reviewedByActorId: principal.accountId,
          reviewOutcome: outcome,
          ...(shouldRevoke
            ? { status: "REVOKED", revokedAt: now, revokedByActorId: principal.accountId }
            : {}),
        },
      });
      await tx.emergencyAccessReview.create({
        data: { grantId: id, reviewerId: principal.accountId, outcome, reasonCode },
      });
      await this.audit.writeClinicalInTransaction(tx, {
        actorId: principal.accountId,
        action: "EMERGENCY_ACCESS_REVIEWED",
        objectType: "EMERGENCY_ACCESS_GRANT",
        objectId: id,
        purpose: "SECURITY_REVIEW",
        result: "SUCCESS",
        metadata: {
          domain: "EMERGENCY_ACCESS",
          patientId: current.patientId,
          providerId: current.providerId,
          scope: current.scope,
          outcome,
          reasonCode,
          grantRevoked: shouldRevoke,
          decision: "REVIEWED",
        },
      });
      return grant;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return this.present(result);
  }

  private async requireOwnedActiveGrant(principal: AuthPrincipal, grantId: string, expectedScope: Permission) {
    const actor = await this.requireDoctor(principal, true);
    if (!principalHasAnyPermission(principal, [expectedScope])) {
      throw new ForbiddenException("Emergency scope is not granted to this role.");
    }
    const id = this.identifier(grantId, "grantId");
    const grant = await this.prisma.emergencyAccessGrant.findFirst({
      where: {
        id,
        providerId: actor.providerId,
        actorId: principal.accountId,
        scope: expectedScope,
        status: "ACTIVE",
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (!grant) {
      await this.denied(principal, null, expectedScope, "ACTIVE_GRANT_REQUIRED");
      throw new ForbiddenException("An active emergency access grant is required.");
    }
    return grant;
  }

  private async requireDoctor(principal: AuthPrincipal, requireMfa: boolean) {
    if (principal.role !== "DOCTOR") {
      await this.denied(principal, null, null, "DOCTOR_ROLE_REQUIRED");
      throw new ForbiddenException("Emergency break-glass access is limited to doctors.");
    }
    if (requireMfa && !isMfaAssuredSessionId(principal.sessionId)) {
      await this.denied(principal, null, null, "MFA_ASSURANCE_REQUIRED");
      throw new ForbiddenException("A current MFA-assured session is required for emergency access.");
    }
    const provider = await this.prisma.provider.findUnique({
      where: { userId: principal.accountId },
      select: { id: true, status: true },
    });
    if (!provider || provider.status !== "ACTIVE") {
      await this.denied(principal, null, null, "ACTIVE_PROVIDER_REQUIRED");
      throw new ForbiddenException("An active doctor provider profile is required.");
    }
    return { providerId: provider.id };
  }

  private requireAdmin(principal: AuthPrincipal) {
    if (principal.role !== "ADMIN") throw new ForbiddenException("Emergency access review requires ADMIN role.");
  }

  private replayOrConflict(row: EmergencyGrantViewRow & { requestDigest: string }, digest: string) {
    if (row.requestDigest !== digest) {
      throw new ConflictException("idempotencyKey has already been used for a different emergency-access request.");
    }
    return this.present(row);
  }

  private async auditGrantUse(principal: AuthPrincipal, grant: EmergencyGrantViewRow) {
    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "EMERGENCY_ACCESS_USED",
      objectType: "EMERGENCY_ACCESS_GRANT",
      objectId: grant.id,
      purpose: "EMERGENCY_TREATMENT",
      result: "SUCCESS",
      metadata: {
        domain: "EMERGENCY_ACCESS",
        patientId: grant.patientId,
        providerId: grant.providerId,
        scope: grant.scope,
        grantExpiresAt: grant.expiresAt.toISOString(),
        decision: "ALLOW",
      },
    });
  }

  private async denied(
    principal: AuthPrincipal,
    patientId: string | null,
    scope: string | null,
    reason: string,
  ) {
    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "EMERGENCY_ACCESS_DENIED",
      objectType: "PATIENT",
      objectId: patientId,
      purpose: "EMERGENCY_TREATMENT",
      result: "DENIED",
      metadata: {
        domain: "EMERGENCY_ACCESS",
        patientId,
        scope,
        reason,
        role: principal.role,
        decision: "DENY",
      },
    });
  }

  private ttl(value: unknown) {
    if (value === undefined || value === null) return DEFAULT_TTL_MINUTES;
    if (!Number.isInteger(value) || Number(value) < MIN_TTL_MINUTES || Number(value) > MAX_TTL_MINUTES) {
      throw new BadRequestException(`ttlMinutes must be an integer from ${MIN_TTL_MINUTES} to ${MAX_TTL_MINUTES}.`);
    }
    return Number(value);
  }

  private scope(value: unknown): Permission {
    const normalized = String(value ?? "").trim().toUpperCase() as Permission;
    if (!BREAK_GLASS_SCOPES.has(normalized)) {
      throw new BadRequestException("Unsupported emergency access scope.");
    }
    return normalized;
  }

  private enumToken(value: unknown, field: string, allowed: ReadonlySet<string>) {
    const normalized = String(value ?? "").trim().toUpperCase();
    if (!allowed.has(normalized)) throw new BadRequestException(`${field} is invalid.`);
    return normalized;
  }

  private identifier(value: unknown, field: string) {
    if (typeof value !== "string") throw new BadRequestException(`${field} is required.`);
    const normalized = value.trim();
    if (!/^[A-Za-z0-9_.:-]{1,180}$/.test(normalized)) throw new BadRequestException(`${field} is invalid.`);
    return normalized;
  }

  private digest(value: unknown) {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
  }

  private present(row: EmergencyGrantViewRow) {
    const effectiveStatus = row.status === "ACTIVE" && row.expiresAt.getTime() <= Date.now() ? "EXPIRED" : row.status;
    return {
      id: row.id,
      patientId: row.patientId,
      providerId: row.providerId,
      actorId: row.actorId,
      originatingSessionId: row.sessionId,
      scope: row.scope,
      purpose: row.purpose,
      reasonCode: row.reasonCode,
      status: effectiveStatus,
      ttlMinutes: row.requestedTtlMinutes,
      grantedAt: row.grantedAt,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
      reviewStatus: row.reviewStatus,
      reviewedAt: row.reviewedAt,
      reviewOutcome: row.reviewOutcome,
      createdAt: row.createdAt,
    };
  }
}
