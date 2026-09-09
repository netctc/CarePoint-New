export function assertProductionNotificationGatewayEgressReady(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== "production") return;
  if (env.NOTIFICATION_GATEWAY_PROVIDER?.trim() !== "external") {
    throw new Error("NOTIFICATION_GATEWAY_PROVIDER=external is required in production.");
  }
  validatedNotificationGatewayBaseUrl(env);
  notificationGatewayTimeoutMs(env);
}

export function validatedNotificationGatewayBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.NOTIFICATION_GATEWAY_BASE_URL?.trim();
  if (!value) throw new Error("NOTIFICATION_GATEWAY_BASE_URL is required for external notification delivery.");

  let url: URL;
  try {
    url = new URL(value.endsWith("/") ? value : `${value}/`);
  } catch {
    throw new Error("NOTIFICATION_GATEWAY_BASE_URL is invalid.");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("NOTIFICATION_GATEWAY_BASE_URL must use http:// or https://.");
  }
  if (url.username || url.password) throw new Error("NOTIFICATION_GATEWAY_BASE_URL must not contain embedded credentials.");
  if (url.hash) throw new Error("NOTIFICATION_GATEWAY_BASE_URL must not contain a URL fragment.");

  if (env.NODE_ENV === "production") {
    if (url.protocol !== "https:") throw new Error("NOTIFICATION_GATEWAY_BASE_URL must use HTTPS in production.");
    if (isLocalHost(url.hostname)) throw new Error("NOTIFICATION_GATEWAY_BASE_URL must not target loopback in production.");
  }

  return url.toString();
}

export function notificationGatewayTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const configured = env.NOTIFICATION_GATEWAY_TIMEOUT_MS?.trim();
  if (env.NODE_ENV === "production" && !configured) {
    throw new Error("NOTIFICATION_GATEWAY_TIMEOUT_MS is required in production.");
  }
  const raw = configured || "10000";
  if (!/^\d+$/.test(raw)) throw new Error("NOTIFICATION_GATEWAY_TIMEOUT_MS must be an integer.");
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 100 || value > 30_000) {
    throw new Error("NOTIFICATION_GATEWAY_TIMEOUT_MS must be between 100 and 30000.");
  }
  return value;
}

function isLocalHost(hostname: string): boolean {
  const value = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return value === "localhost" || value === "127.0.0.1" || value === "::1" || value.endsWith(".localhost");
}
