import { BadGatewayException, BadRequestException, Injectable, InternalServerErrorException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { ExternalSecretResolverService } from "../../infrastructure/secrets/external-secret-resolver.service";

type PaymentStatus = "REQUIRES_ACTION" | "PROCESSING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
type RefundGatewayStatus = "PENDING" | "SUCCEEDED" | "FAILED";
type PayoutGatewayStatus = "PENDING" | "PROCESSING" | "PAID" | "FAILED" | "CANCELLED";

export interface GatewayPaymentResult {
  gateway: string;
  reference: string;
  status: PaymentStatus;
  actionUrl?: string;
  failureCode?: string;
}

export interface GatewayRefundResult {
  gateway: string;
  reference: string;
  status: RefundGatewayStatus;
}

export interface GatewayPayoutResult {
  gateway: string;
  reference: string;
  status: PayoutGatewayStatus;
}

@Injectable()
export class PaymentGatewayService {
  constructor(private readonly secrets: ExternalSecretResolverService = new ExternalSecretResolverService()) {}

  name(): string {
    return this.provider() === "mock" ? "MOCK_PSP" : "EXTERNAL_PSP";
  }

  async createIntent(input: {
    idempotencyKey: string;
    amountMinor: number;
    currency: string;
    reference: string;
    paymentMethodToken?: string;
  }): Promise<GatewayPaymentResult> {
    if (this.provider() === "mock") {
      return {
        gateway: "MOCK_PSP",
        reference: `mock_pi_${this.digest(`${input.idempotencyKey}:${input.amountMinor}:${input.currency}`)}`,
        status: "SUCCEEDED",
      };
    }
    const payload = await this.externalRequest("POST", "/v1/payment-intents", {
      idempotencyKey: input.idempotencyKey,
      amountMinor: input.amountMinor,
      currency: input.currency,
      reference: input.reference,
      ...(input.paymentMethodToken ? { paymentMethodToken: input.paymentMethodToken } : {}),
    }, input.idempotencyKey);
    return this.parsePaymentResult(payload);
  }

  async retrieveIntent(reference: string): Promise<GatewayPaymentResult> {
    if (this.provider() === "mock") {
      return { gateway: "MOCK_PSP", reference, status: "SUCCEEDED" };
    }
    const payload = await this.externalRequest("GET", `/v1/payment-intents/${encodeURIComponent(reference)}`);
    return this.parsePaymentResult(payload);
  }

  async refund(input: {
    idempotencyKey: string;
    paymentReference: string;
    amountMinor: number;
    currency: string;
    reason?: string;
  }): Promise<GatewayRefundResult> {
    if (this.provider() === "mock") {
      return {
        gateway: "MOCK_PSP",
        reference: `mock_rf_${this.digest(`${input.idempotencyKey}:${input.paymentReference}:${input.amountMinor}`)}`,
        status: "SUCCEEDED",
      };
    }
    const payload = await this.externalRequest("POST", "/v1/refunds", {
      idempotencyKey: input.idempotencyKey,
      paymentReference: input.paymentReference,
      amountMinor: input.amountMinor,
      currency: input.currency,
      ...(input.reason ? { reason: input.reason } : {}),
    }, input.idempotencyKey);
    const reference = this.requiredText(payload.reference, "Payment gateway refund reference");
    const status = payload.status;
    if (status !== "PENDING" && status !== "SUCCEEDED" && status !== "FAILED") throw new BadGatewayException("Payment gateway returned an unsupported refund status.");
    return { gateway: "EXTERNAL_PSP", reference, status };
  }

  async payout(input: {
    idempotencyKey: string;
    providerId: string;
    amountMinor: number;
    currency: string;
  }): Promise<GatewayPayoutResult> {
    if (this.provider() === "mock") {
      return {
        gateway: "MOCK_PSP",
        reference: `mock_po_${this.digest(`${input.idempotencyKey}:${input.providerId}:${input.amountMinor}`)}`,
        status: "PAID",
      };
    }
    const payload = await this.externalRequest("POST", "/v1/payouts", input, input.idempotencyKey);
    const reference = this.requiredText(payload.reference, "Payment gateway payout reference");
    const status = payload.status;
    if (status !== "PENDING" && status !== "PROCESSING" && status !== "PAID" && status !== "FAILED" && status !== "CANCELLED") {
      throw new BadGatewayException("Payment gateway returned an unsupported payout status.");
    }
    return { gateway: "EXTERNAL_PSP", reference, status };
  }

  private parsePaymentResult(payload: Record<string, unknown>): GatewayPaymentResult {
    const reference = this.requiredText(payload.reference, "Payment gateway intent reference");
    const status = payload.status;
    if (status !== "REQUIRES_ACTION" && status !== "PROCESSING" && status !== "SUCCEEDED" && status !== "FAILED" && status !== "CANCELLED") {
      throw new BadGatewayException("Payment gateway returned an unsupported payment status.");
    }
    const actionUrl = typeof payload.actionUrl === "string" && payload.actionUrl.trim() ? payload.actionUrl.trim() : undefined;
    if (actionUrl && process.env.NODE_ENV === "production") {
      let url: URL;
      try { url = new URL(actionUrl); } catch { throw new BadGatewayException("Payment gateway returned an invalid hosted action URL."); }
      if (url.protocol !== "https:") throw new BadGatewayException("Production hosted payment actions require HTTPS.");
    }
    const failureCode = typeof payload.failureCode === "string" ? payload.failureCode.slice(0, 120) : undefined;
    return { gateway: "EXTERNAL_PSP", reference, status, ...(actionUrl ? { actionUrl } : {}), ...(failureCode ? { failureCode } : {}) };
  }

  private provider(): "mock" | "external" {
    const provider = process.env.PAYMENT_GATEWAY_PROVIDER ?? (process.env.NODE_ENV === "production" ? "external" : "mock");
    if (provider !== "mock" && provider !== "external") throw new InternalServerErrorException(`Unsupported PAYMENT_GATEWAY_PROVIDER '${provider}'.`);
    if (process.env.NODE_ENV === "production" && provider === "mock") throw new InternalServerErrorException("Mock payments are forbidden in production.");
    return provider;
  }

  private async externalRequest(method: "GET" | "POST", path: string, body?: Record<string, unknown>, idempotencyKey?: string): Promise<Record<string, unknown>> {
    const base = this.baseUrl();
    const apiKey = await this.secrets.resolve("payment-gateway-api-key");
    const response = await fetch(new URL(path.replace(/^\//, ""), base), {
      method,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${apiKey}`,
        ...(body ? { "content-type": "application/json" } : {}),
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new BadGatewayException(`External payment gateway request failed with HTTP ${response.status}.`);
    }
    return payload as Record<string, unknown>;
  }

  private baseUrl(): string {
    const value = process.env.PAYMENT_GATEWAY_BASE_URL?.trim();
    if (!value) throw new InternalServerErrorException("PAYMENT_GATEWAY_BASE_URL is required for external payments.");
    let url: URL;
    try { url = new URL(value.endsWith("/") ? value : `${value}/`); } catch { throw new InternalServerErrorException("PAYMENT_GATEWAY_BASE_URL is invalid."); }
    if (process.env.NODE_ENV === "production" && url.protocol !== "https:") throw new InternalServerErrorException("Production payment gateways require HTTPS.");
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new BadRequestException("Unsupported payment gateway URL protocol.");
    return url.toString();
  }

  private requiredText(value: unknown, label: string): string {
    if (typeof value !== "string" || !value.trim()) throw new BadGatewayException(`${label} is missing.`);
    return value.trim().slice(0, 300);
  }

  private digest(value: string): string {
    return createHash("sha256").update(value).digest("hex").slice(0, 24);
  }
}
