export interface SmartPublicEndpointConfiguration {
  issuerUrl: string;
  fhirBaseUrl: string;
}

export function assertProductionSmartPublicEndpointsReady(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== "production") return;
  productionSmartPublicEndpoints(env);
}

export function productionSmartPublicEndpoints(env: NodeJS.ProcessEnv = process.env): SmartPublicEndpointConfiguration {
  const issuer = env.SMART_ISSUER_URL?.trim();
  const fhirBase = env.SMART_FHIR_BASE_URL?.trim();
  if (!issuer || !fhirBase) {
    throw new Error("SMART_ISSUER_URL and SMART_FHIR_BASE_URL are required in production.");
  }
  return {
    issuerUrl: validatedSmartPublicBaseUrl(issuer, "SMART_ISSUER_URL", true),
    fhirBaseUrl: validatedSmartPublicBaseUrl(fhirBase, "SMART_FHIR_BASE_URL", true),
  };
}

export function validatedSmartPublicBaseUrl(value: string, name: string, production: boolean): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URL.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${name} must use HTTP or HTTPS.`);
  }
  if (url.search || url.hash || url.username || url.password) {
    throw new Error(`${name} must be a clean base URL without query, fragment, or credentials.`);
  }
  if (production) {
    if (url.protocol !== "https:") throw new Error(`${name} must use HTTPS in production.`);
    if (isLocalOrUnspecifiedHost(url.hostname)) {
      throw new Error(`${name} must not target localhost, loopback, or an unspecified host in production.`);
    }
  }
  return url.toString().replace(/\/$/, "");
}

function isLocalOrUnspecifiedHost(hostname: string): boolean {
  const value = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  return (
    value === "localhost" ||
    value.endsWith(".localhost") ||
    value === "0.0.0.0" ||
    value === "::" ||
    value === "::1" ||
    /^127(?:\.|$)/.test(value)
  );
}
