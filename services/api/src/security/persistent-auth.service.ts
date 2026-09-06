import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import {
  canActOnAccount,
  hashPassword,
  randomId,
  randomToken,
  tokenHash,
  verifyPassword,
  verifyTotp,
  generateTotpSecret,
  type AuthPrincipal,
  type IdentityRole,
} from "@carepoint/identity";
import type { EncryptedEnvelope } from "@carepoint/security";
import { PrismaService } from "../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../infrastructure/audit/audit.service";
import { MfaEnvelopeService } from "../infrastructure/security/mfa-envelope.service";

const ACCESS_TTL_MS = 15 * 60 * 1000;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MFA_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const LOCKOUT_TTL_MS = 15 * 60 * 1000;
const MAX_FAILED_LOGINS = 5;

export interface SessionTokens {
  sessionId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  refreshExpiresAt: string;
}

@Injectable()
export class PersistentAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly mfaEnvelope: MfaEnvelopeService,
  ) {}

  async registerPatient(input: { email: string; password: string; firstName: string; lastName: string; phone?: string }) {
    const email = this.normalizeEmail(input.email);
    if (!input.firstName?.trim() || !input.lastName?.trim()) throw new BadRequestException("firstName and lastName are required.");
    await this.ensureEmailAvailable(email);
    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash: hashPassword(input.password),
        role: "PATIENT",
        patientProfile: {
          create: {
            firstName: input.firstName.trim(),
            lastName: input.lastName.trim(),
            phone: input.phone?.trim() || null,
          },
        },
      },
    });
    await this.audit.write({ action: "PATIENT_ACCOUNT_REGISTERED", objectType: "ACCOUNT", objectId: user.id, result: "SUCCESS" });
    return this.safeAccount(user);
  }

  async createManagedAccount(actorId: string, input: { email: string; password: string; role: IdentityRole }) {
    const email = this.normalizeEmail(input.email);
    await this.ensureEmailAvailable(email);
    const user = await this.prisma.user.create({ data: { email, passwordHash: hashPassword(input.password), role: input.role } });
    await this.audit.write({ actorId, action: "ACCOUNT_CREATED", objectType: "ACCOUNT", objectId: user.id, result: "SUCCESS", metadata: { role: user.role } });
    return this.safeAccount(user);
  }

  async getAccount(principal: AuthPrincipal, accountId: string) {
    if (!canActOnAccount(principal, accountId)) {
      await this.denied(principal, "ACCOUNT_READ_DENIED", "ACCOUNT", accountId);
      throw new ForbiddenException("Account access denied.");
    }
    const user = await this.prisma.user.findUnique({ where: { id: accountId } });
    if (!user) throw new NotFoundException("Account not found.");
    return this.safeAccount(user);
  }

  async login(emailInput: string, password: string): Promise<SessionTokens | { requiresMfa: true; challengeId: string; expiresAt: string }> {
    const email = this.normalizeEmail(emailInput);
    const user = await this.prisma.user.findUnique({ where: { email }, include: { mfaEnrollment: true } });
    if (!user) throw new UnauthorizedException("Invalid credentials.");
    if (user.status !== "ACTIVE") throw new UnauthorizedException("Account is not active.");
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) throw new UnauthorizedException("Account temporarily locked.");

    if (!verifyPassword(password, user.passwordHash)) {
      const nextFailures = user.failedLoginCount + 1;
      const shouldLock = nextFailures >= MAX_FAILED_LOGINS;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: shouldLock ? 0 : nextFailures,
          lockedUntil: shouldLock ? new Date(Date.now() + LOCKOUT_TTL_MS) : null,
        },
      });
      await this.audit.write({ actorId: user.id, action: "LOGIN_FAILED", objectType: "ACCOUNT", objectId: user.id, result: "DENIED", metadata: { lockoutApplied: shouldLock } });
      throw new UnauthorizedException("Invalid credentials.");
    }

    await this.prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } });

    if (user.mfaEnrollment?.enabledAt) {
      const challengeId = randomId("mfa");
      const expiresAt = new Date(Date.now() + MFA_CHALLENGE_TTL_MS);
      await this.prisma.authChallenge.create({ data: { id: challengeId, userId: user.id, type: "MFA_LOGIN", expiresAt } });
      await this.audit.write({ actorId: user.id, action: "MFA_CHALLENGE_ISSUED", objectType: "AUTH_CHALLENGE", objectId: challengeId, result: "SUCCESS" });
      return { requiresMfa: true, challengeId, expiresAt: expiresAt.toISOString() };
    }

    return this.issueSession(user.id);
  }

  async beginMfa(principal: AuthPrincipal): Promise<{ secret: string; otpauthUri: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: principal.accountId } });
    if (!user) throw new NotFoundException("Account not found.");
    const secret = generateTotpSecret();
    const envelope = await this.mfaEnvelope.encryptSecret(secret);
    await this.prisma.mfaEnrollment.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        version: envelope.version,
        algorithm: envelope.algorithm,
        keyId: envelope.keyId,
        wrappedKey: envelope.wrappedKey,
        iv: envelope.iv,
        secretCiphertext: envelope.ciphertext,
      },
      update: {
        version: envelope.version,
        algorithm: envelope.algorithm,
        keyId: envelope.keyId,
        wrappedKey: envelope.wrappedKey,
        iv: envelope.iv,
        secretCiphertext: envelope.ciphertext,
        enabledAt: null,
      },
    });
    const label = encodeURIComponent(`CarePoint:${user.email}`);
    await this.audit.write({ actorId: user.id, action: "MFA_ENROLLMENT_STARTED", objectType: "ACCOUNT", objectId: user.id, result: "SUCCESS" });
    return { secret, otpauthUri: `otpauth://totp/${label}?secret=${secret}&issuer=CarePoint&algorithm=SHA1&digits=6&period=30` };
  }

  async confirmMfa(principal: AuthPrincipal, code: string): Promise<void> {
    const row = await this.prisma.mfaEnrollment.findUnique({ where: { userId: principal.accountId } });
    if (!row) throw new BadRequestException("MFA enrollment has not been started.");
    const secret = await this.mfaEnvelope.decryptSecret(this.toEnvelope(row));
    if (!verifyTotp(secret, code)) throw new BadRequestException("Invalid MFA code.");
    await this.prisma.mfaEnrollment.update({ where: { userId: principal.accountId }, data: { enabledAt: new Date() } });
    await this.audit.write({ actorId: principal.accountId, action: "MFA_ENABLED", objectType: "ACCOUNT", objectId: principal.accountId, result: "SUCCESS" });
  }

  async completeMfa(challengeId: string, code: string): Promise<SessionTokens> {
    const challenge = await this.prisma.authChallenge.findUnique({ where: { id: challengeId }, include: { user: { include: { mfaEnrollment: true } } } });
    if (!challenge || challenge.type !== "MFA_LOGIN" || challenge.consumedAt || challenge.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException("MFA challenge expired or invalid.");
    }
    const enrollment = challenge.user.mfaEnrollment;
    if (!enrollment?.enabledAt) throw new UnauthorizedException("MFA is not enabled.");
    const secret = await this.mfaEnvelope.decryptSecret(this.toEnvelope(enrollment));
    if (!verifyTotp(secret, code)) throw new UnauthorizedException("Invalid MFA code.");

    const material = this.newSession(challenge.userId);
    await this.prisma.$transaction([
      this.prisma.authChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } }),
      this.prisma.authSession.create({ data: material.data }),
    ]);
    await this.audit.write({ actorId: challenge.userId, action: "MFA_CHALLENGE_VERIFIED", objectType: "AUTH_CHALLENGE", objectId: challenge.id, result: "SUCCESS" });
    await this.audit.write({ actorId: challenge.userId, action: "LOGIN_SUCCEEDED", objectType: "SESSION", objectId: material.tokens.sessionId, result: "SUCCESS", metadata: { mfa: true } });
    return material.tokens;
  }

  async refresh(refreshToken: string): Promise<SessionTokens> {
    const current = await this.prisma.authSession.findUnique({ where: { refreshTokenHash: tokenHash(refreshToken) }, include: { user: true } });
    if (!current || current.revokedAt || current.refreshExpiresAt.getTime() <= Date.now() || current.user.status !== "ACTIVE") {
      throw new UnauthorizedException("Refresh token is invalid or expired.");
    }
    const material = this.newSession(current.userId);
    await this.prisma.$transaction([
      this.prisma.authSession.update({ where: { id: current.id }, data: { revokedAt: new Date(), replacedBySessionId: material.tokens.sessionId } }),
      this.prisma.authSession.create({ data: material.data }),
    ]);
    await this.audit.write({ actorId: current.userId, action: "SESSION_ROTATED", objectType: "SESSION", objectId: current.id, result: "SUCCESS", metadata: { replacementSessionId: material.tokens.sessionId } });
    return material.tokens;
  }

  async validateAccessToken(accessToken: string): Promise<AuthPrincipal> {
    const session = await this.prisma.authSession.findUnique({ where: { accessTokenHash: tokenHash(accessToken) }, include: { user: true } });
    if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now() || session.user.status !== "ACTIVE") {
      throw new UnauthorizedException("Access token is invalid or expired.");
    }
    return { accountId: session.userId, role: session.user.role as IdentityRole, sessionId: session.id };
  }

  async revokeSession(principal: AuthPrincipal, sessionId: string): Promise<void> {
    const session = await this.prisma.authSession.findUnique({ where: { id: sessionId } });
    if (!session) return;
    if (!canActOnAccount(principal, session.userId)) {
      await this.denied(principal, "SESSION_REVOKE_DENIED", "SESSION", sessionId);
      throw new ForbiddenException("Session access denied.");
    }
    await this.prisma.authSession.update({ where: { id: sessionId }, data: { revokedAt: session.revokedAt ?? new Date() } });
    await this.audit.write({ actorId: principal.accountId, action: "SESSION_REVOKED", objectType: "SESSION", objectId: sessionId, result: "SUCCESS" });
  }

  async revokeAll(principal: AuthPrincipal, targetAccountId = principal.accountId): Promise<void> {
    if (!canActOnAccount(principal, targetAccountId)) {
      await this.denied(principal, "SESSION_REVOKE_ALL_DENIED", "ACCOUNT", targetAccountId);
      throw new ForbiddenException("Account access denied.");
    }
    await this.prisma.authSession.updateMany({ where: { userId: targetAccountId, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.audit.write({ actorId: principal.accountId, action: "ALL_SESSIONS_REVOKED", objectType: "ACCOUNT", objectId: targetAccountId, result: "SUCCESS" });
  }

  async suspendAccount(actorId: string, accountId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: accountId } });
    if (!user) throw new NotFoundException("Account not found.");
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: accountId }, data: { status: "SUSPENDED" } }),
      this.prisma.authSession.updateMany({ where: { userId: accountId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await this.audit.write({ actorId, action: "ACCOUNT_SUSPENDED", objectType: "ACCOUNT", objectId: accountId, result: "SUCCESS" });
    return { ...this.safeAccount(user), status: "SUSPENDED" };
  }

  private async issueSession(accountId: string): Promise<SessionTokens> {
    const material = this.newSession(accountId);
    await this.prisma.authSession.create({ data: material.data });
    await this.audit.write({ actorId: accountId, action: "LOGIN_SUCCEEDED", objectType: "SESSION", objectId: material.tokens.sessionId, result: "SUCCESS", metadata: { mfa: false } });
    return material.tokens;
  }

  private newSession(accountId: string) {
    const now = Date.now();
    const id = randomId("ses");
    const accessToken = randomToken();
    const refreshToken = randomToken(48);
    const expiresAt = new Date(now + ACCESS_TTL_MS);
    const refreshExpiresAt = new Date(now + REFRESH_TTL_MS);
    return {
      data: {
        id,
        userId: accountId,
        accessTokenHash: tokenHash(accessToken),
        refreshTokenHash: tokenHash(refreshToken),
        expiresAt,
        refreshExpiresAt,
      },
      tokens: {
        sessionId: id,
        accessToken,
        refreshToken,
        expiresAt: expiresAt.toISOString(),
        refreshExpiresAt: refreshExpiresAt.toISOString(),
      } satisfies SessionTokens,
    };
  }

  private normalizeEmail(value: string): string {
    const email = value?.trim().toLowerCase();
    if (!email || !email.includes("@")) throw new BadRequestException("A valid email address is required.");
    return email;
  }

  private async ensureEmailAvailable(email: string): Promise<void> {
    if (await this.prisma.user.findUnique({ where: { email }, select: { id: true } })) throw new ConflictException("Account already exists.");
  }

  private safeAccount(user: { id: string; email: string; role: string; status: string; failedLoginCount: number; lockedUntil: Date | null; createdAt: Date; updatedAt: Date }) {
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
      failedLoginCount: user.failedLoginCount,
      lockedUntil: user.lockedUntil?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  }

  private toEnvelope(row: { version: number; algorithm: string; keyId: string; wrappedKey: string; iv: string; secretCiphertext: string }): EncryptedEnvelope {
    if (row.version !== 1 || row.algorithm !== "AES-256-GCM") throw new BadRequestException("Unsupported MFA encryption envelope.");
    return { version: 1, algorithm: "AES-256-GCM", keyId: row.keyId, wrappedKey: row.wrappedKey, iv: row.iv, ciphertext: row.secretCiphertext };
  }

  private async denied(principal: AuthPrincipal, action: string, objectType: string, objectId: string): Promise<void> {
    await this.audit.write({ actorId: principal.accountId, action, objectType, objectId, result: "DENIED", metadata: { role: principal.role } });
  }
}
