import { AuditTrail } from "./audit.js";
import { randomId } from "./crypto.js";
import type { ConsentRecord, CredentialState, IdentityRole, OnboardingKind, OnboardingRecord, ProviderAccessState } from "./types.js";

export class GovernanceCore {
  private readonly audit: AuditTrail;
  private readonly roleOf: (accountId: string) => IdentityRole;
  private readonly revokeSessions: (accountId: string, actorId: string) => void;
  private readonly onboardings = new Map<string, OnboardingRecord>();
  private readonly providerAccess = new Map<string, ProviderAccessState>();
  private readonly consents = new Map<string, ConsentRecord>();
  constructor(audit: AuditTrail, roleOf: (accountId: string) => IdentityRole, revokeSessions: (accountId: string, actorId: string) => void) { this.audit = audit; this.roleOf = roleOf; this.revokeSessions = revokeSessions; }

  startDoctor(input: { accountId: string; specialtyId: string }): OnboardingRecord {
    if (this.roleOf(input.accountId) !== "DOCTOR") throw new Error("Doctor onboarding requires a DOCTOR account.");
    if (!input.specialtyId.trim()) throw new Error("A medical specialty is required.");
    return this.create(input.accountId, "DOCTOR", input.specialtyId, null);
  }

  startOtherProvider(input: { accountId: string; providerCategoryId: string }): OnboardingRecord {
    if (this.roleOf(input.accountId) !== "OTHER_PROVIDER") throw new Error("Other Provider onboarding requires an OTHER_PROVIDER account. Doctors are excluded.");
    if (!input.providerCategoryId.trim()) throw new Error("A non-doctor provider category is required.");
    return this.create(input.accountId, "OTHER_PROVIDER", null, input.providerCategoryId);
  }

  addCredential(onboardingId: string, input: { type: string; number?: string; issuer?: string; validUntil?: string }): OnboardingRecord {
    const record = this.require(onboardingId);
    if (record.state !== "DRAFT" && record.state !== "REQUEST_CHANGES") throw new Error("Credentials can only be changed before review approval.");
    record.credentials.push({ id: randomId("cred"), type: input.type.trim(), number: input.number?.trim() || null, issuer: input.issuer?.trim() || null, validUntil: input.validUntil ?? null, state: "PENDING", reviewNote: null });
    record.updatedAt = new Date().toISOString(); return structuredClone(record);
  }

  submit(onboardingId: string): OnboardingRecord {
    const record = this.require(onboardingId); if (record.credentials.length === 0) throw new Error("At least one credential is required before submission.");
    record.state = "PENDING_REVIEW"; this.providerAccess.set(record.accountId, "PENDING_REVIEW"); record.submittedAt = new Date().toISOString(); record.updatedAt = record.submittedAt;
    this.audit.append(record.accountId, "ONBOARDING_SUBMITTED", "PROVIDER_ONBOARDING", record.id, "SUCCESS", { kind: record.kind }); return structuredClone(record);
  }

  reviewCredential(actorId: string, onboardingId: string, credentialId: string, state: CredentialState, note?: string): OnboardingRecord {
    const record = this.require(onboardingId); if (record.state !== "PENDING_REVIEW" && record.state !== "REQUEST_CHANGES") throw new Error("Onboarding is not under review.");
    const credential = record.credentials.find((c) => c.id === credentialId); if (!credential) throw new Error("Credential not found.");
    credential.state = state; credential.reviewNote = note?.trim() || null; if (state === "REJECTED") record.state = "REQUEST_CHANGES"; record.updatedAt = new Date().toISOString();
    this.audit.append(actorId, "CREDENTIAL_REVIEWED", "PROVIDER_CREDENTIAL", credential.id, "SUCCESS", { state }); return structuredClone(record);
  }

  approve(actorId: string, onboardingId: string): OnboardingRecord {
    const record = this.require(onboardingId); if (record.credentials.length === 0 || record.credentials.some((c) => c.state !== "VERIFIED")) throw new Error("All credentials must be verified before approval.");
    record.state = "APPROVED"; this.providerAccess.set(record.accountId, "ACTIVE"); record.reviewedAt = new Date().toISOString(); record.updatedAt = record.reviewedAt;
    this.audit.append(actorId, "ONBOARDING_APPROVED", "PROVIDER_ONBOARDING", record.id, "SUCCESS", { kind: record.kind }); return structuredClone(record);
  }

  providerState(accountId: string): ProviderAccessState {
    const role = this.roleOf(accountId); if (role !== "DOCTOR" && role !== "OTHER_PROVIDER") throw new Error("Account is not a provider."); return this.providerAccess.get(accountId) ?? "DRAFT";
  }

  suspendProvider(actorId: string, accountId: string): ProviderAccessState {
    const role = this.roleOf(accountId); if (role !== "DOCTOR" && role !== "OTHER_PROVIDER") throw new Error("Account is not a provider.");
    this.providerAccess.set(accountId, "SUSPENDED"); this.revokeSessions(accountId, actorId); this.audit.append(actorId, "PROVIDER_SUSPENDED", "ACCOUNT", accountId, "SUCCESS", { role }); return "SUSPENDED";
  }

  listOnboardings(): OnboardingRecord[] { return [...this.onboardings.values()].map((x) => structuredClone(x)); }

  grantConsent(input: { patientId: string; providerId?: string; scope: string; version: string; expiresAt?: string }): ConsentRecord {
    if (!input.patientId.trim() || !input.scope.trim() || !input.version.trim()) throw new Error("patientId, scope and version are required.");
    const consent: ConsentRecord = { id: randomId("consent"), patientId: input.patientId, providerId: input.providerId?.trim() || null, scope: input.scope, version: input.version, state: "GRANTED", grantedAt: new Date().toISOString(), revokedAt: null, expiresAt: input.expiresAt ?? null };
    this.consents.set(consent.id, consent); this.audit.append(input.patientId, "CONSENT_GRANTED", "CONSENT", consent.id, "SUCCESS", { scope: consent.scope, providerId: consent.providerId }); return structuredClone(consent);
  }

  revokeConsent(consentId: string, actorId: string): ConsentRecord {
    const consent = this.consents.get(consentId); if (!consent) throw new Error("Consent not found."); consent.state = "REVOKED"; consent.revokedAt = new Date().toISOString();
    this.audit.append(actorId, "CONSENT_REVOKED", "CONSENT", consent.id, "SUCCESS", { scope: consent.scope }); return structuredClone(consent);
  }

  listConsents(patientId: string): ConsentRecord[] { return [...this.consents.values()].filter((x) => x.patientId === patientId).map((x) => structuredClone(x)); }

  private create(accountId: string, kind: OnboardingKind, specialtyId: string | null, providerCategoryId: string | null): OnboardingRecord {
    const now = new Date().toISOString(); const record: OnboardingRecord = { id: randomId("onb"), accountId, kind, specialtyId, providerCategoryId, state: "DRAFT", credentials: [], submittedAt: null, reviewedAt: null, createdAt: now, updatedAt: now };
    this.onboardings.set(record.id, record); this.providerAccess.set(accountId, "DRAFT"); this.audit.append(accountId, "ONBOARDING_STARTED", "PROVIDER_ONBOARDING", record.id, "SUCCESS", { kind }); return structuredClone(record);
  }
  private require(id: string): OnboardingRecord { const record = this.onboardings.get(id); if (!record) throw new Error("Onboarding not found."); return record; }
}
