export type TelehealthProvider = "mock" | "livekit";

export function telehealthProvider(env: NodeJS.ProcessEnv = process.env): TelehealthProvider {
  const raw = env.TELEHEALTH_PROVIDER?.trim().toLowerCase() || "mock";
  if (raw !== "mock" && raw !== "livekit") {
    throw new Error(`Unsupported TELEHEALTH_PROVIDER '${raw}'.`);
  }
  return raw;
}

export function validatedLiveKitUrl(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.LIVEKIT_URL?.trim();
  if (!value) throw new Error("LIVEKIT_URL is required for the LiveKit provider.");

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("LIVEKIT_URL must be a valid absolute URL.");
  }

  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error("LIVEKIT_URL must use ws:// or wss://.");
  }
  if (url.username || url.password) throw new Error("LIVEKIT_URL must not embed credentials.");
  if (url.search) throw new Error("LIVEKIT_URL must not contain a query string.");
  if (url.hash) throw new Error("LIVEKIT_URL must not contain a URL fragment.");

  if (env.NODE_ENV === "production") {
    if (url.protocol !== "wss:") throw new Error("Production LIVEKIT_URL must use wss://.");
    if (isLocalOrUnspecifiedHost(url.hostname)) {
      throw new Error("Production LIVEKIT_URL must not target a loopback, localhost, or unspecified host.");
    }
  }

  return url.toString().replace(/\/$/, "");
}

export function assertProductionTelehealthReady(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== "production") return;
  if (telehealthProvider(env) !== "livekit") {
    throw new Error("TELEHEALTH_PROVIDER=livekit is required in production.");
  }
  validatedLiveKitUrl(env);
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
