import { Injectable, OnModuleInit } from "@nestjs/common";

export interface SmartClientConfiguration {
  clientId: string;
  name: string;
  redirectUris: string[];
  allowedScopes: string[];
}

export interface SmartBackendJwk {
  kty: "RSA";
  kid: string;
  alg: "RS384";
  use?: "sig";
  key_ops?: string[];
  n: string;
  e: string;
}

export interface SmartBackendClientConfiguration {
  clientId: string;
  name: string;
  allowedScopes: string[];
  jwks: { keys: SmartBackendJwk[] };
}

export const SMART_PATIENT_SCOPES = [
  "launch/patient",
  "openid",
  "fhirUser",
  "offline_access",
  "patient/Patient.r",
  "patient/Appointment.rs",
  "patient/Encounter.r",
  "patient/Observation.s",
  "patient/MedicationRequest.r",
  "patient/ServiceRequest.r",
  "patient/DiagnosticReport.rs",
  "patient/DocumentReference.rs",
  "patient/ImagingStudy.r",
] as const;

export const SMART_SYSTEM_SCOPES = [
  "system/Patient.rs",
  "system/Appointment.rs",
] as const;

export const SMART_SUPPORTED_SCOPES = [...SMART_PATIENT_SCOPES, ...SMART_SYSTEM_SCOPES] as const;

const PATIENT_SCOPE_SET = new Set<string>(SMART_PATIENT_SCOPES);
const SYSTEM_SCOPE_SET = new Set<string>(SMART_SYSTEM_SCOPES);

@Injectable()
export class SmartConfigurationService implements OnModuleInit {
  private issuer = "";
  private fhirBase = "";
  private readonly clients = new Map<string, SmartClientConfiguration>();
  private readonly backendClients = new Map<string, SmartBackendClientConfiguration>();

  onModuleInit(): void {
    const production = process.env.NODE_ENV === "production";
    const configuredIssuer = process.env.SMART_ISSUER_URL?.trim();
    const configuredFhirBase = process.env.SMART_FHIR_BASE_URL?.trim();
    if (production && (!configuredIssuer || !configuredFhirBase)) {
      throw new Error("SMART_ISSUER_URL and SMART_FHIR_BASE_URL are required in production.");
    }

    this.issuer = this.absoluteBaseUrl(configuredIssuer || "http://127.0.0.1:4000/api/v1", "SMART_ISSUER_URL", production);
    this.fhirBase = this.absoluteBaseUrl(configuredFhirBase || `${this.issuer}/fhir/R4`, "SMART_FHIR_BASE_URL", production);

    this.parsePublicClients(process.env.SMART_PUBLIC_CLIENTS_JSON?.trim(), production);
    this.parseBackendClients(process.env.SMART_BACKEND_CLIENTS_JSON?.trim());
  }

  discovery(): Record<string, unknown> {
    return {
      issuer: this.issuer,
      authorization_endpoint: `${this.issuer}/smart/browser/authorize`,
      token_endpoint: this.tokenEndpointUrl(),
      revocation_endpoint: this.revocationEndpointUrl(),
      jwks_uri: `${this.issuer}/smart/jwks`,
      capabilities: [
        "launch-standalone",
        "client-public",
        "client-confidential-asymmetric",
        "context-standalone-patient",
        "sso-openid-connect",
        "permission-patient",
        "permission-system",
        "permission-offline",
        "permission-v2",
      ],
      scopes_supported: [...SMART_SUPPORTED_SCOPES],
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token", "client_credentials"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none", "private_key_jwt"],
      token_endpoint_auth_signing_alg_values_supported: ["RS384"],
    };
  }

  openidConfiguration(): Record<string, unknown> {
    return {
      issuer: this.issuer,
      authorization_endpoint: `${this.issuer}/smart/browser/authorize`,
      token_endpoint: this.tokenEndpointUrl(),
      jwks_uri: `${this.issuer}/smart/jwks`,
      response_types_supported: ["code"],
      response_modes_supported: ["query"],
      grant_types_supported: ["authorization_code", "refresh_token", "client_credentials"],
      subject_types_supported: ["pairwise"],
      id_token_signing_alg_values_supported: ["RS256"],
      scopes_supported: [...SMART_SUPPORTED_SCOPES],
      token_endpoint_auth_methods_supported: ["none", "private_key_jwt"],
      token_endpoint_auth_signing_alg_values_supported: ["RS384"],
      code_challenge_methods_supported: ["S256"],
      claims_supported: ["iss", "sub", "aud", "exp", "iat", "auth_time", "nonce", "fhirUser"],
    };
  }

  client(clientId: string): SmartClientConfiguration | null {
    return this.clients.get(clientId) ?? null;
  }

  backendClient(clientId: string): SmartBackendClientConfiguration | null {
    return this.backendClients.get(clientId) ?? null;
  }

  fhirBaseUrl(): string {
    return this.fhirBase;
  }

  issuerUrl(): string {
    return this.issuer;
  }

  tokenEndpointUrl(): string {
    return `${this.issuer}/smart/token`;
  }

  revocationEndpointUrl(): string {
    return `${this.issuer}/smart/revoke`;
  }

  private parsePublicClients(rawClients: string | undefined, production: boolean): void {
    if (!rawClients) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawClients);
    } catch {
      throw new Error("SMART_PUBLIC_CLIENTS_JSON must be valid JSON.");
    }
    if (!Array.isArray(parsed)) throw new Error("SMART_PUBLIC_CLIENTS_JSON must be an array.");
    for (const raw of parsed) {
      const client = this.parseClient(raw, production);
      if (this.clients.has(client.clientId)) throw new Error(`Duplicate SMART clientId '${client.clientId}'.`);
      this.clients.set(client.clientId, client);
    }
  }

  private parseBackendClients(rawClients: string | undefined): void {
    if (!rawClients) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawClients);
    } catch {
      throw new Error("SMART_BACKEND_CLIENTS_JSON must be valid JSON.");
    }
    if (!Array.isArray(parsed)) throw new Error("SMART_BACKEND_CLIENTS_JSON must be an array.");
    for (const raw of parsed) {
      const client = this.parseBackendClient(raw);
      if (this.backendClients.has(client.clientId) || this.clients.has(client.clientId)) {
        throw new Error(`Duplicate SMART clientId '${client.clientId}'.`);
      }
      this.backendClients.set(client.clientId, client);
    }
  }

  private parseClient(value: unknown, production: boolean): SmartClientConfiguration {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Each SMART client configuration must be an object.");
    const input = value as Record<string, unknown>;
    const clientId = this.clientId(input.clientId);
    const name = this.text(input.name, "name", 200);
    if (!Array.isArray(input.redirectUris) || input.redirectUris.length < 1 || input.redirectUris.length > 10) {
      throw new Error(`SMART client '${clientId}' requires between 1 and 10 redirectUris.`);
    }
    const redirectUris = [...new Set(input.redirectUris.map((item) => this.redirectUri(item, production)))];
    const allowedScopes = this.allowedScopes(input.allowedScopes, clientId, PATIENT_SCOPE_SET);
    return { clientId, name, redirectUris, allowedScopes };
  }

  private parseBackendClient(value: unknown): SmartBackendClientConfiguration {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Each SMART backend client configuration must be an object.");
    const input = value as Record<string, unknown>;
    const clientId = this.clientId(input.clientId);
    const name = this.text(input.name, "name", 200);
    const allowedScopes = this.allowedScopes(input.allowedScopes, clientId, SYSTEM_SCOPE_SET);
    if (!input.jwks || typeof input.jwks !== "object" || Array.isArray(input.jwks)) {
      throw new Error(`SMART backend client '${clientId}' requires a JWKS object.`);
    }
    const jwksInput = input.jwks as Record<string, unknown>;
    if (!Array.isArray(jwksInput.keys) || jwksInput.keys.length < 1 || jwksInput.keys.length > 5) {
      throw new Error(`SMART backend client '${clientId}' requires between 1 and 5 JWKS keys.`);
    }
    const keys = jwksInput.keys.map((item) => this.backendJwk(item, clientId));
    if (new Set(keys.map((key) => key.kid)).size !== keys.length) {
      throw new Error(`SMART backend client '${clientId}' contains duplicate JWK kid values.`);
    }
    return { clientId, name, allowedScopes, jwks: { keys } };
  }

  private backendJwk(value: unknown, clientId: string): SmartBackendJwk {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`SMART backend client '${clientId}' contains an invalid JWK.`);
    const input = value as Record<string, unknown>;
    if (input.kty !== "RSA" || input.alg !== "RS384") {
      throw new Error(`SMART backend client '${clientId}' JWKs must use RSA with alg RS384.`);
    }
    if (input.use !== undefined && input.use !== "sig") throw new Error(`SMART backend client '${clientId}' JWK use must be sig.`);
    for (const privateMember of ["d", "p", "q", "dp", "dq", "qi", "oth"]) {
      if (input[privateMember] !== undefined) throw new Error(`SMART backend client '${clientId}' JWK must contain public key material only.`);
    }
    const kid = this.text(input.kid, "backend JWK kid", 128);
    if (!/^[A-Za-z0-9._~-]{3,128}$/.test(kid)) throw new Error(`SMART backend client '${clientId}' JWK kid is invalid.`);
    const n = this.text(input.n, "backend JWK modulus", 2048);
    const e = this.text(input.e, "backend JWK exponent", 32);
    if (!/^[A-Za-z0-9_-]+$/.test(n) || n.length < 256 || !/^[A-Za-z0-9_-]+$/.test(e)) {
      throw new Error(`SMART backend client '${clientId}' RSA JWK is invalid.`);
    }
    let keyOps: string[] | undefined;
    if (input.key_ops !== undefined) {
      if (!Array.isArray(input.key_ops) || !input.key_ops.every((item) => item === "verify") || input.key_ops.length !== 1) {
        throw new Error(`SMART backend client '${clientId}' JWK key_ops must be ['verify'] when provided.`);
      }
      keyOps = ["verify"];
    }
    return {
      kty: "RSA",
      kid,
      alg: "RS384",
      ...(input.use === "sig" ? { use: "sig" as const } : {}),
      ...(keyOps ? { key_ops: keyOps } : {}),
      n,
      e,
    };
  }

  private allowedScopes(value: unknown, clientId: string, supported: Set<string>): string[] {
    if (!Array.isArray(value) || value.length < 1 || value.length > 20) throw new Error(`SMART client '${clientId}' requires allowedScopes.`);
    const allowedScopes = [...new Set(value.map((item) => this.text(item, "allowedScope", 150)))];
    for (const scope of allowedScopes) {
      if (!supported.has(scope)) throw new Error(`SMART client '${clientId}' contains unsupported scope '${scope}'.`);
    }
    return allowedScopes;
  }

  private clientId(value: unknown): string {
    const clientId = this.text(value, "clientId", 128);
    if (!/^[A-Za-z0-9._~-]{3,128}$/.test(clientId)) throw new Error(`SMART clientId '${clientId}' is invalid.`);
    return clientId;
  }

  private redirectUri(value: unknown, production: boolean): string {
    const raw = this.text(value, "redirectUri", 1000);
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new Error(`SMART redirect URI '${raw}' is invalid.`);
    }
    if (url.hash) throw new Error("SMART redirect URIs must not contain fragments.");
    const loopback = ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
      throw new Error(`SMART redirect URI '${raw}' must use HTTPS or an HTTP loopback host.`);
    }
    if (url.username || url.password) throw new Error("SMART redirect URIs must not contain embedded credentials.");
    return url.toString();
  }

  private absoluteBaseUrl(value: string, name: string, production: boolean): string {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error(`${name} must be an absolute URL.`);
    }
    if (url.search || url.hash || url.username || url.password) throw new Error(`${name} must be a clean base URL without query, fragment, or credentials.`);
    if (production && url.protocol !== "https:") throw new Error(`${name} must use HTTPS in production.`);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`${name} must use HTTP or HTTPS.`);
    return url.toString().replace(/\/$/, "");
  }

  private text(value: unknown, name: string, maxLength: number): string {
    if (typeof value !== "string" || !value.trim()) throw new Error(`SMART ${name} is required.`);
    const result = value.trim();
    if (result.length > maxLength) throw new Error(`SMART ${name} exceeds ${maxLength} characters.`);
    return result;
  }
}
