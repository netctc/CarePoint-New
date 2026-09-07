import { BadGatewayException, BadRequestException, Injectable, InternalServerErrorException } from "@nestjs/common";
import { createHash } from "node:crypto";

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
    const apiKey = process.env.NOTIFICATION_GATEWAY_API_KEY?.trim();
    if (!apiKey) throw new InternalServerErrorException("NOTIFICATION_GATEWAY_API_KEY is required for external notification delivery.");
    const response = await fetch(new URL("v1/notifications", this.baseUrl()), {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "idempotency-key": `${input.notificationId}:${input.channel}`,
      },
      body: JSON.stringify(input),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new BadGatewayException(`External notification delivery failed with HTTP ${response.status}.`);
    }
    return payload as Record<string, unknown>;
  }

  private baseUrl(): string {
    const value = process.env.NOTIFICATION_GATEWAY_BASE_URL?.trim();
    if (!value) throw new InternalServerErrorException("NOTIFICATION_GATEWAY_BASE_URL is required for external notification delivery.");
    let url: URL;
    try { url = new URL(value.endsWith("/") ? value : `${value}/`); } catch { throw new InternalServerErrorException("NOTIFICATION_GATEWAY_BASE_URL is invalid."); }
    if (process.env.NODE_ENV === "production" && url.protocol !== "https:") throw new InternalServerErrorException("Production notification gateways require HTTPS.");
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new BadRequestException("Unsupported notification gateway URL protocol.");
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
