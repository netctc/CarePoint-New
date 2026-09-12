export type IdentityRole = "PATIENT" | "DOCTOR" | "OTHER_PROVIDER" | "ADMIN" | "SUPPORT";
export type AccountState = "ACTIVE" | "SUSPENDED" | "ARCHIVED";
export type OnboardingKind = "DOCTOR" | "OTHER_PROVIDER";
export type OnboardingState = "DRAFT" | "PENDING_REVIEW" | "REQUEST_CHANGES" | "APPROVED" | "REJECTED";
export type CredentialState = "PENDING" | "VERIFIED" | "REJECTED";
export type ConsentState = "GRANTED" | "REVOKED";
export type ProviderAccessState = "DRAFT" | "PENDING_REVIEW" | "ACTIVE" | "SUSPENDED";
export type AuditResult = "SUCCESS" | "DENIED" | "FAILED";

export interface AuditEntry { id: string; actorId: string | null; action: string; objectType: string; objectId: string | null; result: AuditResult; metadata: Record<string, unknown>; occurredAt: string; }
export interface AccountRecord { id: string; email: string; role: IdentityRole; state: AccountState; passwordHash: string; mfaEnabled: boolean; mfaSecret: string | null; failedLoginCount: number; lockedUntil: string | null; createdAt: string; updatedAt: string; }
export type PublicAccount = Omit<AccountRecord, "passwordHash" | "mfaSecret">;
export interface SessionRecord { id: string; accountId: string; accessTokenHash: string; refreshTokenHash: string; createdAt: string; expiresAt: string; refreshExpiresAt: string; revokedAt: string | null; replacedBySessionId: string | null; }
export interface AuthTokens { sessionId: string; accessToken: string; refreshToken: string; expiresAt: string; refreshExpiresAt: string; }
export interface LoginChallenge { requiresMfa: true; challengeId: string; accountId: string; expiresAt: string; }
export interface CredentialRecord { id: string; type: string; number: string | null; issuer: string | null; validUntil: string | null; state: CredentialState; reviewNote: string | null; }
export interface OnboardingRecord { id: string; accountId: string; kind: OnboardingKind; specialtyId: string | null; providerCategoryId: string | null; state: OnboardingState; credentials: CredentialRecord[]; submittedAt: string | null; reviewedAt: string | null; createdAt: string; updatedAt: string; }
export interface ConsentRecord { id: string; patientId: string; providerId: string | null; scope: string; version: string; state: ConsentState; grantedAt: string; revokedAt: string | null; expiresAt: string | null; }
