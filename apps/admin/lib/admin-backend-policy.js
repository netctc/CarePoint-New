const DEFAULT_API_BASE_URL = "http://127.0.0.1:4000/api/v1";
const DEFAULT_API_TIMEOUT_MS = 10_000;
const DEFAULT_API_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MIN_API_TIMEOUT_MS = 100;
const MAX_API_TIMEOUT_MS = 30_000;
const MIN_API_MAX_RESPONSE_BYTES = 1024;
const MAX_API_MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

export function adminApiBaseUrl(env = process.env) {
  const configured = env.CAREPOINT_API_URL?.trim();
  if (env.NODE_ENV === "production" && !configured) {
    throw new Error("CAREPOINT_API_URL is required in production.");
  }

  const raw = configured || DEFAULT_API_BASE_URL;
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("CAREPOINT_API_URL must be a valid absolute URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("CAREPOINT_API_URL must use http:// or https://.");
  }
  if (url.username || url.password) {
    throw new Error("CAREPOINT_API_URL must not embed credentials.");
  }
  if (url.search) throw new Error("CAREPOINT_API_URL must not contain a query string.");
  if (url.hash) throw new Error("CAREPOINT_API_URL must not contain a URL fragment.");

  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (path !== "/api/v1") {
    throw new Error("CAREPOINT_API_URL must target the /api/v1 base path.");
  }

  if (env.NODE_ENV === "production" && url.protocol !== "https:" && !isNumericLoopback(url.hostname)) {
    throw new Error("Production CAREPOINT_API_URL must use HTTPS unless it targets numeric loopback.");
  }

  url.pathname = "/api/v1";
  return url.toString().replace(/\/$/, "");
}

export function adminApiTimeoutMs(env = process.env) {
  return boundedInteger(
    env.CAREPOINT_API_TIMEOUT_MS,
    DEFAULT_API_TIMEOUT_MS,
    "CAREPOINT_API_TIMEOUT_MS",
    MIN_API_TIMEOUT_MS,
    MAX_API_TIMEOUT_MS,
  );
}

export function adminApiMaxResponseBytes(env = process.env) {
  return boundedInteger(
    env.CAREPOINT_API_MAX_RESPONSE_BYTES,
    DEFAULT_API_MAX_RESPONSE_BYTES,
    "CAREPOINT_API_MAX_RESPONSE_BYTES",
    MIN_API_MAX_RESPONSE_BYTES,
    MAX_API_MAX_RESPONSE_BYTES,
  );
}

export function adminBackendUrl(path, env = process.env) {
  if (
    typeof path !== "string" ||
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.includes("\\") ||
    path.includes("#") ||
    /[\r\n\0]/.test(path)
  ) {
    throw new Error("Admin backend path must be a safe absolute API-relative path.");
  }

  rejectDotSegments(path);
  const base = new URL(`${adminApiBaseUrl(env)}/`);
  const target = new URL(path.slice(1), base);
  if (target.origin !== base.origin) throw new Error("Admin backend path escaped the configured API origin.");
  if (target.pathname !== "/api/v1" && !target.pathname.startsWith("/api/v1/")) {
    throw new Error("Admin backend path escaped the configured /api/v1 base path.");
  }
  return target.toString();
}

export async function adminBackendFetch(path, init = {}, env = process.env, fetchImpl = globalThis.fetch) {
  const timeoutSignal = AbortSignal.timeout(adminApiTimeoutMs(env));
  const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
  return fetchImpl(adminBackendUrl(path, env), {
    ...init,
    cache: "no-store",
    redirect: "error",
    signal,
  });
}

export async function readBoundedAdminBackendText(response, env = process.env) {
  const limit = adminApiMaxResponseBytes(env);
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    const normalized = declared.trim();
    if (!/^\d+$/.test(normalized)) {
      await cancelResponseBody(response);
      throw new Error("CarePoint API response Content-Length is invalid.");
    }
    const declaredBytes = Number(normalized);
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes > limit) {
      await cancelResponseBody(response);
      throw new Error(`CarePoint API response exceeds ${limit} bytes.`);
    }
  }

  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let total = 0;
  let output = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > limit) throw new Error(`CarePoint API response exceeds ${limit} bytes.`);
      output += decoder.decode(value, { stream: true });
    }
    output += decoder.decode();
    return output;
  } catch (error) {
    try {
      await reader.cancel();
    } catch {
      // Best effort: the original bounded-read failure remains authoritative.
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
}

function rejectDotSegments(path) {
  const pathname = path.split("?", 1)[0] || "";
  for (const segment of pathname.split("/")) {
    let decoded;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw new Error("Admin backend path contains invalid percent encoding.");
    }
    if (decoded === "." || decoded === "..") {
      throw new Error("Admin backend path must not contain dot segments.");
    }
  }
}

function boundedInteger(rawValue, defaultValue, name, minimum, maximum) {
  const raw = rawValue?.trim() || String(defaultValue);
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be an integer.`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}

function isNumericLoopback(hostname) {
  const value = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return value === "127.0.0.1" || value === "::1";
}

async function cancelResponseBody(response) {
  try {
    await response.body?.cancel();
  } catch {
    // Best effort only; the validation error is returned to the caller.
  }
}
