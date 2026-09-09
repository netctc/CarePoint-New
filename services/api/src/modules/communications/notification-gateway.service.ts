import { BadGatewayException, BadRequestException, Injectable, InternalServerErrorException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { discardProviderResponseBody, readBoundedProviderJsonObject } from "../../infrastructure/http/bounded-provider-response";
import { ExternalSecretResolverService } from "../../infrastructure/secrets/external-secret-resolver.service";

type ExternalNotificationChannel = "PUSH" | "EMAIL" | "SMS";

export interface NotificationGatewayInput {
  notificationId: string;
  channel: ExternalNotificationChannel;
  destinationRef: string;
  locale: string;
  safeTitleKey: string;
  safeBodyKey: string;
  entityType: string;
  entityId: string;
}

@Injectable()
export class NotificationGatewayService {
  constructor(private readonly secrets: ExternalSecretResolverService = new ExternalSecretResolverService()) {}

  assertProductionReady(): void {
    if (this.provider() !== "external") return;
    this.baseUrl();
    this.timeoutMs();
  }

  async send(input: NotificationGatewayInput): Promise<{ provider: string; reference: string }> {
    this.validateSafeInput(input);
    if (this.provider() === "mock") {
      return {
        provider: "MOCK_NOTIFICATION",
        reference: `mock_nt_${createHash("sha256").update(`${input.notificationId}:${input.channel}:${input.destinationRef}`).digest("hex").slice(0, 24)}`,
      };
    }
    const payload = await this.externalRequest(input);
    const reference = payload.reference;
    if (typeof reference !== "string" || !reference.trim()) throw new BadGatewayException("Notification provider returned no delivery reference.");
    return { provider: "EXTERNAL_NOTIFICATION", reference: reference.trim().slice(0, 300) };
  }

  private provider(): "mock" | "external" {
    const provider = process.env.NOTIFICATION_GATEWAY_PROVIDER ?? (process.env.NODE_ENV === "production" ? "external" : "mock");
    if (provider !== "mock" && provider !== "external") throw new InternalServerErrorException(`Unsupported NOTIFICATION_GATEWAY_PROVIDER '${provider}'.`);
    if (process.env.NODE_ENV === "production" && provider === "mock") throw new InternalServerErrorException("Mock notifications are forbidden in production.");
    return provider;
  }

  private async externalRequest(input: NotificationGatewayInput): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await fetch(new URL("v1/notifications", this.baseUrl()), {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${await this.secrets.resolve("notification-gateway-api-key")}`,
          "content-type": "application/json",
          "idempotency-key": `${input.notificationId}:${input.channel}`,
        },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(this.timeoutMs()),
      });
    } catch {
      throw new BadGatewayException("External notification delivery transport failed.");
    }
    if (!response.ok) {
      await discardProviderResponseBody(response);
      throw new BadGatewayException(`External notification delivery failed with HTTP ${response.status}.`);
    }
    try {
      return await readBoundedProviderJsonObject(response);
    } catch {
      throw new BadGatewayException("External notification provider returned an invalid response.");
    }
  }

  private timeoutMs(): number {
    const raw = process.env.NOTIFICATION_GATEWAY_TIMEOUT_MS?.trim() || "10000";
    if (!/^\d+$/.test(raw)) throw new InternalServerErrorException("NOTIFICATION_GATEWAY_TIMEOUT_MS must be an integer.");
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 100 || value > 30_000) {
      throw new InternalServerErrorException("NOTIFICATION_GATEWAY_TIMEOUT_MS must be between 100 and 30000.");
    }
    return value;
  }

  private baseUrl(): string {
    const value = process.env.NOTIFICATION_GATEWAY_BASE_URL?.trim();
    if (!value) throw new InternalServerErrorException("NOTIFICATION_GATEWAY_BASE_URL is required for external notification delivery.");
    let url: URL;
    try { url = new URL(value.endsWith("/") ? value : `${value}/`); } catch { throw new InternalServerErrorException("NOTIFICATION_GATEWAY_BASE_URL is invalid."); }
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new BadRequestException("Unsupported notification gateway URL protocol.");
    if (url.username || url.password) throw new InternalServerErrorException("Notification gateway URLs must not embed credentials.");
    if (process.env.NODE_ENV === "production") {
      if (url.protocol !== "https:") throw new InternalServerErrorException("Production notification gateways require HTTPS.");
      const host = url.hostname.toLowerCase();
      if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
        throw new InternalServerErrorException("Production notification gateways must not target loopback hosts.");
      }
    }
    return url.toString();
  }

  private validateSafeInput(input: NotificationGatewayInput): void {
    if (!input.notificationId?.trim() || !input.destinationRef?.trim()) throw new BadRequestException("Notification delivery identifiers are required.");
    if (!["PUSH", "EMAIL", "SMS"].includes(input.channel)) throw new BadRequestException("Unsupported external notification channel.");
    for (const [label, value] of Object.entries({ safeTitleKey: input.safeTitleKey, safeBodyKey: input.safeBodyKey, entityType: input.entityType, entityId: input.entityId })) {
      if (typeof value !== "string" || !value.trim() || value.length > 200) throw new BadRequestException(`${label} is invalid.`);
    }
    const prohibited = /patient|diagnos|prescription|claim|message body|clinical note|medication/i;
    if (prohibited.test(`${input.safeTitleKey} ${input.safeBodyKey}`)) {
      throw new BadRequestException("External notifications must use PHI-neutral template keys.");
    }
  }
}
