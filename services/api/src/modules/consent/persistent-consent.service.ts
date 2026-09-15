import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { roleHasPermission, type AuthPrincipal } from "@carepoint/identity";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";

type ConsentRow = {
  id: string; patientId: string; providerId: string | null; scope: string; version: string; state: "GRANTED" | "REVOKED";
  grantedAt: Date; revokedAt: Date | null; expiresAt: Date | null;
};
type ProviderView = { displayName: string; status: string } | null;

@Injectable()
export class PersistentConsentService {
  constructor(private readonly prisma: PrismaService, private readonly audit: DatabaseAuditService) {}

  async grant(principal: AuthPrincipal, input: { providerId?: string; scope: string; version: string; expiresAt?: string }) {
    this.requirePatientConsentPermission(principal);
    if (!input.scope?.trim() || !input.version?.trim()) throw new BadRequestException("scope and version are required.");
    const patient = await this.patientForPrincipal(principal);
    const providerId = input.providerId?.trim() || null;
    const provider = providerId ? await this.provider(providerId) : null;
    if (providerId && (!provider || provider.status !== "ACTIVE")) throw new BadRequestException("Consent target provider must be active.");
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    if (expiresAt && (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now())) throw new BadRequestException("Consent expiry must be a future date.");
    const consent = await this.prisma.consent.create({
      data: { patientId: patient.id, providerId, scope: input.scope.trim(), version: input.version.trim(), state: "GRANTED", expiresAt },
    });
    await this.audit.write({ actorId: principal.accountId, action: "CONSENT_GRANTED", objectType: "CONSENT", objectId: consent.id, result: "SUCCESS", metadata: { scope: consent.scope, providerId: consent.providerId } });
    return this.present(consent, provider);
  }

  async listMine(principal: AuthPrincipal) {
    this.requirePatientConsentPermission(principal);
    const patient = await this.patientForPrincipal(principal);
    const rows = await this.prisma.consent.findMany({ where: { patientId: patient.id }, orderBy: { grantedAt: "desc" } });
    const providerIds = [...new Set(rows.map((row) => row.providerId).filter((id): id is string => Boolean(id)))];
    const providers = providerIds.length ? await this.prisma.provider.findMany({ where: { id: { in: providerIds } }, select: { id: true, displayName: true, status: true } }) : [];
    const byId = new Map(providers.map((row) => [row.id, { displayName: row.displayName, status: row.status }]));
    return rows.map((row) => this.present(row, row.providerId ? byId.get(row.providerId) ?? null : null));
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
    if (consent.state === "REVOKED") return this.present(consent, provider);
    const updated = await this.prisma.consent.update({ where: { id: consentId }, data: { state: "REVOKED", revokedAt: new Date() } });
    await this.audit.write({ actorId: principal.accountId, action: "CONSENT_REVOKED", objectType: "CONSENT", objectId: consentId, result: "SUCCESS", metadata: { scope: consent.scope } });
    return this.present(updated, provider);
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
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "Consent" WHERE id = ${consentId} FOR UPDATE`);
      const source = await tx.consent.findUnique({ where: { id: consentId } });
      if (!source || source.patientId !== patient.id) throw new ConflictException("Consent changed. Refresh before trying again.");
      const now = new Date();
      if (source.expiresAt && source.expiresAt.getTime() <= now.getTime()) throw new ConflictException("This historical consent has expired. A current consent version must be presented before granting again.");
      const provider = source.providerId ? await tx.provider.findUnique({ where: { id: source.providerId }, select: { displayName: true, status: true } }) : null;
      if (source.providerId && (!provider || provider.status !== "ACTIVE")) throw new ConflictException("The consent target provider is not active.");
      if (source.state === "GRANTED") return this.present(source, provider);
      const equivalent = await tx.consent.findFirst({ where: {
        patientId: patient.id, providerId: source.providerId, scope: source.scope, version: source.version, state: "GRANTED",
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      }, orderBy: { grantedAt: "desc" } });
      if (equivalent) return this.present(equivalent, provider);
      const created = await tx.consent.create({ data: {
        patientId: patient.id, providerId: source.providerId, scope: source.scope, version: source.version,
        state: "GRANTED", expiresAt: source.expiresAt,
      } });
      await this.audit.writeInTransaction(tx, { actorId: principal.accountId, action: "CONSENT_REGRANTED", objectType: "CONSENT", objectId: created.id, result: "SUCCESS", metadata: { scope: created.scope, providerId: created.providerId, sourceConsentId: source.id } });
      return this.present(created, provider);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private present(row: ConsentRow, provider: ProviderView) {
    const expired = row.expiresAt != null && row.expiresAt.getTime() <= Date.now();
    const effectiveState = row.state === "GRANTED" && expired ? "EXPIRED" : row.state;
    const providerActive = row.providerId == null || provider?.status === "ACTIVE";
    return {
      id: row.id, providerId: row.providerId, providerName: provider?.displayName ?? null,
      scope: row.scope, version: row.version, state: row.state, effectiveState,
      grantedAt: row.grantedAt, revokedAt: row.revokedAt, expiresAt: row.expiresAt,
      regrantable: row.state === "REVOKED" && !expired && providerActive,
    };
  }

  private async provider(providerId: string): Promise<ProviderView> {
    return this.prisma.provider.findUnique({ where: { id: providerId }, select: { displayName: true, status: true } });
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
