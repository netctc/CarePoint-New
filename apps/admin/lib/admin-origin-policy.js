const PUBLIC_ORIGIN_ENV = "CAREPOINT_ADMIN_PUBLIC_ORIGIN";

export function adminPublicOrigin(env = process.env) {
  const raw = env[PUBLIC_ORIGIN_ENV]?.trim();
  if (!raw) return null;

  const url = parseOriginUrl(raw, PUBLIC_ORIGIN_ENV);
  if (env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error(`${PUBLIC_ORIGIN_ENV} must use HTTPS in production.`);
  }
  return url.origin;
}

export function isTrustedAdminPublicOriginRequest(request, env = process.env) {
  const rawOrigin = request.headers.get("origin");
  if (!rawOrigin) return true;

  let requestOrigin;
  try {
    requestOrigin = parseOriginUrl(rawOrigin, "Origin").origin;
  } catch {
    return false;
  }

  let configuredOrigin;
  try {
    configuredOrigin = adminPublicOrigin(env);
  } catch {
    return false;
  }

  if (configuredOrigin) return requestOrigin === configuredOrigin;
  if (env.NODE_ENV === "production") return false;

  try {
    return requestOrigin === parseOriginUrl(request.nextUrl.origin, "request.nextUrl.origin").origin;
  } catch {
    return false;
  }
}

function parseOriginUrl(raw, name) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} must be a valid absolute URL.`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${name} must use http:// or https://.`);
  }
  if (url.username || url.password) {
    throw new Error(`${name} must not embed credentials.`);
  }
  if (url.search) throw new Error(`${name} must not contain a query string.`);
  if (url.hash) throw new Error(`${name} must not contain a URL fragment.`);
  if (url.pathname !== "/") throw new Error(`${name} must contain only an origin.`);

  return url;
}
