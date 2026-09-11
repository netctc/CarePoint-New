import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { randomId, randomToken, tokenHash, type AuthPrincipal } from "@carepoint/identity";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { RedisSecurityService } from "../../infrastructure/redis/redis-security.module";
import { SmartConfigurationService } from "../../security/smart-configuration.service";
import {
  SmartTokenService,
  type StoredSmartAccessToken,
  type StoredSmartRefreshFamily,
} from "../../security/smart-token.service";
import { SmartOidcService } from "./smart-oidc.service";
import { normalizeSmartPublicGrantFields, parseSmartPublicGrant } from "./smart-public-grant-policy";

const AUTHORIZATION_CODE_TTL_SECONDS = 180;
const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const REFRESH_FAMILY_TTL_SECONDS = 30 * 24 * 60 * 60;

type Input = Record<string, unknown>;
export type SmartAuthorizationMode = "host" | "browser";

export interface NormalizedSmartAuthorizationRequest {
  clientId: string;
  clientName: string;
  redirectUri: string;
  state: string;
  scopes: string[];
  codeChallenge: string;
  nonce: string | null;
}

interface StoredAuthorizationCode {
  clientId: string;
  userId: string;
  patientId: string;
  redirectUri: string;
  scopes: string[];
  codeChallenge: string;
  nonce: string | null;
  authTime: number;
  expiresAt: string;
}

interface StoredSmartRefreshToken {
  refreshId: string;
  familyId: string;
  clientId: string;
  userId: string;
  patientId: string;
  scopes: string[];
  expiresAt: string;
}

@Injectable()
export class SmartOAuthService {
  constructor(
    private readonly config: SmartConfigurationService,
    private readonly redis: RedisSecurityService,
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly smartTokens: SmartTokenService,
    private readonly oidc: SmartOidcService,
  ) {}

  async authorize(principal: AuthPrincipal, input: Input): Promise<{ redirectTo: string }> {
    if (principal.role !== "PATIENT") throw new ForbiddenException("SMART authorization currently supports patient launch context only.");
    const patient = await this.prisma.patientProfile.findUnique({ where: { userId: principal.accountId }, select: { id: true } });
    if (!patient) throw new ForbiddenException("Patient launch context is unavailable.");
    const request = this.normalizeAuthorizationRequest(input, "host");
    return this.issueAuthorizationCode(
      { userId: principal.accountId, patientId: patient.id, authTime: Math.floor(Date.now() / 1000) },
      request,
    );
  }

  normalizeAuthorizationRequest(input: Input, mode: SmartAuthorizationMode): NormalizedSmartAuthorizationRequest {
    const responseType = this.required(input.response_type, "response_type", 20);
    if (responseType !== "code") throw new BadRequestException("SMART authorization supports response_type=code only.");
    const clientId = this.required(input.client_id, "client_id", 128);
    const client = this.config.client(clientId);
    if (!client) throw new BadRequestException("Unknown SMART client_id.");
    const redirectUri = this.canonicalUrl(this.required(input.redirect_uri, "redirect_uri", 1000), "redirect_uri");
    if (!client.redirectUris.includes(redirectUri)) throw new BadRequestException("SMART redirect_uri is not registered for this client.");

    const aud = this.canonicalBaseUrl(this.required(input.aud, "aud", 1000), "aud");
    if (aud !== this.config.fhirBaseUrl()) throw new BadRequestException("SMART aud must match the CarePoint FHIR R4 base URL.");
    const state = this.required(input.state, "state", 1024);
    const scopes = this.scopes(this.required(input.scope, "scope", 4000));
    this.assertPatientScopes(scopes);
    for (const scope of scopes) {
      if (!client.allowedScopes.includes(scope)) throw new BadRequestException(`SMART scope '${scope}' is not registered for this client.`);
    }

    const hasOpenId = scopes.includes("openid");
    const hasFhirUser = scopes.includes("fhirUser");
    if (hasOpenId !== hasFhirUser) throw new BadRequestException("SMART OIDC launch requires openid and fhirUser together.");
    if ((hasOpenId || hasFhirUser) && mode !== "browser") {
      throw new BadRequestException("SMART openid/fhirUser scopes require the browser authorization endpoint.");
    }
    if (scopes.includes("offline_access") && mode !== "browser") {
      throw new BadRequestException("SMART offline_access requires the browser authorization and explicit patient consent flow.");
    }
    const nonce = hasOpenId ? this.required(input.nonce, "nonce", 256) : null;
    if (nonce && nonce.length < 8) throw new BadRequestException("SMART nonce must contain at least 8 characters.");

    const method = this.required(input.code_challenge_method, "code_challenge_method", 20);
    if (method !== "S256") throw new BadRequestException("SMART public clients must use PKCE code_challenge_method=S256.");
    const codeChallenge = this.required(input.code_challenge, "code_challenge", 128);
    if (!/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) throw new BadRequestException("SMART PKCE code_challenge is invalid.");

    return { clientId, clientName: client.name, redirectUri, state, scopes, codeChallenge, nonce };
  }

  async issueAuthorizationCode(
    identity: { userId: string; patientId: string; authTime: number },
    request: NormalizedSmartAuthorizationRequest,
  ): Promise<{ redirectTo: string }> {
    const code = randomToken(32);
    const expiresAt = new Date(Date.now() + AUTHORIZATION_CODE_TTL_SECONDS * 1000).toISOString();
    const stored: StoredAuthorizationCode = {
      clientId: request.clientId,
      userId: identity.userId,
      patientId: identity.patientId,
      redirectUri: request.redirectUri,
      scopes: request.scopes,
      codeChallenge: request.codeChallenge,
      nonce: request.nonce,
      authTime: identity.authTime,
      expiresAt,
    };
    await this.redis.setEphemeral(this.codeKey(code), JSON.stringify(stored), AUTHORIZATION_CODE_TTL_SECONDS);
    await this.audit.write({
      actorId: identity.userId,
      action: "SMART_AUTHORIZATION_CODE_ISSUED",
      objectType: "SMART_CLIENT",
      objectId: request.clientId,
      purpose: "PATIENT_ACCESS",
      result: "SUCCESS",
      metadata: {
        patientId: identity.patientId,
        scopes: request.scopes,
        expiresAt,
        pkce: "S256",
        oidc: Boolean(request.nonce),
        offlineAccess: request.scopes.includes("offline_access"),
      },
    });

    const callback = new URL(request.redirectUri);
    callback.searchParams.set("code", code);
    callback.searchParams.set("state", request.state);
    return { redirectTo: callback.toString() };
  }

  authorizationErrorRedirect(request: NormalizedSmartAuthorizationRequest, error: string, description?: string): string {
    const callback = new URL(request.redirectUri);
    callback.searchParams.set("error", error);
    if (description) callback.searchParams.set("error_description", description.slice(0, 500));
    callback.searchParams.set("state", request.state);
    return callback.toString();
  }

  async exchange(input: Input): Promise<Record<string, unknown>> {
    const grantType = parseSmartPublicGrant(input);
    const request = normalizeSmartPublicGrantFields(input, grantType);
    // Both grants require a registered public client before credential handling.
    if (!this.config.client(request.client_id)) this.oauthError("invalid_client", "Unknown SMART client_id.");
    switch (grantType) {
      case "authorization_code": return this.exchangeAuthorizationCode(request);
      case "refresh_token": return this.exchangeRefreshToken(request);
    }
  }

  async revoke(input: Input): Promise<void> {
    const token = this.required(input.token, "token", 1000);
    const clientId = this.required(input.client_id, "client_id", 128);
    if (!this.config.client(clientId)) return;

    const accessKey = this.smartTokens.tokenKey(token);
    const accessRaw = await this.redis.getEphemeral(accessKey);
    if (accessRaw) {
      const access = this.parseAccessToken(accessRaw);
      if (access.clientId !== clientId) return;
      await this.redis.deleteEphemeral(accessKey);
      if (access.refreshFamilyId) await this.revokeRefreshFamily(access.refreshFamilyId, access, "SMART_TOKEN_REVOCATION");
      await this.audit.write({
        actorId: access.userId,
        action: "SMART_ACCESS_TOKEN_REVOKED",
        objectType: "SMART_ACCESS_TOKEN",
        objectId: access.tokenId,
        purpose: "PATIENT_ACCESS",
        result: "SUCCESS",
        metadata: { clientId, patientId: access.patientId, refreshFamilyId: access.refreshFamilyId ?? null },
      });
      return;
    }

    const refreshKey = this.refreshTokenKey(token);
    const refreshRaw = await this.redis.getEphemeral(refreshKey);
    if (refreshRaw) {
      const refresh = this.parseRefreshToken(refreshRaw);
      if (refresh.clientId !== clientId) return;
      await this.redis.deleteEphemeral(refreshKey);
      await this.revokeRefreshFamily(refresh.familyId, refresh, "SMART_REFRESH_TOKEN_REVOCATION");
      return;
    }

    const usedRaw = await this.redis.getEphemeral(this.usedRefreshTokenKey(token));
    if (!usedRaw) return;
    const used = this.parseRefreshToken(usedRaw);
    if (used.clientId !== clientId) return;
    await this.revokeRefreshFamily(used.familyId, used, "SMART_ROTATED_REFRESH_TOKEN_REVOCATION");
  }

  private async exchangeAuthorizationCode(input: Input): Promise<Record<string, unknown>> {
    const code = this.required(input.code, "code", 500);
    const clientId = this.required(input.client_id, "client_id", 128);
    const client = this.config.client(clientId);
    if (!client) this.oauthError("invalid_client", "Unknown SMART client_id.");
    const redirectUri = this.canonicalUrl(this.required(input.redirect_uri, "redirect_uri", 1000), "redirect_uri");
    const verifier = this.required(input.code_verifier, "code_verifier", 128);
    if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) this.oauthError("invalid_grant", "PKCE code_verifier is invalid.");

    const key = this.codeKey(code);
    const previewRaw = await this.redis.getEphemeral(key);
    if (!previewRaw) this.oauthError("invalid_grant", "Authorization code is invalid, expired, or already used.");
    const preview = this.parseCode(previewRaw as string);
    if (preview.clientId !== clientId || preview.redirectUri !== redirectUri || new Date(preview.expiresAt).getTime() <= Date.now()) {
      this.oauthError("invalid_grant", "Authorization code does not match the token request.");
    }
    if (this.pkceChallenge(verifier) !== preview.codeChallenge) this.oauthError("invalid_grant", "PKCE verification failed.");

    const consumedRaw = await this.redis.consumeEphemeral(key);
    if (!consumedRaw) this.oauthError("invalid_grant", "Authorization code is invalid, expired, or already used.");
    const authorization = this.parseCode(consumedRaw as string);
    if (authorization.clientId !== preview.clientId || authorization.userId !== preview.userId || authorization.patientId !== preview.patientId) {
      this.oauthError("invalid_grant", "Authorization code state changed unexpectedly.");
    }

    let family: StoredSmartRefreshFamily | null = null;
    let refreshToken: { token: string; refreshId: string } | null = null;
    if (authorization.scopes.includes("offline_access")) {
      family = this.newRefreshFamily(authorization);
      await this.redis.setEphemeral(
        this.smartTokens.refreshFamilyKey(family.familyId),
        JSON.stringify(family),
        REFRESH_FAMILY_TTL_SECONDS,
      );
      refreshToken = await this.issueRefreshToken(family, authorization.scopes);
    }

    const access = await this.issueAccessToken(
      {
        clientId,
        userId: authorization.userId,
        patientId: authorization.patientId,
        scopes: authorization.scopes,
      },
      family?.familyId,
      "authorization_code",
    );

    const response: Record<string, unknown> = {
      access_token: access.token,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      scope: authorization.scopes.join(" "),
      patient: authorization.patientId,
    };
    if (refreshToken) response.refresh_token = refreshToken.token;
    if (authorization.scopes.includes("openid") && authorization.scopes.includes("fhirUser")) {
      if (!authorization.nonce) this.oauthError("invalid_grant", "OIDC authorization code is missing nonce context.");
      response.id_token = this.oidc.signIdToken({
        userId: authorization.userId,
        patientId: authorization.patientId,
        clientId,
        nonce: authorization.nonce,
        authTime: authorization.authTime,
        expiresInSeconds: ACCESS_TOKEN_TTL_SECONDS,
      });
    }
    return response;
  }

  private async exchangeRefreshToken(input: Input): Promise<Record<string, unknown>> {
    const refreshToken = this.required(input.refresh_token, "refresh_token", 1000);
    const clientId = this.required(input.client_id, "client_id", 128);
    if (!this.config.client(clientId)) this.oauthError("invalid_client", "Unknown SMART client_id.");

    const activeKey = this.refreshTokenKey(refreshToken);
    const usedKey = this.usedRefreshTokenKey(refreshToken);
    const previewRaw = await this.redis.getEphemeral(activeKey);
    if (previewRaw) {
      const preview = this.parseRefreshToken(previewRaw);
      if (preview.clientId !== clientId) this.oauthError("invalid_grant", "Refresh token does not match this client.");
      if (new Date(preview.expiresAt).getTime() <= Date.now()) this.oauthError("invalid_grant", "Refresh token is expired.");
    }

    const rotation = await this.redis.consumeAndMarkEphemeral(activeKey, usedKey, REFRESH_FAMILY_TTL_SECONDS);
    if (rotation.status === "missing" || !rotation.value) {
      this.oauthError("invalid_grant", "Refresh token is invalid, expired, or revoked.");
    }
    const stored = this.parseRefreshToken(rotation.value);
    if (stored.clientId !== clientId) this.oauthError("invalid_grant", "Refresh token does not match this client.");

    if (rotation.status === "reused") {
      await this.handleRefreshReuse(stored);
    }

    const familyRaw = await this.redis.getEphemeral(this.smartTokens.refreshFamilyKey(stored.familyId));
    if (!familyRaw) this.oauthError("invalid_grant", "Refresh token family is revoked or expired.");
    const family = this.parseRefreshFamily(familyRaw as string);
    if (
      family.familyId !== stored.familyId ||
      family.clientId !== stored.clientId ||
      family.userId !== stored.userId ||
      family.patientId !== stored.patientId ||
      new Date(family.expiresAt).getTime() <= Date.now()
    ) {
      await this.redis.deleteEphemeral(this.smartTokens.refreshFamilyKey(stored.familyId));
      this.oauthError("invalid_grant", "Refresh token family state is invalid or expired.");
    }

    await this.assertActivePatient(stored.userId, stored.patientId);
    const scopes = this.refreshScopes(input.scope, stored.scopes);
    const continueOffline = scopes.includes("offline_access");
    let nextRefresh: { token: string; refreshId: string } | null = null;
    if (continueOffline) nextRefresh = await this.issueRefreshToken(family, scopes);

    const access = await this.issueAccessToken(
      {
        clientId,
        userId: stored.userId,
        patientId: stored.patientId,
        scopes,
      },
      continueOffline ? stored.familyId : undefined,
      "refresh_token",
    );

    if (!continueOffline) {
      await this.redis.deleteEphemeral(this.smartTokens.refreshFamilyKey(stored.familyId));
      await this.audit.write({
        actorId: stored.userId,
        action: "SMART_REFRESH_FAMILY_CLOSED",
        objectType: "SMART_REFRESH_FAMILY",
        objectId: stored.familyId,
        purpose: "PATIENT_ACCESS",
        result: "SUCCESS",
        metadata: { clientId, patientId: stored.patientId, reason: "OFFLINE_SCOPE_NOT_RETAINED" },
      });
    }

    await this.audit.write({
      actorId: stored.userId,
      action: "SMART_REFRESH_TOKEN_ROTATED",
      objectType: "SMART_REFRESH_FAMILY",
      objectId: stored.familyId,
      purpose: "PATIENT_ACCESS",
      result: "SUCCESS",
      metadata: {
        clientId,
        patientId: stored.patientId,
        consumedRefreshId: stored.refreshId,
        issuedRefreshId: nextRefresh?.refreshId ?? null,
        scopes,
        familyExpiresAt: family.expiresAt,
      },
    });

    return {
      access_token: access.token,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      scope: scopes.join(" "),
      patient: stored.patientId,
      ...(nextRefresh ? { refresh_token: nextRefresh.token } : {}),
    };
  }

  private async issueAccessToken(
    input: { clientId: string; userId: string; patientId: string; scopes: string[] },
    refreshFamilyId: string | undefined,
    grantType: "authorization_code" | "refresh_token",
  ): Promise<{ token: string; tokenId: string; expiresAt: string }> {
    const token = randomToken(48);
    const tokenId = randomId("smart");
    const expiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString();
    const stored: StoredSmartAccessToken = {
      tokenId,
      clientId: input.clientId,
      userId: input.userId,
      patientId: input.patientId,
      scopes: input.scopes,
      expiresAt,
      ...(refreshFamilyId ? { refreshFamilyId } : {}),
    };
    await this.redis.setEphemeral(this.smartTokens.tokenKey(token), JSON.stringify(stored), ACCESS_TOKEN_TTL_SECONDS);
    await this.audit.write({
      actorId: input.userId,
      action: "SMART_ACCESS_TOKEN_ISSUED",
      objectType: "SMART_ACCESS_TOKEN",
      objectId: tokenId,
      purpose: "PATIENT_ACCESS",
      result: "SUCCESS",
      metadata: {
        clientId: input.clientId,
        patientId: input.patientId,
        scopes: input.scopes,
        expiresAt,
        grantType,
        refreshFamilyId: refreshFamilyId ?? null,
      },
    });
    return { token, tokenId, expiresAt };
  }

  private async issueRefreshToken(
    family: StoredSmartRefreshFamily,
    scopes: string[],
  ): Promise<{ token: string; refreshId: string }> {
    const ttlSeconds = this.remainingSeconds(family.expiresAt);
    if (ttlSeconds < 1) this.oauthError("invalid_grant", "Refresh token family is expired.");
    const token = randomToken(48);
    const refreshId = randomId("refresh");
    const stored: StoredSmartRefreshToken = {
      refreshId,
      familyId: family.familyId,
      clientId: family.clientId,
      userId: family.userId,
      patientId: family.patientId,
      scopes,
      expiresAt: family.expiresAt,
    };
    await this.redis.setEphemeral(this.refreshTokenKey(token), JSON.stringify(stored), ttlSeconds);
    return { token, refreshId };
  }

  private newRefreshFamily(authorization: StoredAuthorizationCode): StoredSmartRefreshFamily {
    const now = new Date();
    return {
      familyId: randomId("smartrf"),
      clientId: authorization.clientId,
      userId: authorization.userId,
      patientId: authorization.patientId,
      scopes: authorization.scopes,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + REFRESH_FAMILY_TTL_SECONDS * 1000).toISOString(),
    };
  }

  private async handleRefreshReuse(stored: StoredSmartRefreshToken): Promise<never> {
    await this.redis.deleteEphemeral(this.smartTokens.refreshFamilyKey(stored.familyId));
    await this.audit.write({
      actorId: stored.userId,
      action: "SMART_REFRESH_TOKEN_REUSE_DETECTED",
      objectType: "SMART_REFRESH_FAMILY",
      objectId: stored.familyId,
      purpose: "PATIENT_ACCESS",
      result: "DENIED",
      metadata: {
        clientId: stored.clientId,
        patientId: stored.patientId,
        refreshId: stored.refreshId,
        response: "FAMILY_REVOKED",
      },
    });
    return this.oauthError("invalid_grant", "Refresh token reuse detected; the authorization family has been revoked.");
  }

  private async revokeRefreshFamily(
    familyId: string,
    token: { clientId: string; userId: string; patientId: string },
    reason: string,
  ): Promise<void> {
    const key = this.smartTokens.refreshFamilyKey(familyId);
    const familyRaw = await this.redis.getEphemeral(key);
    await this.redis.deleteEphemeral(key);
    if (!familyRaw) return;
    await this.audit.write({
      actorId: token.userId,
      action: "SMART_REFRESH_FAMILY_REVOKED",
      objectType: "SMART_REFRESH_FAMILY",
      objectId: familyId,
      purpose: "PATIENT_ACCESS",
      result: "SUCCESS",
      metadata: { clientId: token.clientId, patientId: token.patientId, reason },
    });
  }

  private async assertActivePatient(userId: string, patientId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, status: true, patientProfile: { select: { id: true } } },
    });
    if (!user || user.role !== "PATIENT" || user.status !== "ACTIVE" || user.patientProfile?.id !== patientId) {
      this.oauthError("invalid_grant", "Patient authorization is no longer active.");
    }
  }

  private refreshScopes(value: unknown, grantedScopes: string[]): string[] {
    if (value === undefined || value === null || value === "") return [...grantedScopes];
    const requested = this.scopes(this.required(value, "scope", 4000));
    for (const scope of requested) {
      if (!grantedScopes.includes(scope)) this.oauthError("invalid_scope", `Refresh scope '${scope}' was not granted by the original authorization.`);
    }
    this.assertPatientScopes(requested);
    const hasOpenId = requested.includes("openid");
    const hasFhirUser = requested.includes("fhirUser");
    if (hasOpenId !== hasFhirUser) this.oauthError("invalid_scope", "openid and fhirUser must be retained or removed together.");
    return requested;
  }

  private assertPatientScopes(scopes: string[]): void {
    if (!scopes.includes("launch/patient") || !scopes.some((scope) => scope.startsWith("patient/"))) {
      throw new BadRequestException("SMART patient launch requires launch/patient and at least one patient resource scope.");
    }
  }

  private codeKey(code: string): string {
    return `carepoint:smart:code:${tokenHash(code)}`;
  }

  private refreshTokenKey(token: string): string {
    return `carepoint:smart:refresh:${tokenHash(token)}`;
  }

  private usedRefreshTokenKey(token: string): string {
    return `carepoint:smart:refresh-used:${tokenHash(token)}`;
  }

  private pkceChallenge(verifier: string): string {
    return createHash("sha256").update(verifier, "ascii").digest("base64url");
  }

  private remainingSeconds(expiresAt: string): number {
    return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000));
  }

  private scopes(value: string): string[] {
    const scopes = value.split(/\s+/).map((scope) => scope.trim()).filter(Boolean);
    if (scopes.length < 1 || scopes.length > 30) throw new BadRequestException("SMART scope is invalid.");
    if (new Set(scopes).size !== scopes.length) throw new BadRequestException("SMART scopes must not be repeated.");
    return scopes;
  }

  private parseCode(value: string): StoredAuthorizationCode {
    const parsed = this.json(value, "Authorization code");
    if (
      typeof parsed.clientId !== "string" ||
      typeof parsed.userId !== "string" ||
      typeof parsed.patientId !== "string" ||
      typeof parsed.redirectUri !== "string" ||
      typeof parsed.codeChallenge !== "string" ||
      (parsed.nonce !== null && typeof parsed.nonce !== "string") ||
      typeof parsed.authTime !== "number" ||
      typeof parsed.expiresAt !== "string" ||
      !Array.isArray(parsed.scopes) ||
      !parsed.scopes.every((scope) => typeof scope === "string")
    ) this.oauthError("invalid_grant", "Authorization code is invalid.");
    return parsed as unknown as StoredAuthorizationCode;
  }

  private parseAccessToken(value: string): StoredSmartAccessToken {
    const parsed = this.json(value, "Access token");
    if (
      typeof parsed.tokenId !== "string" ||
      typeof parsed.clientId !== "string" ||
      typeof parsed.userId !== "string" ||
      typeof parsed.patientId !== "string" ||
      typeof parsed.expiresAt !== "string" ||
      (parsed.refreshFamilyId !== undefined && typeof parsed.refreshFamilyId !== "string") ||
      !Array.isArray(parsed.scopes) ||
      !parsed.scopes.every((scope) => typeof scope === "string")
    ) throw new BadRequestException("SMART token state is invalid.");
    return {
      tokenId: parsed.tokenId as string,
      clientId: parsed.clientId as string,
      userId: parsed.userId as string,
      patientId: parsed.patientId as string,
      scopes: parsed.scopes as string[],
      expiresAt: parsed.expiresAt as string,
      ...(typeof parsed.refreshFamilyId === "string" ? { refreshFamilyId: parsed.refreshFamilyId } : {}),
    };
  }

  private parseRefreshToken(value: string): StoredSmartRefreshToken {
    const parsed = this.json(value, "Refresh token");
    if (
      typeof parsed.refreshId !== "string" ||
      typeof parsed.familyId !== "string" ||
      typeof parsed.clientId !== "string" ||
      typeof parsed.userId !== "string" ||
      typeof parsed.patientId !== "string" ||
      typeof parsed.expiresAt !== "string" ||
      !Array.isArray(parsed.scopes) ||
      !parsed.scopes.every((scope) => typeof scope === "string")
    ) this.oauthError("invalid_grant", "Refresh token state is invalid.");
    return parsed as unknown as StoredSmartRefreshToken;
  }

  private parseRefreshFamily(value: string): StoredSmartRefreshFamily {
    const parsed = this.json(value, "Refresh token family");
    if (
      typeof parsed.familyId !== "string" ||
      typeof parsed.clientId !== "string" ||
      typeof parsed.userId !== "string" ||
      typeof parsed.patientId !== "string" ||
      typeof parsed.createdAt !== "string" ||
      typeof parsed.expiresAt !== "string" ||
      !Array.isArray(parsed.scopes) ||
      !parsed.scopes.every((scope) => typeof scope === "string")
    ) this.oauthError("invalid_grant", "Refresh token family state is invalid.");
    return parsed as unknown as StoredSmartRefreshFamily;
  }

  private json(value: string, label: string): Record<string, unknown> {
    try {
      const parsed: unknown = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      // handled below
    }
    throw new BadRequestException(`${label} state is invalid.`);
  }

  private canonicalUrl(value: string, name: string): string {
    try {
      const url = new URL(value);
      if (url.hash) throw new Error("fragment");
      return url.toString();
    } catch {
      throw new BadRequestException(`SMART ${name} must be a valid absolute URL.`);
    }
  }

  private canonicalBaseUrl(value: string, name: string): string {
    const canonical = this.canonicalUrl(value, name);
    const url = new URL(canonical);
    if (url.search) throw new BadRequestException(`SMART ${name} must not contain query parameters.`);
    return canonical.replace(/\/$/, "");
  }

  private required(value: unknown, name: string, maxLength: number): string {
    if (Array.isArray(value)) throw new BadRequestException(`SMART ${name} must not be repeated.`);
    if (typeof value !== "string" || !value.trim()) throw new BadRequestException(`SMART ${name} is required.`);
    const result = value.trim();
    if (result.length > maxLength) throw new BadRequestException(`SMART ${name} exceeds ${maxLength} characters.`);
    return result;
  }

  private oauthError(error: string, description: string): never {
    throw new BadRequestException({ error, error_description: description });
  }
}