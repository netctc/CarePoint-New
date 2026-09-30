const DEVELOPMENT_DEFAULT_ORIGIN = "http://localhost:3000";
const MAX_BROWSER_ORIGINS = 32;

export function browserOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const configured = env.ALLOWED_ORIGINS?.trim();
  if (env.NODE_ENV === "production" && !configured) {
    throw new Error("ALLOWED_ORIGINS is required in production.");
  }

  const raw = configured || DEVELOPMENT_DEFAULT_ORIGIN;
  const entries = raw.split(",");
  if (entries.length > MAX_BROWSER_ORIGINS) {
    throw new Error(`ALLOWED_ORIGINS must contain at most ${MAX_BROWSER_ORIGINS} origins.`);
  }
  if (entries.some((entry) => !entry.trim())) {
    throw new Error("ALLOWED_ORIGINS must not contain empty entries.");
  }

  const production = env.NODE_ENV === "production";
  const normalized = entries.map((entry, index) => validatedBrowserOrigin(entry.trim(), production, index));
  if (new Set(normalized).size !== normalized.length) {
    throw new Error("ALLOWED_ORIGINS must not contain duplicate origins.");
  }
  return normalized;
}

export function assertProductionBrowserOriginsReady(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== "production") return;
  browserOrigins(env);
}

export function validatedBrowserOrigin(value: string, production: boolean, index = 0): string {
  if (value === "*" || value.toLowerCase() === "null") {
    throw new Error(`ALLOWED_ORIGINS entry ${index + 1} must be an explicit browser origin.`);
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`ALLOWED_ORIGINS entry ${index + 1} must be a valid absolute URL origin.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`ALLOWED_ORIGINS entry ${index + 1} must use http:// or https://.`);
  }
  if (url.username || url.password) {
    throw new Error(`ALLOWED_ORIGINS entry ${index + 1} must not embed credentials.`);
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`ALLOWED_ORIGINS entry ${index + 1} must be an origin only, without path, query, or fragment.`);
  }

  if (production) {
    if (url.protocol !== "https:") {
      throw new Error(`ALLOWED_ORIGINS entry ${index + 1} must use HTTPS in production.`);
    }
    if (isLocalOrUnspecifiedHost(url.hostname)) {
      throw new Error(`ALLOWED_ORIGINS entry ${index + 1} must not target localhost, loopback, or an unspecified host in production.`);
    }
  }

  return url.origin;
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
