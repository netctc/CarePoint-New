import { Injectable, InternalServerErrorException } from "@nestjs/common";
import { AccessToken, WebhookReceiver } from "livekit-server-sdk";
import { createHmac } from "node:crypto";
import { ExternalSecretResolverService } from "../../infrastructure/secrets/external-secret-resolver.service";

export interface TelehealthJoinTokenInput {
  roomName: string;
  participantIdentity: string;
  participantRole: "PATIENT" | "PROVIDER";
  ttlSeconds: number;
}

export interface TelehealthJoinTokenResult {
  serverUrl: string;
  participantToken: string;
  expiresAt: Date;
}

export interface TelehealthWebhookEvent {
  event: string;
  roomName: string | null;
  participantIdentity: string | null;
}

@Injectable()
export class TelehealthProviderService {
  constructor(private readonly secrets: ExternalSecretResolverService = new ExternalSecretResolverService()) {}

  async issueJoinToken(input: TelehealthJoinTokenInput): Promise<TelehealthJoinTokenResult> {
    const mode = this.mode();
    const expiresAt = new Date(Date.now() + input.ttlSeconds * 1000);
    if (mode === "mock") {
      const secret = this.mockSigningSecret();
      const payload = `${input.roomName}.${input.participantIdentity}.${expiresAt.getTime()}`;
      const signature = createHmac("sha256", secret).update(payload).digest("base64url");
      return {
        serverUrl: process.env.LIVEKIT_URL ?? "ws://127.0.0.1:7880",
        participantToken: `mock.${Buffer.from(payload).toString("base64url")}.${signature}`,
        expiresAt,
      };
    }

    const { url, apiKey, apiSecret } = await this.liveKitConfiguration();
    const token = new AccessToken(apiKey, apiSecret, {
      identity: input.participantIdentity,
      ttl: input.ttlSeconds,
      attributes: { carepointRole: input.participantRole },
    });
    token.addGrant({
      roomJoin: true,
      room: input.roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });
    return { serverUrl: url, participantToken: await token.toJwt(), expiresAt };
  }

  async verifyWebhook(rawBody: string, authorization?: string): Promise<TelehealthWebhookEvent> {
    const mode = this.mode();
    if (mode === "mock") {
      let value: unknown;
      try { value = JSON.parse(rawBody); } catch { throw new InternalServerErrorException("Mock telehealth webhook payload is invalid JSON."); }
      const event = value as { event?: unknown; room?: { name?: unknown }; participant?: { identity?: unknown } };
      return {
        event: typeof event.event === "string" ? event.event : "",
        roomName: typeof event.room?.name === "string" ? event.room.name : null,
        participantIdentity: typeof event.participant?.identity === "string" ? event.participant.identity : null,
      };
    }

    const { apiKey, apiSecret } = await this.liveKitConfiguration();
    const receiver = new WebhookReceiver(apiKey, apiSecret);
    const event = await receiver.receive(rawBody, authorization);
    const narrowed = event as unknown as { event?: string; room?: { name?: string }; participant?: { identity?: string } };
    return {
      event: narrowed.event ?? "",
      roomName: narrowed.room?.name ?? null,
      participantIdentity: narrowed.participant?.identity ?? null,
    };
  }

  private mode(): "livekit" | "mock" {
    const configured = (process.env.TELEHEALTH_PROVIDER ?? (process.env.NODE_ENV === "production" ? "" : "mock")).trim().toLowerCase();
    if (configured === "livekit") return "livekit";
    if (configured === "mock" && process.env.NODE_ENV !== "production") return "mock";
    throw new InternalServerErrorException("Production telehealth requires TELEHEALTH_PROVIDER=livekit and server-side LiveKit credentials.");
  }

  private mockSigningSecret(): string {
    const secret = process.env.TELEHEALTH_MOCK_SIGNING_SECRET?.trim();
    if (!secret || secret.length < 32) {
      throw new InternalServerErrorException("TELEHEALTH_MOCK_SIGNING_SECRET must contain at least 32 characters when the mock telehealth provider is enabled.");
    }
    return secret;
  }

  private async liveKitConfiguration(): Promise<{ url: string; apiKey: string; apiSecret: string }> {
    const url = process.env.LIVEKIT_URL?.trim();
    if (!url) throw new InternalServerErrorException("LiveKit server URL is missing.");
    const apiKey = await this.secrets.resolve("livekit-api-key");
    const apiSecret = await this.secrets.resolve("livekit-api-secret");
    return { url, apiKey, apiSecret };
  }
}
