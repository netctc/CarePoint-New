import { generateTotpSecret, hashPassword, randomId, randomToken, tokenHash, verifyPassword, verifyTotp } from "./crypto.js";
import { AuditTrail } from "./audit.js";
import type { AccountRecord, AuthTokens, IdentityRole, LoginChallenge, PublicAccount, SessionRecord } from "./types.js";

const ACCESS_TTL = 15 * 60 * 1000;
const REFRESH_TTL = 30 * 24 * 60 * 60 * 1000;
const MFA_TTL = 5 * 60 * 1000;
const LOCKOUT_TTL = 15 * 60 * 1000;

export class AuthCore {
  private readonly audit: AuditTrail;
  private readonly accounts = new Map<string, AccountRecord>();
  private readonly byEmail = new Map<string, string>();
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly challenges = new Map<string, { accountId: string; expiresAt: number }>();
  constructor(audit: AuditTrail) { this.audit = audit; }

  createAccount(input: { email: string; password: string; role: IdentityRole }): PublicAccount {
    const email = input.email.trim().toLowerCase();
    if (!email.includes("@")) throw new Error("A valid email address is required.");
    if (this.byEmail.has(email)) throw new Error("Account already exists.");
    const now = new Date().toISOString();
    const account: AccountRecord = { id: randomId("acct"), email, role: input.role, state: "ACTIVE", passwordHash: hashPassword(input.password), mfaEnabled: false, mfaSecret: null, failedLoginCount: 0, lockedUntil: null, createdAt: now, updatedAt: now };
    this.accounts.set(account.id, account); this.byEmail.set(email, account.id);
    this.audit.append(null, "ACCOUNT_CREATED", "ACCOUNT", account.id, "SUCCESS", { role: account.role });
    return this.safe(account);
  }

  getAccount(id: string): PublicAccount { return this.safe(this.require(id)); }
  getRole(id: string): IdentityRole { return this.require(id).role; }

  suspendAccount(actorId: string, accountId: string): PublicAccount {
    const account = this.require(accountId); account.state = "SUSPENDED"; account.updatedAt = new Date().toISOString();
    this.revokeAll(accountId, actorId); this.audit.append(actorId, "ACCOUNT_SUSPENDED", "ACCOUNT", accountId, "SUCCESS");
    return this.safe(account);
  }

  beginMfa(accountId: string): { secret: string; otpauthUri: string } {
    const account = this.require(accountId); const secret = generateTotpSecret(); account.mfaSecret = secret; account.mfaEnabled = false;
    const label = encodeURIComponent(`CarePoint:${account.email}`);
    this.audit.append(accountId, "MFA_ENROLLMENT_STARTED", "ACCOUNT", accountId, "SUCCESS");
    return { secret, otpauthUri: `otpauth://totp/${label}?secret=${secret}&issuer=CarePoint&algorithm=SHA1&digits=6&period=30` };
  }

  confirmMfa(accountId: string, code: string): void {
    const account = this.require(accountId);
    if (!account.mfaSecret || !verifyTotp(account.mfaSecret, code)) throw new Error("Invalid MFA code.");
    account.mfaEnabled = true; account.updatedAt = new Date().toISOString(); this.audit.append(accountId, "MFA_ENABLED", "ACCOUNT", accountId, "SUCCESS");
  }

  login(emailInput: string, password: string): AuthTokens | LoginChallenge {
    const accountId = this.byEmail.get(emailInput.trim().toLowerCase()); const account = accountId ? this.accounts.get(accountId) : undefined;
    if (!account) throw new Error("Invalid credentials.");
    if (account.state !== "ACTIVE") throw new Error("Account is not active.");
    if (account.lockedUntil && Date.parse(account.lockedUntil) > Date.now()) throw new Error("Account temporarily locked.");
    if (!verifyPassword(password, account.passwordHash)) {
      account.failedLoginCount += 1;
      if (account.failedLoginCount >= 5) { account.failedLoginCount = 0; account.lockedUntil = new Date(Date.now() + LOCKOUT_TTL).toISOString(); }
      this.audit.append(account.id, "LOGIN_FAILED", "ACCOUNT", account.id, "DENIED"); throw new Error("Invalid credentials.");
    }
    account.failedLoginCount = 0; account.lockedUntil = null;
    if (!account.mfaEnabled) return this.issue(account.id);
    const challengeId = randomId("mfa"); const expiresAt = Date.now() + MFA_TTL; this.challenges.set(challengeId, { accountId: account.id, expiresAt });
    return { requiresMfa: true, challengeId, accountId: account.id, expiresAt: new Date(expiresAt).toISOString() };
  }

  completeMfa(challengeId: string, code: string): AuthTokens {
    const challenge = this.challenges.get(challengeId);
    if (!challenge || challenge.expiresAt < Date.now()) throw new Error("MFA challenge expired or invalid.");
    const account = this.require(challenge.accountId);
    if (!account.mfaSecret || !account.mfaEnabled || !verifyTotp(account.mfaSecret, code)) throw new Error("Invalid MFA code.");
    this.challenges.delete(challengeId); this.audit.append(account.id, "MFA_CHALLENGE_VERIFIED", "ACCOUNT", account.id, "SUCCESS"); return this.issue(account.id);
  }

  refresh(refreshToken: string): AuthTokens {
    const hash = tokenHash(refreshToken); const current = [...this.sessions.values()].find((s) => s.refreshTokenHash === hash && !s.revokedAt);
    if (!current || Date.parse(current.refreshExpiresAt) <= Date.now()) throw new Error("Refresh token is invalid or expired.");
    current.revokedAt = new Date().toISOString(); const next = this.issue(current.accountId); current.replacedBySessionId = next.sessionId;
    this.audit.append(current.accountId, "SESSION_ROTATED", "SESSION", current.id, "SUCCESS", { replacementSessionId: next.sessionId }); return next;
  }

  validate(accessToken: string): { accountId: string; sessionId: string } {
    const hash = tokenHash(accessToken); const session = [...this.sessions.values()].find((s) => s.accessTokenHash === hash && !s.revokedAt);
    if (!session || Date.parse(session.expiresAt) <= Date.now()) throw new Error("Access token is invalid or expired.");
    return { accountId: session.accountId, sessionId: session.id };
  }

  revoke(sessionId: string, actorId: string | null = null): void {
    const session = this.sessions.get(sessionId); if (!session) return; session.revokedAt ??= new Date().toISOString();
    this.audit.append(actorId ?? session.accountId, "SESSION_REVOKED", "SESSION", sessionId, "SUCCESS");
  }

  revokeAll(accountId: string, actorId: string | null = null): void {
    for (const session of this.sessions.values()) if (session.accountId === accountId && !session.revokedAt) session.revokedAt = new Date().toISOString();
    this.audit.append(actorId ?? accountId, "ALL_SESSIONS_REVOKED", "ACCOUNT", accountId, "SUCCESS");
  }

  private issue(accountId: string): AuthTokens {
    const now = Date.now(); const accessToken = randomToken(); const refreshToken = randomToken(48);
    const session: SessionRecord = { id: randomId("ses"), accountId, accessTokenHash: tokenHash(accessToken), refreshTokenHash: tokenHash(refreshToken), createdAt: new Date(now).toISOString(), expiresAt: new Date(now + ACCESS_TTL).toISOString(), refreshExpiresAt: new Date(now + REFRESH_TTL).toISOString(), revokedAt: null, replacedBySessionId: null };
    this.sessions.set(session.id, session); this.audit.append(accountId, "LOGIN_SUCCEEDED", "SESSION", session.id, "SUCCESS");
    return { sessionId: session.id, accessToken, refreshToken, expiresAt: session.expiresAt, refreshExpiresAt: session.refreshExpiresAt };
  }

  private require(id: string): AccountRecord { const account = this.accounts.get(id); if (!account) throw new Error("Account not found."); return account; }
  private safe(account: AccountRecord): PublicAccount { const { passwordHash: _p, mfaSecret: _m, ...safe } = account; return structuredClone(safe); }
}
