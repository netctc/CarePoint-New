export type FinancialGatewayName = "payment" | "insurance" | "claims";

type FinancialGatewayEgressRequirement = {
  name: FinancialGatewayName;
  providerEnv: string;
  baseUrlEnv: string;
  timeoutEnv: string;
};

export const FINANCIAL_GATEWAY_EGRESS_REQUIREMENTS: readonly FinancialGatewayEgressRequirement[] = [
  { name: "payment", providerEnv: "PAYMENT_GATEWAY_PROVIDER", baseUrlEnv: "PAYMENT_GATEWAY_BASE_URL", timeoutEnv: "PAYMENT_GATEWAY_TIMEOUT_MS" },
  { name: "insurance", providerEnv: "INSURANCE_GATEWAY_PROVIDER", baseUrlEnv: "INSURANCE_GATEWAY_BASE_URL", timeoutEnv: "INSURANCE_GATEWAY_TIMEOUT_MS" },
  { name: "claims", providerEnv: "CLAIMS_GATEWAY_PROVIDER", baseUrlEnv: "CLAIMS_GATEWAY_BASE_URL", timeoutEnv: "CLAIMS_GATEWAY_TIMEOUT_MS" },
] as const;

const DEFAULT_TIMEOUT_MS = 10_000;
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 30_000;

export function financialGatewayTimeoutMs(timeoutEnv: string, env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[timeoutEnv]?.trim();
  if (!raw) {
    if (env.NODE_ENV === "production") throw new Error(`${timeoutEnv} is required in production.`);
    return DEFAULT_TIMEOUT_MS;
  }
  if (!/^\d+$/.test(raw)) throw new Error(`${timeoutEnv} must be an integer.`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < MIN_TIMEOUT_MS || value > MAX_TIMEOUT_MS) {
    throw new Error(`${timeoutEnv} must be between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS}.`);
  }
  return value;
}

export function validatedFinancialGatewayBaseUrl(baseUrlEnv: string, env: NodeJS.ProcessEnv = process.env): string {
  const value = env[baseUrlEnv]?.trim();
  if (!value) throw new Error(`${baseUrlEnv} is required for external financial gateway operations.`);

  let url: URL;
  try {
    url = new URL(value.endsWith("/") ? value : `${value}/`);
  } catch {
    throw new Error(`${baseUrlEnv} is invalid.`);
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`${baseUrlEnv} must use HTTP or HTTPS.`);
  }
  if (url.username || url.password) throw new Error(`${baseUrlEnv} must not contain embedded credentials.`);
  if (url.hash) throw new Error(`${baseUrlEnv} must not contain a URL fragment.`);

  if (env.NODE_ENV === "production") {
    if (url.protocol !== "https:") throw new Error(`${baseUrlEnv} must use HTTPS in production.`);
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]") {
      throw new Error(`${baseUrlEnv} must not target loopback in production.`);
    }
  }
  return url.toString();
}

export function assertProductionFinancialGatewayEgressReady(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== "production") return;

  for (const requirement of FINANCIAL_GATEWAY_EGRESS_REQUIREMENTS) {
    const provider = env[requirement.providerEnv]?.trim() || "external";
    if (provider !== "external") {
      throw new Error(`${requirement.providerEnv}=external is required in production for C13 financial egress readiness.`);
    }
    validatedFinancialGatewayBaseUrl(requirement.baseUrlEnv, env);
    financialGatewayTimeoutMs(requirement.timeoutEnv, env);
  }
}
