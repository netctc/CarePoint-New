import { Injectable, OnModuleInit } from "@nestjs/common";
import { createHash, createPrivateKey, createPublicKey, createSign, generateKeyPairSync, randomUUID, type KeyObject } from "node:crypto";
import { SmartConfigurationService } from "../../security/smart-configuration.service";

interface IdTokenInput {
  userId: string;
  patientId: string;
  clientId: string;
  nonce: string;
  authTime: number;
  expiresInSeconds: number;
}

@Injectable()
export class SmartOidcService implements OnModuleInit {
  private privateKey!: KeyObject;
  private publicKey!: KeyObject;
  private keyId = "";

  constructor(private readonly config: SmartConfigurationService) {}

  onModuleInit(): void {
    const configured = process.env.SMART_OIDC_PRIVATE_KEY_PEM?.replace(/\\n/g, "\n").trim();
    const production = process.env.NODE_ENV === "production";
    if (production && !configured) throw new Error("SMART_OIDC_PRIVATE_KEY_PEM is required in production.");

    if (configured) {
      this.privateKey = createPrivateKey(configured);
      this.publicKey = createPublicKey(this.privateKey);
    } else {
      const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
      this.privateKey = pair.privateKey;
      this.publicKey = pair.publicKey;
    }

    if (this.privateKey.asymmetricKeyType !== "rsa") throw new Error("SMART OIDC signing key must be RSA for RS256.");
    this.keyId = process.env.SMART_OIDC_KEY_ID?.trim() || "carepoint-smart-rs256-v1";
    if (!/^[A-Za-z0-9._~-]{3,128}$/.test(this.keyId)) throw new Error("SMART_OIDC_KEY_ID is invalid.");
  }

  jwks(): Record<string, unknown> {
    const jwk = this.publicKey.export({ format: "jwk" }) as JsonWebKey;
    return { keys: [{ ...jwk, kid: this.keyId, use: "sig", alg: "RS256" }] };
  }

  signIdToken(input: IdTokenInput): string {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: "RS256", typ: "JWT", kid: this.keyId };
    const payload = {
      iss: this.config.issuerUrl(),
      sub: this.subject(input.clientId, input.userId),
      aud: input.clientId,
      exp: now + input.expiresInSeconds,
      iat: now,
      auth_time: input.authTime,
      nonce: input.nonce,
      jti: randomUUID(),
      fhirUser: `${this.config.fhirBaseUrl()}/Patient/${input.patientId}`,
    };
    const signingInput = `${this.encode(header)}.${this.encode(payload)}`;
    const signer = createSign("RSA-SHA256");
    signer.update(signingInput, "ascii");
    signer.end();
    const signature = signer.sign(this.privateKey).toString("base64url");
    return `${signingInput}.${signature}`;
  }

  private subject(clientId: string, userId: string): string {
    return createHash("sha256")
      .update(`${this.config.issuerUrl()}|${clientId}|${userId}`, "utf8")
      .digest("base64url");
  }

  private encode(value: unknown): string {
    return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  }
}
