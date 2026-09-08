import { Injectable } from "@nestjs/common";
import { AwsKmsKeyProvider } from "./aws-kms-key-provider";

type EnvelopeDomainSpec = {
  name: string;
  providerEnv: string;
  keyIdEnv: string;
  purpose: string;
};

type ResolvedEnvelopeDomain = EnvelopeDomainSpec & {
  provider: string;
  keyId: string | null;
};

export type KmsConfigurationSummary = {
  required: boolean;
  production: boolean;
  domains: string[];
  region: string | null;
  customEndpoint: boolean;
};

export type KmsReadinessSummary = KmsConfigurationSummary & {
  ready: true;
  checkedAt: string;
};

const ENVELOPE_DOMAINS: readonly EnvelopeDomainSpec[] = [
  { name: "mfa", providerEnv: "MFA_KEY_PROVIDER", keyIdEnv: "MFA_KMS_KEY_ID", purpose: "carepoint-mfa-secret-dek" },
  { name: "clinical", providerEnv: "CLINICAL_KEY_PROVIDER", keyIdEnv: "CLINICAL_KMS_KEY_ID", purpose: "carepoint-clinical-record-dek" },
  { name: "orders", providerEnv: "ORDER_KEY_PROVIDER", keyIdEnv: "ORDER_KMS_KEY_ID", purpose: "carepoint-clinical-order-dek" },
  { name: "documents", providerEnv: "DOCUMENT_KEY_PROVIDER", keyIdEnv: "DOCUMENT_KMS_KEY_ID", purpose: "carepoint-clinical-document-dek" },
  { name: "messaging", providerEnv: "MESSAGING_KEY_PROVIDER", keyIdEnv: "MESSAGING_KMS_KEY_ID", purpose: "carepoint-secure-message-dek" },
  { name: "telehealth", providerEnv: "TELEHEALTH_KEY_PROVIDER", keyIdEnv: "TELEHEALTH_KMS_KEY_ID", purpose: "carepoint-telehealth-session-key-dek" },
] as const;

@Injectable()
export class KmsReadinessService {
  private cachedSuccess?: { at: number; value: KmsReadinessSummary };

  validateConfiguration(): KmsConfigurationSummary {
    const production = process.env.NODE_ENV === "production";
    const resolved = ENVELOPE_DOMAINS.map((domain) => this.resolveDomain(domain, production));

    if (production) {
      const nonKms = resolved.filter((domain) => domain.provider !== "aws-kms");
      if (nonKms.length > 0) {
        throw new Error(`Production envelope encryption requires AWS KMS for: ${nonKms.map((domain) => domain.name).join(", ")}.`);
      }
    }

    const active = resolved.filter((domain) => domain.provider === "aws-kms");
    if (active.length === 0) {
      return { required: false, production, domains: [], region: null, customEndpoint: false };
    }

    for (const domain of active) {
      if (!domain.keyId) throw new Error(`${domain.keyIdEnv} is required when ${domain.providerEnv}=aws-kms.`);
    }

    const region = process.env.AWS_REGION?.trim() || process.env.AWS_DEFAULT_REGION?.trim() || "";
    if (!region) throw new Error("AWS_REGION (or AWS_DEFAULT_REGION) is required when CarePoint envelope encryption uses AWS KMS.");

    const endpoint = process.env.AWS_ENDPOINT_URL_KMS?.trim() || "";
    if (production && endpoint) {
      if (process.env.AWS_KMS_ALLOW_CUSTOM_ENDPOINT !== "true") {
        throw new Error("AWS_ENDPOINT_URL_KMS is forbidden in production unless AWS_KMS_ALLOW_CUSTOM_ENDPOINT=true is explicitly set.");
      }
      let url: URL;
      try {
        url = new URL(endpoint);
      } catch {
        throw new Error("AWS_ENDPOINT_URL_KMS must be a valid URL.");
      }
      if (url.protocol !== "https:") throw new Error("Production AWS_ENDPOINT_URL_KMS must use HTTPS.");
    }

    return {
      required: true,
      production,
      domains: active.map((domain) => domain.name),
      region,
      customEndpoint: Boolean(endpoint),
    };
  }

  async check(options: { force?: boolean } = {}): Promise<KmsReadinessSummary> {
    const config = this.validateConfiguration();
    if (!config.required) {
      return { ...config, ready: true, checkedAt: new Date().toISOString() };
    }

    const now = Date.now();
    const cacheMs = this.healthCacheMs();
    if (!options.force && this.cachedSuccess && now - this.cachedSuccess.at < cacheMs) {
      return this.cachedSuccess.value;
    }

    const production = config.production;
    const resolved = ENVELOPE_DOMAINS.map((domain) => this.resolveDomain(domain, production))
      .filter((domain) => domain.provider === "aws-kms");
    const region = config.region ?? undefined;
    const endpoint = process.env.AWS_ENDPOINT_URL_KMS?.trim() || undefined;

    for (const domain of resolved) {
      const provider = new AwsKmsKeyProvider(domain.keyId!, domain.purpose, region, endpoint);
      await provider.healthCheck();
    }

    const value: KmsReadinessSummary = {
      ...config,
      ready: true,
      checkedAt: new Date().toISOString(),
    };
    this.cachedSuccess = { at: now, value };
    return value;
  }

  async assertStartupReady(): Promise<void> {
    const config = this.validateConfiguration();
    if (config.production || process.env.AWS_KMS_STARTUP_PROBE === "true") {
      await this.check({ force: true });
    }
  }

  private resolveDomain(domain: EnvelopeDomainSpec, production: boolean): ResolvedEnvelopeDomain {
    const provider = process.env[domain.providerEnv]?.trim() || (production ? "aws-kms" : "local");
    if (provider !== "local" && provider !== "aws-kms") {
      throw new Error(`Unsupported ${domain.providerEnv} value '${provider}'.`);
    }
    return {
      ...domain,
      provider,
      keyId: process.env[domain.keyIdEnv]?.trim() || null,
    };
  }

  private healthCacheMs(): number {
    const raw = Number(process.env.AWS_KMS_HEALTH_CACHE_MS ?? 30_000);
    if (!Number.isFinite(raw)) return 30_000;
    return Math.min(300_000, Math.max(5_000, Math.trunc(raw)));
  }
}
