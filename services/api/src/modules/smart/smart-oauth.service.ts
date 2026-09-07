import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { randomId, randomToken, tokenHash, type AuthPrincipal } from "@carepoint/identity";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { RedisSecurityService } from "../../infrastructure/redis/redis-security.module";
import { SmartConfigurationService } from "../../security/smart-configuration.service";
import { SmartTokenService, type StoredSmartAccessToken } from "../../security/smart-token.service";

const AUTHORIZATION_CODE_TTL_SECONDS = 180;
const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

type Input = Record<string, unknown>;

interface StoredAuthorizationCode {
  clientId: string;
  userId: string;
  patientId: string;
  redirectUri: string;
  scopes: string[];
  codeChallenge: string;
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
  ) {}

  async authorize(principal: AuthPrincipal, input: Input): Promise<{ redirectTo: string }> {
    if (principal.role !== "PATIENT") throw new ForbiddenException("Slice 10.6 SMART authorization currently supports patient-mediated launch only.");
    const patient = await this.prisma.patientProfile.findUnique({ where: { userId: principal.accountId }, select: { id: true } });
    if (!patient) throw new ForbiddenException("Patient launch context is unavailable.");

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
    if (!scopes.includes("launch/patient") || !scopes.some((scope) => scope.startsWith("patient/"))) {
      throw new BadRequestException("SMART patient launch requires launch/patient and at least one patient resource scope.");
    }
    for (const scope of scopes) {
      if (!client.allowedScopes.includes(scope)) throw new BadRequestException(`SMART scope '${scope}' is not registered for this client.`);
    }

    const method = this.required(input.code_challenge_method, "code_challenge_method", 20);
    if (method !== "S256") throw new BadRequestException("SMART public clients must use PKCE code_challenge_method=S256.");
    const codeChallenge = this.required(input.code_challenge, "code_challenge", 128);
    if (!/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) throw new BadRequestException("SMART PKCE code_challenge is invalid.");

    const code = randomToken(32);
    const expiresAt = new Date(Date.now() + AUTHORIZATION_CODE_TTL_SECONDS * 1000).toISOString();
    const stored: StoredAuthorizationCode = {
      clientId,
      userId: principal.accountId,
      patientId: patient.id,
      redirectUri,
      scopes,
      codeChallenge,
      expiresAt,
    };
    await this.redis.setEphemeral(this.codeKey(code), JSON.stringify(stored), AUTHORIZATION_CODE_TTL_SECONDS);
    await this.audit.write({
      actorId: principal.accountId,
      action: "SMART_AUTHORIZATION_CODE_ISSUED",
      objectType: "SMART_CLIENT",
      objectId: clientId,
      purpose: "PATIENT_ACCESS",
      result: "SUCCESS",
      metadata: { patientId: patient.id, scopes, expiresAt, pkce: "S256" },
    });

    const callback = new URL(redirectUri);
    callback.searchParams.set("code", code);
    callback.searchParams.set("state", state);
    return { redirectTo: callback.toString() };
  }

  async exchange(input: Input): Promise<Record<string, unknown>> {
    const grantType = this.required(input.grant_type, "grant_type", 50);
    if (grantType !== "authorization_code") this.oauthError("unsupported_grant_type", "SMART token exchange supports authorization_code only.");
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

    const accessToken = randomToken(48);
    const tokenId = randomId("smart");
    const expiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString();
    const storedToken: StoredSmartAccessToken = {
      tokenId,
      clientId,
      userId: authorization.userId,
      patientId: authorization.patientId,
      scopes: authorization.scopes,
      expiresAt,
    };
    await this.redis.setEphemeral(this.smartTokens.tokenKey(accessToken), JSON.stringify(storedToken), ACCESS_TOKEN_TTL_SECONDS);
    await this.audit.write({
      actorId: authorization.userId,
      action: "SMART_ACCESS_TOKEN_ISSUED",
      objectType: "SMART_ACCESS_TOKEN",
      objectId: tokenId,
      purpose: "PATIENT_ACCESS",
      result: "SUCCESS",
      metadata: { clientId, patientId: authorization.patientId, scopes: authorization.scopes, expiresAt },
    });

    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      scope: authorization.scopes.join(" "),
      patient: authorization.patientId,
    };
  }

  async revoke(input: Input): Promise<void> {
    const token = this.required(input.token, "token", 1000);
    const clientId = this.required(input.client_id, "client_id", 128);
    const key = this.smartTokens.tokenKey(token);
    const raw = await this.redis.getEphemeral(key);
    if (!raw) return;
    const stored = this.parseAccessToken(raw);
    if (stored.clientId !== clientId) return;
    await this.redis.deleteEphemeral(key);
    await this.audit.write({
      actorId: stored.userId,
      action: "SMART_ACCESS_TOKEN_REVOKED",
      objectType: "SMART_ACCESS_TOKEN",
      objectId: stored.tokenId,
      purpose: "PATIENT_ACCESS",
      result: "SUCCESS",
      metadata: { clientId, patientId: stored.patientId },
    });
  }

  private codeKey(code: string): string {
    return `carepoint:smart:code:${tokenHash(code)}`;
  }

  private pkceChallenge(verifier: string): string {
    return createHash("sha256").update(verifier, "ascii").digest("base64url");
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
      !Array.isArray(parsed.scopes) ||
      !parsed.scopes.every((scope) => typeof scope === "string")
    ) throw new BadRequestException("SMART token state is invalid.");
    return parsed as unknown as StoredSmartAccessToken;
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
