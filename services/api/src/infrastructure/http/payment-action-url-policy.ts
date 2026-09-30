export function assertProductionPaymentActionPolicyReady(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== "production") return;
  if (env.PAYMENT_GATEWAY_PROVIDER?.trim() !== "external") return;
  const origins = trustedPaymentActionOrigins(env);
  if (origins.length === 0) {
    throw new Error("PAYMENT_GATEWAY_ACTION_ORIGINS is required for external payments in production.");
  }
}

export function trustedPaymentActionOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const configured = env.PAYMENT_GATEWAY_ACTION_ORIGINS?.trim();
  if (!configured) return [];

  const origins = new Set<string>();
  for (const rawEntry of configured.split(",")) {
    const entry = rawEntry.trim();
    if (!entry) throw new Error("PAYMENT_GATEWAY_ACTION_ORIGINS must not contain empty entries.");
    let url: URL;
    try {
      url = new URL(entry);
    } catch {
      throw new Error("PAYMENT_GATEWAY_ACTION_ORIGINS contains an invalid origin.");
    }
    if (url.protocol !== "https:") throw new Error("PAYMENT_GATEWAY_ACTION_ORIGINS entries must use HTTPS.");
    if (url.username || url.password) throw new Error("PAYMENT_GATEWAY_ACTION_ORIGINS entries must not contain credentials.");
    if (url.hostname.includes("*")) throw new Error("PAYMENT_GATEWAY_ACTION_ORIGINS does not support wildcard hosts.");
    if (url.pathname !== "/") throw new Error("PAYMENT_GATEWAY_ACTION_ORIGINS entries must not contain a path.");
    if (url.search) throw new Error("PAYMENT_GATEWAY_ACTION_ORIGINS entries must not contain a query string.");
    if (url.hash) throw new Error("PAYMENT_GATEWAY_ACTION_ORIGINS entries must not contain a URL fragment.");
    if (isLoopbackHost(url.hostname)) throw new Error("PAYMENT_GATEWAY_ACTION_ORIGINS entries must not target loopback hosts.");
    origins.add(url.origin);
  }
  return [...origins];
}

export function validatedPaymentActionUrl(value: string, env: NodeJS.ProcessEnv = process.env): string {
  const candidate = value.trim();
  if (!candidate) throw new Error("Hosted payment action URL is empty.");

  if (env.NODE_ENV !== "production") return candidate;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error("Hosted payment action URL is invalid.");
  }
  if (url.protocol !== "https:") throw new Error("Hosted payment action URL must use HTTPS.");
  if (url.username || url.password) throw new Error("Hosted payment action URL must not contain credentials.");
  if (isLoopbackHost(url.hostname)) throw new Error("Hosted payment action URL must not target loopback hosts.");

  const trusted = trustedPaymentActionOrigins(env);
  if (trusted.length === 0) throw new Error("Hosted payment action origins are not configured.");
  if (!trusted.includes(url.origin)) throw new Error("Hosted payment action origin is not trusted.");
  return url.toString();
}

function isLoopbackHost(hostname: string): boolean {
  const value = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return value === "localhost" || value === "127.0.0.1" || value === "::1" || value.endsWith(".localhost");
}
