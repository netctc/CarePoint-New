import { BadGatewayException, BadRequestException, Injectable, InternalServerErrorException } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { InsuranceClaimStatus } from "@carepoint/contracts";
import { ExternalSecretResolverService } from "../../infrastructure/secrets/external-secret-resolver.service";

export interface GatewayClaimResult {
  gateway: string;
  reference: string;
  status: InsuranceClaimStatus;
  eobReference?: string;
  allowedMinor?: number;
  insurerPaidMinor?: number;
  patientResponsibilityMinor?: number;
  adjustmentMinor?: number;
  denialCode?: string;
  denialPublicMessage?: string;
  remittanceReference?: string;
}

@Injectable()
export class ClaimsGatewayService {
  constructor(private readonly secrets: ExternalSecretResolverService = new ExternalSecretResolverService()) {}

  name(): string {
    return this.provider() === "mock" ? "MOCK_CLAIMS" : "EXTERNAL_CLAIMS";
  }

  async submitClaim(input: {
    idempotencyKey: string;
    payerCode: string;
    externalPolicyRef: string;
    appointmentId: string;
    invoiceId: string;
    serviceId: string;
    submittedAmountMinor: number;
    currency: string;
    previousClaimReference?: string;
  }): Promise<GatewayClaimResult> {
    if (this.provider() === "mock") {
      const prefix = input.previousClaimReference ? "mock_clm_rw_" : "mock_clm_";
      return {
        gateway: "MOCK_CLAIMS",
        reference: `${prefix}${this.digest(`${input.idempotencyKey}:${input.invoiceId}`)}`,
        status: "SUBMITTED",
      };
    }
    const payload = await this.externalRequest("/v1/claims", input, input.idempotencyKey);
    return this.parseClaimResult(payload, "Claim submission");
  }

  async refreshClaim(input: {
    idempotencyKey: string;
    payerCode: string;
    claimReference: string;
    currentStatus: InsuranceClaimStatus;
    submittedAmountMinor: number;
    currency: string;
  }): Promise<GatewayClaimResult> {
    if (this.provider() === "mock") return this.mockRefresh(input);
    const payload = await this.externalRequest(`/v1/claims/${encodeURIComponent(input.claimReference)}/status`, input, input.idempotencyKey);
    return this.parseClaimResult(payload, "Claim status");
  }

  private mockRefresh(input: {
    idempotencyKey: string;
    payerCode: string;
    claimReference: string;
    currentStatus: InsuranceClaimStatus;
    submittedAmountMinor: number;
    currency: string;
  }): GatewayClaimResult {
    const threshold = Number(process.env.CLAIMS_MOCK_DENIAL_THRESHOLD_MINOR ?? "100000");
    const correctedRework = input.claimReference.startsWith("mock_clm_rw_");
    if (!correctedRework && Number.isFinite(threshold) && input.submittedAmountMinor > threshold) {
      return {
        gateway: "MOCK_CLAIMS",
        reference: input.claimReference,
        status: "DENIED",
        eobReference: `mock_eob_${this.digest(input.claimReference)}`,
        allowedMinor: 0,
        insurerPaidMinor: 0,
        patientResponsibilityMinor: 0,
        adjustmentMinor: input.submittedAmountMinor,
        denialCode: "MOCK_REVIEW_REQUIRED",
        denialPublicMessage: "The payer requires a corrected claim before payment can be considered.",
      };
    }

    const insurerPaidMinor = Math.floor(input.submittedAmountMinor * 0.7);
    const patientResponsibilityMinor = input.submittedAmountMinor - insurerPaidMinor;
    if (input.currentStatus === "ADJUDICATED") {
      return {
        gateway: "MOCK_CLAIMS",
        reference: input.claimReference,
        status: "PAID",
        eobReference: `mock_eob_${this.digest(input.claimReference)}`,
        allowedMinor: input.submittedAmountMinor,
        insurerPaidMinor,
        patientResponsibilityMinor,
        adjustmentMinor: 0,
        remittanceReference: `mock_era_${this.digest(`${input.claimReference}:paid`)}`,
      };
    }

    return {
      gateway: "MOCK_CLAIMS",
      reference: input.claimReference,
      status: "ADJUDICATED",
      eobReference: `mock_eob_${this.digest(input.claimReference)}`,
      allowedMinor: input.submittedAmountMinor,
      insurerPaidMinor,
      patientResponsibilityMinor,
      adjustmentMinor: 0,
    };
  }

  private parseClaimResult(payload: Record<string, unknown>, label: string): GatewayClaimResult {
    const reference = this.requiredText(payload.reference, `${label} reference`, 300);
    const status = this.status(payload.status);
    const eobReference = this.optionalText(payload.eobReference, 300);
    const allowedMinor = this.optionalMoney(payload.allowedMinor, "allowedMinor");
    const insurerPaidMinor = this.optionalMoney(payload.insurerPaidMinor, "insurerPaidMinor");
    const patientResponsibilityMinor = this.optionalMoney(payload.patientResponsibilityMinor, "patientResponsibilityMinor");
    const adjustmentMinor = this.optionalMoney(payload.adjustmentMinor, "adjustmentMinor");
    const denialCode = this.optionalText(payload.denialCode, 80);
    const denialPublicMessage = this.optionalText(payload.denialPublicMessage, 300);
    const remittanceReference = this.optionalText(payload.remittanceReference, 300);
    if (status === "ADJUDICATED" || status === "DENIED" || status === "PAID") {
      if (allowedMinor === undefined || insurerPaidMinor === undefined || patientResponsibilityMinor === undefined || adjustmentMinor === undefined || !eobReference) {
        throw new BadGatewayException("Adjudicated claim responses must include normalized EOB amounts and an EOB reference.");
      }
      if (insurerPaidMinor + patientResponsibilityMinor !== allowedMinor) {
        throw new BadGatewayException("Claim gateway returned inconsistent adjudication amounts.");
      }
    }
    if (status === "PAID" && !remittanceReference) throw new BadGatewayException("Paid claim responses must include a remittance reference.");
    return {
      gateway: "EXTERNAL_CLAIMS",
      reference,
      status,
      ...(eobReference ? { eobReference } : {}),
      ...(allowedMinor !== undefined ? { allowedMinor } : {}),
      ...(insurerPaidMinor !== undefined ? { insurerPaidMinor } : {}),
      ...(patientResponsibilityMinor !== undefined ? { patientResponsibilityMinor } : {}),
      ...(adjustmentMinor !== undefined ? { adjustmentMinor } : {}),
      ...(denialCode ? { denialCode } : {}),
      ...(denialPublicMessage ? { denialPublicMessage } : {}),
      ...(remittanceReference ? { remittanceReference } : {}),
    };
  }

  private async externalRequest(path: string, body: Record<string, unknown>, idempotencyKey: string): Promise<Record<string, unknown>> {
    const apiKey = await this.secrets.resolve("claims-gateway-api-key");
    const response = await fetch(new URL(path.replace(/^\//, ""), this.baseUrl()), {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new BadGatewayException(`External claims gateway request failed with HTTP ${response.status}.`);
    }
    return payload as Record<string, unknown>;
  }

  private provider(): "mock" | "external" {
    const provider = process.env.CLAIMS_GATEWAY_PROVIDER ?? (process.env.NODE_ENV === "production" ? "external" : "mock");
    if (provider !== "mock" && provider !== "external") throw new InternalServerErrorException(`Unsupported CLAIMS_GATEWAY_PROVIDER '${provider}'.`);
    if (process.env.NODE_ENV === "production" && provider === "mock") throw new InternalServerErrorException("Mock claim processing is forbidden in production.");
    return provider;
  }

  private baseUrl(): string {
    const value = process.env.CLAIMS_GATEWAY_BASE_URL?.trim();
    if (!value) throw new InternalServerErrorException("CLAIMS_GATEWAY_BASE_URL is required for external claim operations.");
    let url: URL;
    try { url = new URL(value.endsWith("/") ? value : `${value}/`); } catch { throw new InternalServerErrorException("CLAIMS_GATEWAY_BASE_URL is invalid."); }
    if (process.env.NODE_ENV === "production" && url.protocol !== "https:") throw new InternalServerErrorException("Production claims gateways require HTTPS.");
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new BadRequestException("Unsupported claims gateway URL protocol.");
    return url.toString();
  }

  private status(value: unknown): InsuranceClaimStatus {
    if (value === "SUBMITTED" || value === "ACCEPTED" || value === "PENDING" || value === "ADJUDICATED" || value === "DENIED" || value === "PAID" || value === "VOID") return value;
    throw new BadGatewayException("Claims gateway returned an unsupported claim status.");
  }

  private requiredText(value: unknown, label: string, max: number): string {
    if (typeof value !== "string" || !value.trim()) throw new BadGatewayException(`${label} is missing.`);
    return value.trim().slice(0, max);
  }

  private optionalText(value: unknown, max: number): string | undefined {
    if (value === undefined || value === null || value === "") return undefined;
    if (typeof value !== "string") throw new BadGatewayException("Claims gateway returned an invalid text field.");
    const text = value.trim();
    return text ? text.slice(0, max) : undefined;
  }

  private optionalMoney(value: unknown, field: string): number | undefined {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throw new BadGatewayException(`Claims gateway returned invalid ${field}.`);
    return value;
  }

  private digest(value: string): string {
    return createHash("sha256").update(value).digest("hex").slice(0, 24);
  }
}
