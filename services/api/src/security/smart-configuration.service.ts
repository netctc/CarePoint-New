import { Injectable, OnModuleInit } from "@nestjs/common";

export interface SmartClientConfiguration {
  clientId: string;
  name: string;
  redirectUris: string[];
  allowedScopes: string[];
}

export const SMART_SUPPORTED_SCOPES = [
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

const SUPPORTED_SCOPE_SET = new Set<string>(SMART_SUPPORTED_SCOPES);

@Injectable()
export class SmartConfigurationService implements OnModuleInit {
  private issuer = "";
  private fhirBase = "";
  private readonly clients = new Map<string, SmartClientConfiguration>();

  onModuleInit(): void {
    const production = process.env.NODE_ENV === "production";
    const configuredIssuer = process.env.SMART_ISSUER_URL?.trim();
    const configuredFhirBase = process.env.SMART_FHIR_BASE_URL?.trim();
    if (production && (!configuredIssuer || !configuredFhirBase)) {
      throw new Error("SMART_ISSUER_URL and SMART_FHIR_BASE_URL are required in production.");
    }

    this.issuer = this.absoluteBaseUrl(configuredIssuer || "http://127.0.0.1:4000/api/v1", "SMART_ISSUER_URL", production);
    this.fhirBase = this.absoluteBaseUrl(configuredFhirBase || `${this.issuer}/fhir/R4`, "SMART_FHIR_BASE_URL", production);

    const rawClients = process.env.SMART_PUBLIC_CLIENTS_JSON?.trim();
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

  discovery(): Record<string, unknown> {
    return {
      issuer: this.issuer,
      authorization_endpoint: `${this.issuer}/smart/browser/authorize`,
      token_endpoint: `${this.issuer}/smart/token`,
      revocation_endpoint: `${this.issuer}/smart/revoke`,
      jwks_uri: `${this.issuer}/smart/jwks`,
      capabilities: [
        "launch-standalone",
        "client-public",
        "context-standalone-patient",
        "sso-openid-connect",
        "permission-patient",
        "permission-offline",
        "permission-v2",
      ],
      scopes_supported: [...SMART_SUPPORTED_SCOPES],
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    };
  }

  openidConfiguration(): Record<string, unknown> {
    return {
      issuer: this.issuer,
      authorization_endpoint: `${this.issuer}/smart/browser/authorize`,
      token_endpoint: `${this.issuer}/smart/token`,
      jwks_uri: `${this.issuer}/smart/jwks`,
      response_types_supported: ["code"],
      response_modes_supported: ["query"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      subject_types_supported: ["pairwise"],
      id_token_signing_alg_values_supported: ["RS256"],
      scopes_supported: [...SMART_SUPPORTED_SCOPES],
      token_endpoint_auth_methods_supported: ["none"],
      code_challenge_methods_supported: ["S256"],
      claims_supported: ["iss", "sub", "aud", "exp", "iat", "auth_time", "nonce", "fhirUser"],
    };
  }

  client(clientId: string): SmartClientConfiguration | null {
    return this.clients.get(clientId) ?? null;
  }

  fhirBaseUrl(): string {
    return this.fhirBase;
  }

  issuerUrl(): string {
    return this.issuer;
  }

  private parseClient(value: unknown, production: boolean): SmartClientConfiguration {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Each SMART client configuration must be an object.");
    const input = value as Record<string, unknown>;
    const clientId = this.text(input.clientId, "clientId", 128);
    if (!/^[A-Za-z0-9._~-]{3,128}$/.test(clientId)) throw new Error(`SMART clientId '${clientId}' is invalid.`);
    const name = this.text(input.name, "name", 200);
    if (!Array.isArray(input.redirectUris) || input.redirectUris.length < 1 || input.redirectUris.length > 10) {
      throw new Error(`SMART client '${clientId}' requires between 1 and 10 redirectUris.`);
    }
    const redirectUris = [...new Set(input.redirectUris.map((item) => this.redirectUri(item, production)))];
    if (!Array.isArray(input.allowedScopes) || input.allowedScopes.length < 1) throw new Error(`SMART client '${clientId}' requires allowedScopes.`);
    const allowedScopes = [...new Set(input.allowedScopes.map((item) => this.text(item, "allowedScope", 150)))];
    for (const scope of allowedScopes) {
      if (!SUPPORTED_SCOPE_SET.has(scope)) throw new Error(`SMART client '${clientId}' contains unsupported scope '${scope}'.`);
    }
    return { clientId, name, redirectUris, allowedScopes };
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
