import { BadGatewayException, Injectable, InternalServerErrorException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { financialGatewayTimeoutMs, validatedFinancialGatewayBaseUrl } from "../../infrastructure/http/financial-gateway-egress";
import { ExternalSecretResolverService } from "../../infrastructure/secrets/external-secret-resolver.service";

type EligibilityStatus = "ELIGIBLE" | "NOT_ELIGIBLE" | "UNKNOWN";
type PriorAuthorizationStatus = "NOT_REQUIRED" | "PENDING" | "APPROVED" | "DENIED" | "EXPIRED" | "CANCELLED";

export interface GatewayEligibilityResult {
  gateway: string;
  reference: string;
  status: EligibilityStatus;
  estimatedPatientMinor?: number;
  estimatedInsurerMinor?: number;
  expiresAt?: Date;
}

export interface GatewayPriorAuthorizationResult {
  gateway: string;
  reference: string;
  status: PriorAuthorizationStatus;
  approvedAmountMinor?: number;
  validUntil?: Date;
}

@Injectable()
export class InsuranceGatewayService {
  constructor(private readonly secrets: ExternalSecretResolverService = new ExternalSecretResolverService()) {}

  name(): string {
    return this.provider() === "mock" ? "MOCK_INSURANCE" : "EXTERNAL_INSURANCE";
  }

  async checkEligibility(input: {
    idempotencyKey: string;
    payerCode: string;
    externalPolicyRef: string;
    appointmentId: string;
    serviceId: string;
    totalMinor: number;
    currency: string;
  }): Promise<GatewayEligibilityResult> {
    if (this.provider() === "mock") {
      const insurer = Math.floor(input.totalMinor * 0.7);
      const patient = input.totalMinor - insurer;
      return {
        gateway: "MOCK_INSURANCE",
        reference: `mock_el_${this.digest(`${input.idempotencyKey}:${input.appointmentId}`)}`,
        status: "ELIGIBLE",
        estimatedPatientMinor: patient,
        estimatedInsurerMinor: insurer,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      };
    }
    const payload = await this.externalRequest("POST", "/v1/eligibility", input, input.idempotencyKey);
    const reference = this.requiredText(payload.reference, "Insurance eligibility reference");
    const status = payload.status;
    if (status !== "ELIGIBLE" && status !== "NOT_ELIGIBLE" && status !== "UNKNOWN") throw new BadGatewayException("Insurance gateway returned an unsupported eligibility status.");
    const estimatedPatientMinor = this.optionalMoney(payload.estimatedPatientMinor, "estimatedPatientMinor");
    const estimatedInsurerMinor = this.optionalMoney(payload.estimatedInsurerMinor, "estimatedInsurerMinor");
    const expiresAt = this.optionalDate(payload.expiresAt, "expiresAt");
    return {
      gateway: "EXTERNAL_INSURANCE",
      reference,
      status,
      ...(estimatedPatientMinor !== undefined ? { estimatedPatientMinor } : {}),
      ...(estimatedInsurerMinor !== undefined ? { estimatedInsurerMinor } : {}),
      ...(expiresAt ? { expiresAt } : {}),
    };
  }

  async requestPriorAuthorization(input: {
    idempotencyKey: string;
    payerCode: string;
    externalPolicyRef: string;
    appointmentId: string;
    serviceId: string;
    totalMinor: number;
    currency: string;
    eligibilityReference?: string;
  }): Promise<GatewayPriorAuthorizationResult> {
    if (this.provider() === "mock") {
      const threshold = Number(process.env.INSURANCE_MOCK_PREAUTH_THRESHOLD_MINOR ?? "10000");
      const required = Number.isFinite(threshold) && input.totalMinor > threshold;
      return {
        gateway: "MOCK_INSURANCE",
        reference: `mock_pa_${this.digest(`${input.idempotencyKey}:${input.appointmentId}`)}`,
        status: required ? "APPROVED" : "NOT_REQUIRED",
        ...(required ? { approvedAmountMinor: input.totalMinor, validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) } : {}),
      };
    }
    const payload = await this.externalRequest("POST", "/v1/prior-authorizations", input, input.idempotencyKey);
    const reference = this.requiredText(payload.reference, "Insurance prior-authorization reference");
    const status = payload.status;
    if (status !== "NOT_REQUIRED" && status !== "PENDING" && status !== "APPROVED" && status !== "DENIED" && status !== "EXPIRED" && status !== "CANCELLED") {
      throw new BadGatewayException("Insurance gateway returned an unsupported prior-authorization status.");
    }
    const approvedAmountMinor = this.optionalMoney(payload.approvedAmountMinor, "approvedAmountMinor");
    const validUntil = this.optionalDate(payload.validUntil, "validUntil");
    return {
      gateway: "EXTERNAL_INSURANCE",
      reference,
      status,
      ...(approvedAmountMinor !== undefined ? { approvedAmountMinor } : {}),
      ...(validUntil ? { validUntil } : {}),
    };
  }

  private provider(): "mock" | "external" {
    const provider = process.env.INSURANCE_GATEWAY_PROVIDER ?? (process.env.NODE_ENV === "production" ? "external" : "mock");
    if (provider !== "mock" && provider !== "external") throw new InternalServerErrorException(`Unsupported INSURANCE_GATEWAY_PROVIDER '${provider}'.`);
    if (process.env.NODE_ENV === "production" && provider === "mock") throw new InternalServerErrorException("Mock insurance checks are forbidden in production.");
    return provider;
  }

  private async externalRequest(method: "POST", path: string, body: Record<string, unknown>, idempotencyKey: string): Promise<Record<string, unknown>> {
    const apiKey = await this.secrets.resolve("insurance-gateway-api-key");
    let response: Response;
    try {
      response = await fetch(new URL(path.replace(/^\//, ""), this.baseUrl()), {
        method,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
        },
        body: JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(this.timeoutMs()),
      });
    } catch {
      throw new BadGatewayException("External insurance gateway transport failed.");
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new BadGatewayException(`External insurance gateway request failed with HTTP ${response.status}.`);
    }
    return payload as Record<string, unknown>;
  }

  private baseUrl(): string {
    try {
      return validatedFinancialGatewayBaseUrl("INSURANCE_GATEWAY_BASE_URL");
    } catch (error) {
      throw new InternalServerErrorException(error instanceof Error ? error.message : "INSURANCE_GATEWAY_BASE_URL is invalid.");
    }
  }

  private timeoutMs(): number {
    try {
      return financialGatewayTimeoutMs("INSURANCE_GATEWAY_TIMEOUT_MS");
    } catch (error) {
      throw new InternalServerErrorException(error instanceof Error ? error.message : "INSURANCE_GATEWAY_TIMEOUT_MS is invalid.");
    }
  }

  private requiredText(value: unknown, label: string): string {
    if (typeof value !== "string" || !value.trim()) throw new BadGatewayException(`${label} is missing.`);
    return value.trim().slice(0, 300);
  }

  private optionalMoney(value: unknown, field: string): number | undefined {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throw new BadGatewayException(`Insurance gateway returned invalid ${field}.`);
    return value;
  }

  private optionalDate(value: unknown, field: string): Date | undefined {
    if (value === undefined || value === null || value === "") return undefined;
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) throw new BadGatewayException(`Insurance gateway returned invalid ${field}.`);
    return date;
  }

  private digest(value: string): string {
    return createHash("sha256").update(value).digest("hex").slice(0, 24);
  }
}
