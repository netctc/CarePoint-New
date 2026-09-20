import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { AuthPrincipal } from "@carepoint/identity";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { validateClinicalConsentGrantContract } from "../clinical-governance/clinical-consent-policy";
import {
  authorityIsEffective,
  contextExpiry,
  hasAuthorityScope,
  normalizeAuthorityReviewDecision,
  normalizeAuthorityScopes,
  normalizeEvidenceReviewStatus,
  normalizeEvidenceType,
  normalizeReasonCode,
  normalizeReferenceId,
  normalizeRelationshipType,
  type DependentAuthorityScope,
} from "./dependent-authority.engine";

const MAX_RELATIONS = 100;

type EvidenceInput = {
  evidenceType: string;
  referenceId: string;
  issuedAt?: string | null;
  expiresAt?: string | null;
};

export interface CreateDependentRelationInput {
  targetPatientId: string;
  relationshipType: string;
  scopes: string[];
  validUntil?: string | null;
  evidence: EvidenceInput[];
}

export interface UpdateDependentRelationInput {
  relationshipType?: string;
  scopes?: string[];
  validUntil?: string | null;
  evidence?: EvidenceInput[];
}

export interface RelationReviewInput { decision: string; reasonCode?: string | null; }
export interface EvidenceReviewInput { status: string; reasonCode?: string | null; }
export interface SwitchPatientContextInput { patientId?: string | null; mode?: "SELF" | "DEPENDENT"; }
export interface GrantDependentConsentInput {
  providerId?: string | null;
  scope: string;
  version: string;
  purpose?: string | null;
  expiresAt?: string | null;
}

@Injectable()
export class PatientContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
  ) {}

  async current(principal: AuthPrincipal) {
    this.requirePatient(principal);
    const self = await this.selfPatient(principal.accountId);
    const stored = await this.prisma.patientContextSession.findUnique({ where: { sessionId: principal.sessionId } });
    if (!stored || stored.guardianAccountId !== principal.accountId || stored.expiresAt.getTime() <= Date.now()) {
      if (stored) await this.prisma.patientContextSession.deleteMany({ where: { sessionId: principal.sessionId } });
      return this.selfProjection(self.id, self.firstName, self.lastName);
    }
    if (stored.mode === "SELF" || stored.patientId === self.id) {
      return this.selfProjection(self.id, self.firstName, self.lastName);
    }
    if (!stored.relationId) return this.resetToSelf(principal, self, "MISSING_RELATION");
    const relation = await this.prisma.dependentRelation.findUnique({ where: { id: stored.relationId } });
    if (!relation || relation.guardianAccountId !== principal.accountId || relation.dependentPatientId !== stored.patientId || !authorityIsEffective(relation)) {
      return this.resetToSelf(principal, self, "AUTHORITY_INACTIVE");
    }
    const patient = await this.prisma.patientProfile.findUnique({ where: { id: relation.dependentPatientId }, select: { id: true, firstName: true, lastName: true } });
    if (!patient) return this.resetToSelf(principal, self, "DEPENDENT_MISSING");
    return {
      mode: "DEPENDENT" as const,
      patientId: patient.id,
      patientName: `${patient.firstName} ${patient.lastName}`.trim(),
      relationId: relation.id,
      relationshipType: relation.relationshipType,
      scopes: this.scopes(relation.scopes),
      selectedAt: stored.selectedAt,
      expiresAt: stored.expiresAt,
      explicitContext: true,
    };
  }

  async switch(principal: AuthPrincipal, input: SwitchPatientContextInput) {
    this.requirePatient(principal);
    const self = await this.selfPatient(principal.accountId);
    const requestedPatientId = input?.patientId?.trim() || self.id;
    const mode = input?.mode ?? (requestedPatientId === self.id ? "SELF" : "DEPENDENT");
    if (mode === "SELF" || requestedPatientId === self.id) {
      const expiresAt = contextExpiry(null);
      await this.prisma.patientContextSession.upsert({
        where: { sessionId: principal.sessionId },
        create: { sessionId: principal.sessionId, guardianAccountId: principal.accountId, patientId: self.id, mode: "SELF", expiresAt },
        update: { guardianAccountId: principal.accountId, patientId: self.id, relationId: null, mode: "SELF", selectedAt: new Date(), expiresAt },
      });
      await this.audit.write({ actorId: principal.accountId, action: "PATIENT_CONTEXT_SWITCHED", objectType: "PATIENT_CONTEXT", objectId: principal.sessionId, purpose: "PATIENT_ACCESS", result: "SUCCESS", metadata: { mode: "SELF", patientId: self.id } });
      return this.current(principal);
    }
    const relation = await this.effectiveRelation(principal.accountId, requestedPatientId);
    const expiresAt = contextExpiry(relation.validUntil);
    await this.prisma.patientContextSession.upsert({
      where: { sessionId: principal.sessionId },
      create: { sessionId: principal.sessionId, guardianAccountId: principal.accountId, patientId: requestedPatientId, relationId: relation.id, mode: "DEPENDENT", expiresAt },
      update: { guardianAccountId: principal.accountId, patientId: requestedPatientId, relationId: relation.id, mode: "DEPENDENT", selectedAt: new Date(), expiresAt },
    });
    await this.audit.write({ actorId: principal.accountId, action: "PATIENT_CONTEXT_SWITCHED", objectType: "PATIENT_CONTEXT", objectId: principal.sessionId, purpose: "PROXY_PATIENT_ACCESS", result: "SUCCESS", metadata: { mode: "DEPENDENT", patientId: requestedPatientId, relationId: relation.id } });
    return this.current(principal);
  }

  async resolveEffectivePatient(principal: AuthPrincipal, requiredScope?: DependentAuthorityScope) {
    const context = await this.current(principal);
    if (context.mode === "SELF") return { patientId: context.patientId, mode: context.mode, relationId: null };
    const relation = await this.effectiveRelation(principal.accountId, context.patientId, requiredScope);
    return { patientId: relation.dependentPatientId, mode: "DEPENDENT" as const, relationId: relation.id };
  }

  async effectiveRelation(guardianAccountId: string, patientId: string, requiredScope?: DependentAuthorityScope) {
    const relation = await this.prisma.dependentRelation.findUnique({
      where: { guardianAccountId_dependentPatientId: { guardianAccountId, dependentPatientId: patientId } },
    });
    if (!relation || !authorityIsEffective(relation)) throw new ForbiddenException("Effective dependent authority is required.");
    if (requiredScope && !hasAuthorityScope(relation.scopes, requiredScope)) throw new ForbiddenException(`Dependent authority does not include ${requiredScope}.`);
    return relation;
  }

  private async resetToSelf(principal: AuthPrincipal, self: { id: string; firstName: string; lastName: string }, reasonCode: string) {
    await this.prisma.patientContextSession.deleteMany({ where: { sessionId: principal.sessionId } });
    await this.audit.write({ actorId: principal.accountId, action: "PATIENT_CONTEXT_RESET", objectType: "PATIENT_CONTEXT", objectId: principal.sessionId, purpose: "PATIENT_ACCESS", result: "SUCCESS", metadata: { reasonCode, patientId: self.id } });
    return this.selfProjection(self.id, self.firstName, self.lastName);
  }

  private selfProjection(id: string, firstName: string, lastName: string) {
    return { mode: "SELF" as const, patientId: id, patientName: `${firstName} ${lastName}`.trim(), relationId: null, scopes: [], explicitContext: true };
  }

  private scopes(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  }

  private async selfPatient(accountId: string) {
    const patient = await this.prisma.patientProfile.findUnique({ where: { userId: accountId }, select: { id: true, firstName: true, lastName: true } });
    if (!patient) throw new NotFoundException("Patient profile not found.");
    return patient;
  }

  private requirePatient(principal: AuthPrincipal) {
    if (principal.role !== "PATIENT") throw new ForbiddenException("Patient context is available only to PATIENT accounts.");
  }
}

@Injectable()
export class DependentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly contexts: PatientContextService,
  ) {}

  async listMine(principal: AuthPrincipal) {
    this.requirePatient(principal);
    const rows = await this.prisma.dependentRelation.findMany({
      where: { guardianAccountId: principal.accountId },
      include: { evidence: { orderBy: { createdAt: "asc" } } },
      orderBy: { createdAt: "desc" },
      take: MAX_RELATIONS,
    });
    const items = [];
    for (const row of rows) {
      const dependent = row.status === "VERIFIED" && authorityIsEffective(row)
        ? await this.prisma.patientProfile.findUnique({ where: { id: row.dependentPatientId }, select: { id: true, firstName: true, lastName: true } })
        : null;
      items.push(this.presentRelation(row, dependent));
    }
    return { items, activeContext: await this.contexts.current(principal) };
  }

  async request(principal: AuthPrincipal, input: CreateDependentRelationInput) {
    this.requirePatient(principal);
    const self = await this.prisma.patientProfile.findUnique({ where: { userId: principal.accountId }, select: { id: true } });
    if (!self) throw new NotFoundException("Patient profile not found.");
    const targetPatientId = this.id(input?.targetPatientId, "targetPatientId");
    if (targetPatientId === self.id) throw new BadRequestException("A patient cannot be their own dependent.");
    const target = await this.prisma.patientProfile.findUnique({ where: { id: targetPatientId }, select: { id: true } });
    if (!target) throw new BadRequestException("Dependent patient cannot be linked.");
    const relationshipType = normalizeRelationshipType(input?.relationshipType);
    const scopes = normalizeAuthorityScopes(input?.scopes);
    const validUntil = this.optionalFutureDate(input?.validUntil, "validUntil");
    const evidence = this.evidence(input?.evidence);
    if (evidence.length === 0) throw new BadRequestException("At least one legal-authority evidence reference is required.");
    const existing = await this.prisma.dependentRelation.findUnique({ where: { guardianAccountId_dependentPatientId: { guardianAccountId: principal.accountId, dependentPatientId: targetPatientId } } });
    if (existing) throw new ConflictException("A dependent relationship request already exists for this patient.");
    const relation = await this.prisma.$transaction(async (tx) => {
      const created = await tx.dependentRelation.create({
        data: { guardianAccountId: principal.accountId, dependentPatientId: targetPatientId, relationshipType, status: "PENDING_REVIEW", scopes: scopes as unknown as Prisma.InputJsonValue, ...(validUntil ? { validUntil } : {}) },
      });
      for (const item of evidence) await tx.legalAuthorityEvidence.create({ data: { relationId: created.id, ...item } });
      await this.audit.writeInTransaction(tx, { actorId: principal.accountId, action: "DEPENDENT_RELATION_REQUESTED", objectType: "DEPENDENT_RELATION", objectId: created.id, purpose: "PROXY_PATIENT_ACCESS", result: "SUCCESS", metadata: { patientId: targetPatientId, relationId: created.id, relationshipType, scopeCount: scopes.length } });
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return { id: relation.id, dependentPatientId: relation.dependentPatientId, relationshipType, status: relation.status, scopes, validUntil: relation.validUntil, clinicalAccessEnabled: false };
  }

  async updateRequest(principal: AuthPrincipal, relationId: string, input: UpdateDependentRelationInput) {
    this.requirePatient(principal);
    const id = this.id(relationId, "relationId");
    const row = await this.prisma.dependentRelation.findUnique({ where: { id } });
    if (!row || row.guardianAccountId !== principal.accountId) throw new NotFoundException("Dependent relationship not found.");
    if (row.status === "REVOKED") throw new ConflictException("Revoked dependent authority cannot be edited.");
    const relationshipType = input?.relationshipType === undefined ? row.relationshipType : normalizeRelationshipType(input.relationshipType);
    const scopes = normalizeAuthorityScopes(input?.scopes ?? row.scopes);
    const validUntil = input?.validUntil === undefined ? row.validUntil : this.optionalFutureDate(input.validUntil, "validUntil");
    const evidence = input?.evidence === undefined ? [] : this.evidence(input.evidence);
    const updated = await this.prisma.$transaction(async (tx) => {
      const current = await tx.dependentRelation.update({ where: { id, guardianAccountId: principal.accountId }, data: { relationshipType, scopes: scopes as unknown as Prisma.InputJsonValue, validUntil, status: "PENDING_REVIEW", verifiedAt: null, verifiedByActorId: null, reasonCode: null } });
      for (const item of evidence) await tx.legalAuthorityEvidence.create({ data: { relationId: id, ...item } });
      await tx.patientContextSession.deleteMany({ where: { relationId: id } });
      await this.audit.writeInTransaction(tx, { actorId: principal.accountId, action: "DEPENDENT_RELATION_CHANGED_REVIEW_REQUIRED", objectType: "DEPENDENT_RELATION", objectId: id, purpose: "PROXY_PATIENT_ACCESS", result: "SUCCESS", metadata: { patientId: row.dependentPatientId, relationId: id, scopeCount: scopes.length } });
      return current;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return { id: updated.id, dependentPatientId: updated.dependentPatientId, status: updated.status, reviewRequired: true };
  }

  async revoke(principal: AuthPrincipal, relationId: string) {
    this.requirePatient(principal);
    const id = this.id(relationId, "relationId");
    const row = await this.prisma.dependentRelation.findUnique({ where: { id } });
    if (!row || row.guardianAccountId !== principal.accountId) throw new NotFoundException("Dependent relationship not found.");
    if (row.status === "REVOKED") return { id: row.id, status: row.status };
    const updated = await this.prisma.$transaction(async (tx) => {
      const current = await tx.dependentRelation.update({ where: { id, guardianAccountId: principal.accountId }, data: { status: "REVOKED", revokedAt: new Date(), reasonCode: "REVOKED_BY_GUARDIAN" } });
      await tx.patientContextSession.deleteMany({ where: { relationId: id } });
      await this.audit.writeInTransaction(tx, { actorId: principal.accountId, action: "DEPENDENT_RELATION_REVOKED", objectType: "DEPENDENT_RELATION", objectId: id, purpose: "PROXY_PATIENT_ACCESS", result: "SUCCESS", metadata: { patientId: row.dependentPatientId, relationId: id } });
      return current;
    });
    return { id: updated.id, status: updated.status, revokedAt: updated.revokedAt };
  }

  async adminQueue() {
    const rows = await this.prisma.dependentRelation.findMany({ where: { status: "PENDING_REVIEW" }, include: { evidence: { orderBy: { createdAt: "asc" } } }, orderBy: { createdAt: "asc" }, take: MAX_RELATIONS });
    const items = [];
    for (const row of rows) {
      const [guardian, dependent] = await Promise.all([
        this.prisma.user.findUnique({ where: { id: row.guardianAccountId }, select: { id: true, email: true, role: true } }),
        this.prisma.patientProfile.findUnique({ where: { id: row.dependentPatientId }, select: { id: true, firstName: true, lastName: true } }),
      ]);
      items.push({ ...this.presentRelation(row, dependent), guardian, evidence: row.evidence.map((item) => this.presentEvidence(item)) });
    }
    return { items };
  }

  async reviewEvidence(principal: AuthPrincipal, relationId: string, evidenceId: string, input: EvidenceReviewInput) {
    const relation = await this.prisma.dependentRelation.findUnique({ where: { id: this.id(relationId, "relationId") } });
    if (!relation) throw new NotFoundException("Dependent relationship not found.");
    const evidence = await this.prisma.legalAuthorityEvidence.findFirst({ where: { id: this.id(evidenceId, "evidenceId"), relationId: relation.id } });
    if (!evidence) throw new NotFoundException("Authority evidence not found.");
    const status = normalizeEvidenceReviewStatus(input?.status);
    const reasonCode = normalizeReasonCode(input?.reasonCode, status === "REJECTED");
    const updated = await this.prisma.legalAuthorityEvidence.update({ where: { id: evidence.id }, data: { status, reviewedAt: new Date(), reviewedByActorId: principal.accountId, reasonCode } });
    await this.audit.write({ actorId: principal.accountId, action: `DEPENDENT_EVIDENCE_${status}`, objectType: "LEGAL_AUTHORITY_EVIDENCE", objectId: evidence.id, purpose: "ACCESS_GOVERNANCE", result: "SUCCESS", metadata: { relationId: relation.id, patientId: relation.dependentPatientId, evidenceType: evidence.evidenceType, status } });
    return this.presentEvidence(updated);
  }

  async reviewRelation(principal: AuthPrincipal, relationId: string, input: RelationReviewInput) {
    const id = this.id(relationId, "relationId");
    const decision = normalizeAuthorityReviewDecision(input?.decision);
    const reasonCode = normalizeReasonCode(input?.reasonCode, decision === "REJECT");
    const row = await this.prisma.dependentRelation.findUnique({ where: { id }, include: { evidence: true } });
    if (!row) throw new NotFoundException("Dependent relationship not found.");
    if (row.status !== "PENDING_REVIEW") throw new ConflictException("Only PENDING_REVIEW relationships can be reviewed.");
    if (decision === "APPROVE") {
      const now = new Date();
      const verified = row.evidence.filter((item) => item.status === "VERIFIED" && (!item.expiresAt || item.expiresAt.getTime() > now.getTime()));
      const rejected = row.evidence.some((item) => item.status === "REJECTED");
      if (verified.length === 0 || rejected) throw new ConflictException("Approval requires current verified authority evidence and no rejected evidence.");
      if (row.validUntil && row.validUntil.getTime() <= now.getTime()) throw new ConflictException("Dependent authority validity has expired.");
    }
    const status = decision === "APPROVE" ? "VERIFIED" : "REJECTED";
    const updated = await this.prisma.$transaction(async (tx) => {
      const relation = await tx.dependentRelation.update({ where: { id }, data: { status, verifiedAt: decision === "APPROVE" ? new Date() : null, verifiedByActorId: principal.accountId, reasonCode } });
      if (decision === "REJECT") await tx.patientContextSession.deleteMany({ where: { relationId: id } });
      await this.audit.writeInTransaction(tx, { actorId: principal.accountId, action: `DEPENDENT_RELATION_${status}`, objectType: "DEPENDENT_RELATION", objectId: id, purpose: "ACCESS_GOVERNANCE", result: "SUCCESS", metadata: { patientId: row.dependentPatientId, relationId: id, relationshipType: row.relationshipType, status } });
      return relation;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return { id: updated.id, status: updated.status, verifiedAt: updated.verifiedAt, reasonCode: updated.reasonCode };
  }

  async dependentConsents(principal: AuthPrincipal, patientId: string) {
    this.requirePatient(principal);
    const relation = await this.contexts.effectiveRelation(principal.accountId, this.id(patientId, "patientId"), "CONSENT_MANAGE");
    const rows = await this.prisma.consent.findMany({ where: { patientId: relation.dependentPatientId }, orderBy: { grantedAt: "desc" }, take: 200 });
    return { patientId: relation.dependentPatientId, relationId: relation.id, items: rows.map((row) => ({ id: row.id, providerId: row.providerId, scope: row.scope, version: row.version, purpose: row.purpose, state: row.state, grantedAt: row.grantedAt, revokedAt: row.revokedAt, expiresAt: row.expiresAt })) };
  }

  async grantDependentConsent(principal: AuthPrincipal, patientId: string, input: GrantDependentConsentInput) {
    this.requirePatient(principal);
    const relation = await this.contexts.effectiveRelation(principal.accountId, this.id(patientId, "patientId"), "CONSENT_MANAGE");
    const providerId = input?.providerId?.trim() || null;
    const provider = providerId ? await this.prisma.provider.findUnique({ where: { id: providerId }, select: { id: true, status: true, class: true } }) : null;
    if (providerId && (!provider || provider.status !== "ACTIVE")) throw new BadRequestException("Consent target provider must be active.");
    const purpose = this.purpose(input?.purpose);
    const contract = validateClinicalConsentGrantContract({ scope: input?.scope, version: input?.version, purpose, providerRole: provider?.class ?? null });
    const expiresAt = this.optionalFutureDate(input?.expiresAt, "expiresAt");
    const consent = await this.prisma.consent.create({ data: { patientId: relation.dependentPatientId, providerId, scope: contract.scope, version: contract.version, purpose: contract.purpose, state: "GRANTED", ...(expiresAt ? { expiresAt } : {}) } });
    await this.audit.write({ actorId: principal.accountId, action: "DEPENDENT_CONSENT_GRANTED", objectType: "CONSENT", objectId: consent.id, purpose: "PROXY_PATIENT_ACCESS", result: "SUCCESS", metadata: { patientId: relation.dependentPatientId, relationId: relation.id, providerId, scope: consent.scope } });
    return { id: consent.id, patientId: relation.dependentPatientId, providerId: consent.providerId, scope: consent.scope, version: consent.version, purpose: consent.purpose, state: consent.state, expiresAt: consent.expiresAt };
  }

  async revokeDependentConsent(principal: AuthPrincipal, patientId: string, consentId: string) {
    this.requirePatient(principal);
    const relation = await this.contexts.effectiveRelation(principal.accountId, this.id(patientId, "patientId"), "CONSENT_MANAGE");
    const consent = await this.prisma.consent.findUnique({ where: { id: this.id(consentId, "consentId") } });
    if (!consent || consent.patientId !== relation.dependentPatientId) throw new NotFoundException("Dependent consent not found.");
    if (consent.state === "REVOKED") return { id: consent.id, state: consent.state, revokedAt: consent.revokedAt };
    const updated = await this.prisma.consent.update({ where: { id: consent.id }, data: { state: "REVOKED", revokedAt: new Date() } });
    await this.audit.write({ actorId: principal.accountId, action: "DEPENDENT_CONSENT_REVOKED", objectType: "CONSENT", objectId: updated.id, purpose: "PROXY_PATIENT_ACCESS", result: "SUCCESS", metadata: { patientId: relation.dependentPatientId, relationId: relation.id, scope: updated.scope } });
    return { id: updated.id, state: updated.state, revokedAt: updated.revokedAt };
  }

  private evidence(value: unknown): Array<{ evidenceType: string; referenceId: string; issuedAt?: Date; expiresAt?: Date }> {
    if (!Array.isArray(value) || value.length > 20) throw new BadRequestException("evidence must be an array with at most 20 references.");
    return value.map((raw) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new BadRequestException("Each evidence item must be an object.");
      const item = raw as EvidenceInput;
      const issuedAt = this.optionalDate(item.issuedAt, "evidence.issuedAt");
      const expiresAt = this.optionalDate(item.expiresAt, "evidence.expiresAt");
      if (issuedAt && expiresAt && expiresAt <= issuedAt) throw new BadRequestException("evidence.expiresAt must be after issuedAt.");
      return { evidenceType: normalizeEvidenceType(item.evidenceType), referenceId: normalizeReferenceId(item.referenceId), ...(issuedAt ? { issuedAt } : {}), ...(expiresAt ? { expiresAt } : {}) };
    });
  }

  private presentRelation(row: any, dependent: { id: string; firstName: string; lastName: string } | null) {
    return { id: row.id, dependentPatientId: row.dependentPatientId, dependent: dependent ? { id: dependent.id, displayName: `${dependent.firstName} ${dependent.lastName}`.trim() } : null, relationshipType: row.relationshipType, status: row.status, scopes: this.scopes(row.scopes), validFrom: row.validFrom, validUntil: row.validUntil, verifiedAt: row.verifiedAt, revokedAt: row.revokedAt, effective: authorityIsEffective(row), clinicalAccessEnabled: Boolean(dependent && authorityIsEffective(row)) };
  }

  private presentEvidence(row: any) {
    return { id: row.id, evidenceType: row.evidenceType, referenceId: row.referenceId, status: row.status, issuedAt: row.issuedAt, expiresAt: row.expiresAt, reviewedAt: row.reviewedAt, reasonCode: row.reasonCode };
  }

  private scopes(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; }
  private id(value: unknown, field: string): string { if (typeof value !== "string") throw new BadRequestException(`${field} is required.`); const normalized = value.trim(); if (!/^[A-Za-z0-9_.:-]{1,180}$/.test(normalized)) throw new BadRequestException(`${field} is invalid.`); return normalized; }
  private optionalDate(value: unknown, field: string): Date | null { if (value == null || value === "") return null; if (typeof value !== "string") throw new BadRequestException(`${field} must be an ISO date-time.`); const parsed = new Date(value); if (!Number.isFinite(parsed.getTime())) throw new BadRequestException(`${field} must be an ISO date-time.`); return parsed; }
  private optionalFutureDate(value: unknown, field: string): Date | null { const parsed = this.optionalDate(value, field); if (parsed && parsed.getTime() <= Date.now()) throw new BadRequestException(`${field} must be in the future.`); return parsed; }
  private purpose(value: unknown): string | null { if (value == null || value === "") return null; if (typeof value !== "string") throw new BadRequestException("purpose is invalid."); const normalized = value.trim().toUpperCase(); if (!/^[A-Z][A-Z0-9_:-]{1,63}$/.test(normalized)) throw new BadRequestException("purpose is invalid."); return normalized; }
  private requirePatient(principal: AuthPrincipal) { if (principal.role !== "PATIENT") throw new ForbiddenException("Dependent management is available only to PATIENT accounts."); }
}
