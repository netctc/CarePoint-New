import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { roleHasPermission, type AuthPrincipal } from "@carepoint/identity";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";

@Injectable()
export class PersistentConsentService {
  constructor(private readonly prisma: PrismaService, private readonly audit: DatabaseAuditService) {}

  async grant(principal: AuthPrincipal, input: { providerId?: string; scope: string; version: string; expiresAt?: string }) {
    this.requirePatientConsentPermission(principal);
    if (!input.scope?.trim() || !input.version?.trim()) throw new BadRequestException("scope and version are required.");
    const patient = await this.patientForPrincipal(principal);
    if (input.providerId) {
      const provider = await this.prisma.provider.findUnique({ where: { id: input.providerId }, select: { id: true, status: true } });
      if (!provider || provider.status !== "ACTIVE") throw new BadRequestException("Consent target provider must be active.");
    }
    const consent = await this.prisma.consent.create({
      data: {
        patientId: patient.id,
        providerId: input.providerId?.trim() || null,
        scope: input.scope.trim(),
        version: input.version.trim(),
        state: "GRANTED",
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      },
    });
    await this.audit.write({ actorId: principal.accountId, action: "CONSENT_GRANTED", objectType: "CONSENT", objectId: consent.id, result: "SUCCESS", metadata: { scope: consent.scope, providerId: consent.providerId } });
    return consent;
  }

  async listMine(principal: AuthPrincipal) {
    this.requirePatientConsentPermission(principal);
    const patient = await this.patientForPrincipal(principal);
    return this.prisma.consent.findMany({ where: { patientId: patient.id }, orderBy: { grantedAt: "desc" } });
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
    if (consent.state === "REVOKED") return consent;
    const updated = await this.prisma.consent.update({ where: { id: consentId }, data: { state: "REVOKED", revokedAt: new Date() } });
    await this.audit.write({ actorId: principal.accountId, action: "CONSENT_REVOKED", objectType: "CONSENT", objectId: consentId, result: "SUCCESS", metadata: { scope: consent.scope } });
    return updated;
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
