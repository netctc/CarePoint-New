import { BadRequestException, Injectable } from "@nestjs/common";
import { createPublicKey, createVerify, type JsonWebKey } from "node:crypto";
import { randomId, randomToken, tokenHash } from "@carepoint/identity";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { RedisSecurityService } from "../../infrastructure/redis/redis-security.module";
import {
  SmartConfigurationService,
  type SmartBackendClientConfiguration,
  type SmartBackendJwk,
} from "../../security/smart-configuration.service";
import { SmartTokenService, type StoredSmartSystemAccessToken } from "../../security/smart-token.service";

const CLIENT_ASSERTION_TYPE = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";
const SYSTEM_ACCESS_TOKEN_TTL_SECONDS = 5 * 60;
const CLIENT_ASSERTION_MAX_LIFETIME_SECONDS = 5 * 60;
const CLIENT_ASSERTION_CLOCK_SKEW_SECONDS = 60;

type Input = Record<string, unknown>;
type JsonObject = Record<string, unknown>;

interface VerifiedBackendClient {
  client: SmartBackendClientConfiguration;
  kid: string;
  jtiHash: string;
}

@Injectable()
export class SmartBackendService {
  constructor(
    private readonly config: SmartConfigurationService,
    private readonly redis: RedisSecurityService,
    private readonly audit: DatabaseAuditService,
    private readonly smartTokens: SmartTokenService,
  ) {}

  async exchange(input: Input): Promise<Record<string, unknown>> {
    const grantType = this.required(input.grant_type, "grant_type", 50);
    if (grantType !== "client_credentials") {
      return this.oauthError("unsupported_grant_type", "SMART backend authorization requires grant_type=client_credentials.");
    }

    const authenticated = await this.authenticateClient(input, this.config.tokenEndpointUrl());
    const scopes = this.scopes(this.required(input.scope, "scope", 4000));
    for (const scope of scopes) {
      if (!authenticated.client.allowedScopes.includes(scope)) {
        this.oauthError("invalid_scope", `SMART backend scope '${scope}' is not registered for this client.`);
      }
      if (!scope.startsWith("system/")) this.oauthError("invalid_scope", "SMART backend grants support system scopes only.");
    }

    const token = randomToken(48);
    const tokenId = randomId("smartsys");
    const expiresAt = new Date(Date.now() + SYSTEM_ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString();
    const stored: StoredSmartSystemAccessToken = {
      tokenKind: "system",
      tokenId,
      clientId: authenticated.client.clientId,
      scopes,
      expiresAt,
    };
    await this.redis.setEphemeral(this.smartTokens.tokenKey(token), JSON.stringify(stored), SYSTEM_ACCESS_TOKEN_TTL_SECONDS);
    await this.audit.write({
      actorId: null,
      action: "SMART_BACKEND_ACCESS_TOKEN_ISSUED",
      objectType: "SMART_CLIENT",
      objectId: authenticated.client.clientId,
      purpose: "SYSTEM_ACCESS",
      result: "SUCCESS",
      metadata: {
        tokenId,
        scopes,
        expiresAt,
        grantType: "client_credentials",
        authenticationMethod: "private_key_jwt",
        assertionKid: authenticated.kid,
        assertionJtiHash: authenticated.jtiHash,
      },
    });

    return {
      access_token: token,
      token_type: "Bearer",
      expires_in: SYSTEM_ACCESS_TOKEN_TTL_SECONDS,
      scope: scopes.join(" "),
    };
  }

  async revoke(input: Input): Promise<void> {
    const authenticated = await this.authenticateClient(input, this.config.revocationEndpointUrl());
    const token = this.required(input.token, "token", 1000);
    const key = this.smartTokens.tokenKey(token);
    const raw = await this.redis.getEphemeral(key);
    if (!raw) return;
    const stored = this.parseSystemAccessToken(raw);
    if (stored.clientId !== authenticated.client.clientId) return;
    await this.redis.deleteEphemeral(key);
    await this.audit.write({
      actorId: null,
      action: "SMART_BACKEND_ACCESS_TOKEN_REVOKED",
      objectType: "SMART_ACCESS_TOKEN",
      objectId: stored.tokenId,
      purpose: "SYSTEM_ACCESS",
      result: "SUCCESS",
      metadata: {
        clientId: stored.clientId,
        scopes: stored.scopes,
        authenticationMethod: "private_key_jwt",
        assertionKid: authenticated.kid,
        assertionJtiHash: authenticated.jtiHash,
      },
    });
  }

  private async authenticateClient(input: Input, audience: string): Promise<VerifiedBackendClient> {
    const clientId = this.required(input.client_id, "client_id", 128);
    const client = this.config.backendClient(clientId);
    if (!client || client.clientId !== clientId) this.oauthError("invalid_client", "Unknown SMART backend client_id.");
    const assertionType = this.required(input.client_assertion_type, "client_assertion_type", 200);
    if (assertionType !== CLIENT_ASSERTION_TYPE) {
      this.oauthError("invalid_client", "SMART backend clients must use private_key_jwt client assertions.");
    }
    const assertion = this.required(input.client_assertion, "client_assertion", 12000);
    const parts = assertion.split(".");
    if (parts.length !== 3 || parts.some((part) => !part || !/^[A-Za-z0-9_-]+$/.test(part))) {
      this.oauthError("invalid_client", "SMART backend client assertion is not a valid compact JWT.");
    }

    const header = this.jwtObject(parts[0] as string, "client assertion header");
    if (header.alg !== "RS384") this.oauthError("invalid_client", "SMART backend client assertions must use RS384.");
    if (header.typ !== undefined && header.typ !== "JWT") this.oauthError("invalid_client", "SMART backend client assertion typ must be JWT when supplied.");
    if (header.jku !== undefined || header.jwk !== undefined || header.x5u !== undefined) {
      this.oauthError("invalid_client", "SMART backend client assertion must use only pre-registered key material.");
    }
    const kid = this.claimString(header.kid, "kid", 128);
    const jwk = client.jwks.keys.find((key) => key.kid === kid);
    if (!jwk) this.oauthError("invalid_client", "SMART backend client assertion key is not registered.");

    // The unverified header only selects an already registered key. Authenticate
    // the signed bytes before interpreting claims or accepting an identity.
    if (!this.verifyAssertion(parts[0] as string, parts[1] as string, parts[2] as string, jwk as SmartBackendJwk)) {
      this.oauthError("invalid_client", "SMART backend client assertion signature is invalid.");
    }

    const claims = this.jwtObject(parts[1] as string, "client assertion claims");
    if (claims.iss !== client.clientId || claims.sub !== client.clientId) {
      this.oauthError("invalid_client", "SMART backend assertion iss and sub must match the registered client identity.");
    }
    if (!this.audienceMatches(claims.aud, audience)) {
      this.oauthError("invalid_client", "SMART backend assertion audience is invalid.");
    }
    const now = Math.floor(Date.now() / 1000);
    const issuedAt = this.numericDate(claims.iat, "iat");
    const expiresAt = this.numericDate(claims.exp, "exp");
    if (issuedAt > now + CLIENT_ASSERTION_CLOCK_SKEW_SECONDS || issuedAt < now - CLIENT_ASSERTION_MAX_LIFETIME_SECONDS) {
      this.oauthError("invalid_client", "SMART backend client assertion iat is outside the accepted window.");
    }
    if (expiresAt <= now || expiresAt > issuedAt + CLIENT_ASSERTION_MAX_LIFETIME_SECONDS) {
      this.oauthError("invalid_client", "SMART backend client assertion exp is invalid.");
    }
    const jti = this.claimString(claims.jti, "jti", 256);
    if (jti.length < 16) this.oauthError("invalid_client", "SMART backend client assertion jti is too short.");

    const replayTtl = Math.max(1, Math.min(CLIENT_ASSERTION_MAX_LIFETIME_SECONDS, expiresAt - now));
    const jtiHash = tokenHash(jti);
    const claimed = await this.redis.setEphemeralIfAbsent(
      `carepoint:smart:client-assertion:${tokenHash(client.clientId)}:${jtiHash}`,
      JSON.stringify({ clientId: client.clientId, audience, expiresAt }),
      replayTtl,
    );
    if (!claimed) this.oauthError("invalid_client", "SMART backend client assertion was already used.");

    await this.audit.write({
      actorId: null,
      action: "SMART_BACKEND_CLIENT_AUTHENTICATED",
      objectType: "SMART_CLIENT",
      objectId: client.clientId,
      purpose: "SYSTEM_ACCESS",
      result: "SUCCESS",
      metadata: { authenticationMethod: "private_key_jwt", kid, jtiHash, audience },
    });
    return { client, kid, jtiHash };
  }

  private verifyAssertion(header: string, claims: string, signature: string, jwk: SmartBackendJwk): boolean {
    try {
      const publicKey = createPublicKey({ key: jwk as unknown as JsonWebKey, format: "jwk" });
      const verifier = createVerify("RSA-SHA384");
      verifier.update(`${header}.${claims}`, "ascii");
      verifier.end();
      return verifier.verify(publicKey, Buffer.from(signature, "base64url"));
    } catch {
      return false;
    }
  }

  private parseSystemAccessToken(value: string): StoredSmartSystemAccessToken {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new BadRequestException("SMART token state is invalid.");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new BadRequestException("SMART token state is invalid.");
    const item = parsed as JsonObject;
    if (
      item.tokenKind !== "system" ||
      typeof item.tokenId !== "string" ||
      typeof item.clientId !== "string" ||
      typeof item.expiresAt !== "string" ||
      !Array.isArray(item.scopes) ||
      !item.scopes.every((scope) => typeof scope === "string")
    ) throw new BadRequestException("SMART token state is invalid.");
    return {
      tokenKind: "system",
      tokenId: item.tokenId,
      clientId: item.clientId,
      scopes: item.scopes as string[],
      expiresAt: item.expiresAt,
    };
  }

  private jwtObject(segment: string, label: string): JsonObject {
    try {
      const decoded = Buffer.from(segment, "base64url").toString("utf8");
      const parsed: unknown = JSON.parse(decoded);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as JsonObject;
    } catch {
      // handled below
    }
    return this.oauthError("invalid_client", `SMART backend ${label} is invalid.`);
  }

  private audienceMatches(value: unknown, expected: string): boolean {
    if (value === expected) return true;
    return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string") && value.includes(expected);
  }

  private numericDate(value: unknown, name: string): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
      this.oauthError("invalid_client", `SMART backend client assertion ${name} is invalid.`);
    }
    return value as number;
  }

  private claimString(value: unknown, name: string, maxLength: number): string {
    if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
      this.oauthError("invalid_client", `SMART backend client assertion ${name} is invalid.`);
    }
    return value.trim();
  }

  private scopes(value: string): string[] {
    const scopes = value.split(/\s+/).map((scope) => scope.trim()).filter(Boolean);
    if (scopes.length < 1 || scopes.length > 20) this.oauthError("invalid_scope", "SMART backend scope is invalid.");
    if (new Set(scopes).size !== scopes.length) this.oauthError("invalid_scope", "SMART backend scopes must not be repeated.");
    return scopes;
  }

  private required(value: unknown, name: string, maxLength: number): string {
    if (Array.isArray(value)) this.oauthError("invalid_request", `SMART ${name} must not be repeated.`);
    if (typeof value !== "string" || !value.trim()) this.oauthError("invalid_request", `SMART ${name} is required.`);
    const result = value.trim();
    if (result.length > maxLength) this.oauthError("invalid_request", `SMART ${name} exceeds ${maxLength} characters.`);
    return result;
  }

  private oauthError(error: string, description: string): never {
    throw new BadRequestException({ error, error_description: description });
  }
}
