import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { randomToken, tokenHash, type AuthPrincipal } from "@carepoint/identity";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { RedisSecurityService } from "../../infrastructure/redis/redis-security.module";
import { PersistentAuthService, type SessionTokens } from "../../security/persistent-auth.service";
import { SmartOAuthService, type NormalizedSmartAuthorizationRequest } from "./smart-oauth.service";

const BROWSER_TRANSACTION_TTL_SECONDS = 10 * 60;

type SmartInput = Record<string, unknown>;

interface StoredBrowserTransaction {
  request: NormalizedSmartAuthorizationRequest;
  expiresAt: string;
  userId: string | null;
  patientId: string | null;
  authTime: number | null;
  mfaChallengeId: string | null;
}

export interface SmartBrowserView {
  transactionId: string;
  clientName: string;
  scopes: string[];
  patientId?: string;
}

export type SmartBrowserLoginResult =
  | { stage: "mfa"; view: SmartBrowserView }
  | { stage: "consent"; view: SmartBrowserView };

@Injectable()
export class SmartBrowserService {
  constructor(
    private readonly authorizationService: SmartOAuthService,
    private readonly auth: PersistentAuthService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisSecurityService,
    private readonly audit: DatabaseAuditService,
  ) {}

  async begin(input: SmartInput): Promise<SmartBrowserView> {
    const request = this.authorizationService.normalizeAuthorizationRequest(input, "browser");
    const transactionId = randomToken(32);
    const expiresAt = new Date(Date.now() + BROWSER_TRANSACTION_TTL_SECONDS * 1000).toISOString();
    const transaction: StoredBrowserTransaction = {
      request,
      expiresAt,
      userId: null,
      patientId: null,
      authTime: null,
      mfaChallengeId: null,
    };
    await this.redis.setEphemeral(this.key(transactionId), JSON.stringify(transaction), BROWSER_TRANSACTION_TTL_SECONDS);
    await this.audit.write({
      action: "SMART_BROWSER_AUTHORIZATION_STARTED",
      objectType: "SMART_CLIENT",
      objectId: request.clientId,
      purpose: "PATIENT_ACCESS",
      result: "SUCCESS",
      metadata: { scopes: request.scopes, oidc: Boolean(request.nonce), expiresAt },
    });
    return this.view(transactionId, transaction);
  }

  async login(transactionIdInput: unknown, emailInput: unknown, passwordInput: unknown): Promise<SmartBrowserLoginResult> {
    const transactionId = this.handle(transactionIdInput);
    const transaction = await this.load(transactionId);
    if (transaction.userId && transaction.patientId) return { stage: "consent", view: this.view(transactionId, transaction) };
    const email = this.text(emailInput, "email", 320);
    const password = this.text(passwordInput, "password", 500);
    const result = await this.auth.login(email, password);
    if ("requiresMfa" in result) {
      transaction.mfaChallengeId = result.challengeId;
      await this.persist(transactionId, transaction);
      await this.audit.write({
        action: "SMART_BROWSER_MFA_REQUIRED",
        objectType: "SMART_CLIENT",
        objectId: transaction.request.clientId,
        purpose: "PATIENT_ACCESS",
        result: "SUCCESS",
        metadata: { transaction: this.transactionAuditId(transactionId) },
      });
      return { stage: "mfa", view: this.view(transactionId, transaction) };
    }
    await this.bindIdentity(transactionId, transaction, result, false);
    return { stage: "consent", view: this.view(transactionId, transaction) };
  }

  async completeMfa(transactionIdInput: unknown, codeInput: unknown): Promise<SmartBrowserView> {
    const transactionId = this.handle(transactionIdInput);
    const transaction = await this.load(transactionId);
    if (!transaction.mfaChallengeId) throw new BadRequestException("SMART browser transaction is not awaiting MFA.");
    const code = this.text(codeInput, "code", 20);
    const session = await this.auth.completeMfa(transaction.mfaChallengeId, code);
    await this.bindIdentity(transactionId, transaction, session, true);
    return this.view(transactionId, transaction);
  }

  async consentView(transactionIdInput: unknown): Promise<SmartBrowserView> {
    const transactionId = this.handle(transactionIdInput);
    const transaction = await this.load(transactionId);
    this.assertAuthenticated(transaction);
    return this.view(transactionId, transaction);
  }

  async decide(transactionIdInput: unknown, decisionInput: unknown): Promise<{ redirectTo: string }> {
    const transactionId = this.handle(transactionIdInput);
    const decision = this.text(decisionInput, "decision", 20).toLowerCase();
    if (decision !== "approve" && decision !== "deny") throw new BadRequestException("SMART consent decision is invalid.");
    const raw = await this.redis.consumeEphemeral(this.key(transactionId));
    if (!raw) throw new BadRequestException("SMART browser authorization transaction is invalid or expired.");
    const transaction = this.parse(raw);
    this.assertFresh(transaction);
    this.assertAuthenticated(transaction);

    if (decision === "deny") {
      await this.audit.write({
        actorId: transaction.userId!,
        action: "SMART_BROWSER_CONSENT_DENIED",
        objectType: "SMART_CLIENT",
        objectId: transaction.request.clientId,
        purpose: "PATIENT_ACCESS",
        result: "DENIED",
        metadata: { patientId: transaction.patientId, scopes: transaction.request.scopes },
      });
      return {
        redirectTo: this.authorizationService.authorizationErrorRedirect(transaction.request, "access_denied", "The patient denied the requested SMART access."),
      };
    }

    await this.audit.write({
      actorId: transaction.userId!,
      action: "SMART_BROWSER_CONSENT_APPROVED",
      objectType: "SMART_CLIENT",
      objectId: transaction.request.clientId,
      purpose: "PATIENT_ACCESS",
      result: "SUCCESS",
      metadata: { patientId: transaction.patientId, scopes: transaction.request.scopes },
    });
    return this.authorizationService.issueAuthorizationCode(
      { userId: transaction.userId!, patientId: transaction.patientId!, authTime: transaction.authTime! },
      transaction.request,
    );
  }

  private async bindIdentity(
    transactionId: string,
    transaction: StoredBrowserTransaction,
    session: SessionTokens,
    mfa: boolean,
  ): Promise<void> {
    let principal: AuthPrincipal | null = null;
    try {
      principal = await this.auth.validateAccessToken(session.accessToken);
      if (principal.role !== "PATIENT") throw new ForbiddenException("SMART standalone browser launch is currently limited to patient accounts.");
      const patient = await this.prisma.patientProfile.findUnique({ where: { userId: principal.accountId }, select: { id: true } });
      if (!patient) throw new ForbiddenException("Patient launch context is unavailable.");
      transaction.userId = principal.accountId;
      transaction.patientId = patient.id;
      transaction.authTime = Math.floor(Date.now() / 1000);
      transaction.mfaChallengeId = null;
      await this.persist(transactionId, transaction);
      await this.audit.write({
        actorId: principal.accountId,
        action: "SMART_BROWSER_IDENTITY_VERIFIED",
        objectType: "SMART_CLIENT",
        objectId: transaction.request.clientId,
        purpose: "PATIENT_ACCESS",
        result: "SUCCESS",
        metadata: { patientId: patient.id, mfa },
      });
    } finally {
      if (principal) await this.auth.revokeSession(principal, session.sessionId).catch(() => undefined);
    }
  }

  private async load(transactionId: string): Promise<StoredBrowserTransaction> {
    const raw = await this.redis.getEphemeral(this.key(transactionId));
    if (!raw) throw new BadRequestException("SMART browser authorization transaction is invalid or expired.");
    const transaction = this.parse(raw);
    this.assertFresh(transaction);
    return transaction;
  }

  private async persist(transactionId: string, transaction: StoredBrowserTransaction): Promise<void> {
    const remaining = Math.ceil((new Date(transaction.expiresAt).getTime() - Date.now()) / 1000);
    if (remaining < 1) throw new BadRequestException("SMART browser authorization transaction expired.");
    await this.redis.setEphemeral(this.key(transactionId), JSON.stringify(transaction), remaining);
  }

  private parse(value: string): StoredBrowserTransaction {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new BadRequestException("SMART browser authorization transaction is invalid.");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new BadRequestException("SMART browser authorization transaction is invalid.");
    const item = parsed as Record<string, unknown>;
    if (
      !item.request || typeof item.request !== "object" || Array.isArray(item.request) ||
      typeof item.expiresAt !== "string" ||
      (item.userId !== null && typeof item.userId !== "string") ||
      (item.patientId !== null && typeof item.patientId !== "string") ||
      (item.authTime !== null && typeof item.authTime !== "number") ||
      (item.mfaChallengeId !== null && typeof item.mfaChallengeId !== "string")
    ) throw new BadRequestException("SMART browser authorization transaction is invalid.");
    const request = item.request as Record<string, unknown>;
    if (
      typeof request.clientId !== "string" || typeof request.clientName !== "string" ||
      typeof request.redirectUri !== "string" || typeof request.state !== "string" ||
      typeof request.codeChallenge !== "string" ||
      (request.nonce !== null && typeof request.nonce !== "string") ||
      !Array.isArray(request.scopes) || !request.scopes.every((scope) => typeof scope === "string")
    ) throw new BadRequestException("SMART browser authorization transaction is invalid.");
    return item as unknown as StoredBrowserTransaction;
  }

  private assertFresh(transaction: StoredBrowserTransaction): void {
    if (new Date(transaction.expiresAt).getTime() <= Date.now()) throw new BadRequestException("SMART browser authorization transaction expired.");
  }

  private assertAuthenticated(transaction: StoredBrowserTransaction): void {
    if (!transaction.userId || !transaction.patientId || !transaction.authTime) throw new BadRequestException("SMART browser authorization requires an authenticated patient.");
  }

  private view(transactionId: string, transaction: StoredBrowserTransaction): SmartBrowserView {
    return {
      transactionId,
      clientName: transaction.request.clientName,
      scopes: [...transaction.request.scopes],
      ...(transaction.patientId ? { patientId: transaction.patientId } : {}),
    };
  }

  private key(transactionId: string): string {
    return `carepoint:smart:browser:${tokenHash(transactionId)}`;
  }

  private transactionAuditId(transactionId: string): string {
    return tokenHash(transactionId).slice(0, 16);
  }

  private handle(value: unknown): string {
    const handle = this.text(value, "transaction", 200);
    if (!/^[A-Za-z0-9_-]{32,200}$/.test(handle)) throw new BadRequestException("SMART browser transaction handle is invalid.");
    return handle;
  }

  private text(value: unknown, name: string, maxLength: number): string {
    if (Array.isArray(value) || typeof value !== "string" || !value.trim()) throw new BadRequestException(`SMART ${name} is required.`);
    const result = value.trim();
    if (result.length > maxLength) throw new BadRequestException(`SMART ${name} exceeds ${maxLength} characters.`);
    return result;
  }
}
