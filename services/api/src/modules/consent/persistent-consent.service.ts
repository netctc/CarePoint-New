import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { roleHasPermission, type AuthPrincipal } from "@carepoint/identity";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import {
  ConsentPolicyGovernanceService,
  RUNTIME_CONSENT_JURISDICTION,
  type ConsentPolicyPresentation,
} from "../clinical-governance/consent-policy-governance.service";

type ConsentRow = {
  id: string; patientId: string; providerId: string | null; scope: string; version: string; purpose?: string | null; state: "GRANTED" | "REVOKED";
  grantedAt: Date; revokedAt: Date | null; expiresAt: Date | null; policyVersionId: string | null; policyJurisdiction: string | null;
};
type ProviderView = { displayName: string; status: string; class: "DOCTOR" | "OTHER_PROVIDER" } | null;

@Injectable()
export class PersistentConsentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly policies: ConsentPolicyGovernanceService,
  ) {}

  async grant(principal: AuthPrincipal, input: { providerId?: string; scope: string; version: string; purpose?: string; expiresAt?: string }) {
    this.requirePatientConsentPermission(principal);
    if (!input.scope?.trim() || !input.version?.trim()) throw new BadRequestException("scope and version are required.");
    const patient = await this.patientForPrincipal(principal);
    const purpose = this.normalizePurpose(input.purpose);
    const providerId = input.providerId?.trim() || null;
    const provider = providerId ? await this.provider(providerId) : null;
    if (providerId && (!provider || provider.status !== "ACTIVE")) throw new BadRequestException("Consent target provider must be active.");
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    if (expiresAt && (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now())) throw new BadRequestException("Consent expiry must be a future date.");
    const contract = await this.policies.validateGrant({
      scope: input.scope, version: input.version, purpose,
      providerRole: provider?.class ?? null, expiresAt,
      jurisdiction: RUNTIME_CONSENT_JURISDICTION,
    });
    const consent = await this.prisma.consent.create({ data: {
      patientId: patient.id, providerId, scope: contract.scope, version: contract.version,
      purpose: contract.purpose, state: "GRANTED", expiresAt,
      policyVersionId: contract.policyVersionId, policyJurisdiction: contract.policyJurisdiction,
    } });
    await this.audit.write({
      actorId: principal.accountId, action: "CONSENT_GRANTED", objectType: "CONSENT", objectId: consent.id, result: "SUCCESS",
      metadata: {
        scope: consent.scope, providerId: consent.providerId,
        policyVersionId: consent.policyVersionId, policyJurisdiction: consent.policyJurisdiction,
        ...(consent.purpose ? { purpose: consent.purpose } : {}),
      },
    });
    return this.present(consent, provider, contract.policy);
  }

  async listMine(principal: AuthPrincipal) {
    this.requirePatientConsentPermission(principal);
    const patient = await this.patientForPrincipal(principal);
    const rows = await this.prisma.consent.findMany({ where: { patientId: patient.id }, orderBy: { grantedAt: "desc" } });
    const providerIds = [...new Set(rows.map((row) => row.providerId).filter((id): id is string => Boolean(id)))];
    const policyIds = [...new Set(rows.map((row) => row.policyVersionId).filter((id): id is string => Boolean(id)))];
    const [providers, policyById] = await Promise.all([
      providerIds.length ? this.prisma.provider.findMany({
        where: { id: { in: providerIds } }, select: { id: true, displayName: true, status: true, class: true },
      }) : Promise.resolve([]),
      this.policies.presentationsByIds(policyIds),
    ]);
    const byId = new Map(providers.map((row) => [row.id, { displayName: row.displayName, status: row.status, class: row.class }]));
    return rows.map((row) => this.present(
      row,
      row.providerId ? byId.get(row.providerId) ?? null : null,
      row.policyVersionId ? policyById.get(row.policyVersionId) ?? null : null,
    ));
  }

  async revoke(principal: AuthPrincipal, consentId: string) {
    this.requirePatientConsentPermission(principal);
    const patient = await this.patientForPrincipal(principal);
    const consent = await this.prisma.consent.findUnique({ where: { id: consentId } });
    if (!consent) throw new NotFoundException("Consent not found.");
    if (consent.patientId !== patient.id) {
      await this.audit.write({ actorId: principal.accountId, action: "CONSENT_REVOKE_DENIED", objectType: "CONSENT", objectId: consentId, result: "DENIED" });
      throw new ForbiddenException("Consent access denied.");
    }
    const provider = consent.providerId ? await this.provider(consent.providerId) : null;
    if (consent.state === "REVOKED") return this.present(consent, provider, await this.presentation(consent.policyVersionId));
    const updated = await this.prisma.consent.update({ where: { id: consentId }, data: { state: "REVOKED", revokedAt: new Date() } });
    await this.audit.write({ actorId: principal.accountId, action: "CONSENT_REVOKED", objectType: "CONSENT", objectId: consentId, result: "SUCCESS", metadata: { scope: consent.scope, policyVersionId: consent.policyVersionId } });
    return this.present(updated, provider, await this.presentation(updated.policyVersionId));
  }

  async regrant(principal: AuthPrincipal, consentId: string) {
    this.requirePatientConsentPermission(principal);
    const patient = await this.patientForPrincipal(principal);
    const visible = await this.prisma.consent.findUnique({ where: { id: consentId } });
    if (!visible) throw new NotFoundException("Consent not found.");
    if (visible.patientId !== patient.id) {
      await this.audit.write({ actorId: principal.accountId, action: "CONSENT_REGRANT_DENIED", objectType: "CONSENT", objectId: consentId, result: "DENIED" });
      throw new ForbiddenException("Consent access denied.");
    }
    const previewProvider = visible.providerId ? await this.provider(visible.providerId) : null;
    const historicalPresentation = await this.presentation(visible.policyVersionId);
    if (visible.state === "GRANTED") return this.present(visible, previewProvider, historicalPresentation);
    let currentContract: Awaited<ReturnType<ConsentPolicyGovernanceService["validateGrant"]>>;
    try {
      currentContract = await this.policies.validateGrant({
        scope: visible.scope, version: visible.version, purpose: visible.purpose ?? null,
        providerRole: previewProvider?.class ?? null, expiresAt: visible.expiresAt,
        jurisdiction: RUNTIME_CONSENT_JURISDICTION, regrant: true,
      });
    } catch {
      throw new ConflictException("This historical consent no longer matches the active policy. Grant a new current consent instead.");
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "Consent" WHERE id = ${consentId} FOR UPDATE`);
      const source = await tx.consent.findUnique({ where: { id: consentId } });
      if (!source || source.patientId !== patient.id) throw new ConflictException("Consent changed. Refresh before trying again.");
      const now = new Date();
      if (source.expiresAt && source.expiresAt.getTime() <= now.getTime()) throw new ConflictException("This historical consent has expired. A current consent version must be presented before granting again.");
      const provider = source.providerId ? await tx.provider.findUnique({
        where: { id: source.providerId }, select: { displayName: true, status: true, class: true },
      }) : null;
      if (source.providerId && (!provider || provider.status !== "ACTIVE")) throw new ConflictException("The consent target provider is not active.");
      if (source.state === "GRANTED") return this.present(source, provider, historicalPresentation);

      const equivalent = await tx.consent.findFirst({ where: {
        patientId: patient.id, providerId: source.providerId, scope: currentContract.scope,
        version: currentContract.version, purpose: currentContract.purpose ?? null,
        policyVersionId: currentContract.policyVersionId, state: "GRANTED",
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      }, orderBy: { grantedAt: "desc" } });
      if (equivalent) return this.present(equivalent, provider, currentContract.policy);

      const created = await tx.consent.create({ data: {
        patientId: patient.id, providerId: source.providerId, scope: currentContract.scope,
        version: currentContract.version, purpose: currentContract.purpose ?? null, state: "GRANTED",
        expiresAt: source.expiresAt, policyVersionId: currentContract.policyVersionId,
        policyJurisdiction: currentContract.policyJurisdiction,
      } });
      await this.audit.writeInTransaction(tx, {
        actorId: principal.accountId, action: "CONSENT_REGRANTED", objectType: "CONSENT", objectId: created.id, result: "SUCCESS",
        metadata: {
          scope: created.scope, providerId: created.providerId, sourceConsentId: source.id,
          sourcePolicyVersionId: source.policyVersionId, policyVersionId: created.policyVersionId,
        },
      });
      return this.present(created, provider, currentContract.policy);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private present(row: ConsentRow, provider: ProviderView, policy: ConsentPolicyPresentation | null) {
    const expired = row.expiresAt != null && row.expiresAt.getTime() <= Date.now();
    const effectiveState = row.state === "GRANTED" && expired ? "EXPIRED" : row.state;
    const providerActive = row.providerId == null || provider?.status === "ACTIVE";
    return {
      id: row.id, providerId: row.providerId, providerName: provider?.displayName ?? null,
      scope: row.scope, version: row.version, purpose: row.purpose ?? null, state: row.state, effectiveState,
      grantedAt: row.grantedAt, revokedAt: row.revokedAt, expiresAt: row.expiresAt,
      policyVersionId: row.policyVersionId, policyJurisdiction: row.policyJurisdiction, policy,
      regrantable: row.state === "REVOKED" && !expired && providerActive && (policy?.regrantAllowed ?? true),
    };
  }

  private async presentation(policyVersionId: string | null) {
    if (!policyVersionId) return null;
    return (await this.policies.presentationsByIds([policyVersionId])).get(policyVersionId) ?? null;
  }

  private normalizePurpose(value: string | undefined): string | null {
    if (value == null || value.trim() === "") return null;
    const normalized = value.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_:-]{1,63}$/.test(normalized)) throw new BadRequestException("purpose must be a structured token.");
    return normalized;
  }

  private async provider(providerId: string): Promise<ProviderView> {
    return this.prisma.provider.findUnique({ where: { id: providerId }, select: { displayName: true, status: true, class: true } });
  }

  private requirePatientConsentPermission(principal: AuthPrincipal): void {
    if (!roleHasPermission(principal.role, "PATIENT_MANAGE_CONSENT")) throw new ForbiddenException("Patient consent permission is required.");
  }

  private async patientForPrincipal(principal: AuthPrincipal) {
    const patient = await this.prisma.patientProfile.findUnique({ where: { userId: principal.accountId } });
    if (!patient) throw new NotFoundException("Patient profile not found.");
    return patient;
  }
}
