import "dotenv/config";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { assertProductionProviderResponsePolicyReady } from "./infrastructure/http/bounded-provider-response";
import { browserOrigins } from "./infrastructure/http/browser-origin-readiness";
import { assertProductionFinancialGatewayEgressReady } from "./infrastructure/http/financial-gateway-egress";
import { assertProductionInboundBodyLimitsReady, inboundBodyLimits } from "./infrastructure/http/inbound-body-limits";
import { assertProductionTelehealthReady } from "./infrastructure/http/livekit-endpoint";
import {
  createLiveKitWebhookRawBodyMiddleware,
  LIVEKIT_WEBHOOK_PATH,
} from "./infrastructure/http/livekit-webhook-raw-body";
import { assertProductionNotificationGatewayEgressReady } from "./infrastructure/http/notification-gateway-egress";
import { assertProductionPaymentActionPolicyReady } from "./infrastructure/http/payment-action-url-policy";
import { assertProductionOtlpReady } from "./infrastructure/observability/production-otel-preflight";
import { assertProductionDatabaseReady } from "./infrastructure/prisma/production-database-preflight";
import { assertProductionRedisReady } from "./infrastructure/redis/production-redis-preflight";
import { assertProductionExternalSecretsReady } from "./infrastructure/secrets/production-external-secrets-preflight";
import { assertProductionKmsReady } from "./infrastructure/security/production-kms-preflight";
import { assertProductionKmsRotationReady } from "./infrastructure/security/production-kms-rotation-preflight";
import { assertProductionObjectStorageReady } from "./infrastructure/security/production-object-storage-preflight";
import { assertProductionSiemReady } from "./infrastructure/siem/production-siem-preflight";
import { assertProductionEmergencyAmbulanceReady } from "./modules/emergency/emergency-launch-policy";
import { assertProductionSmartPublicEndpointsReady } from "./security/production-smart-public-endpoints-preflight";

async function bootstrap(): Promise<void> {
  await assertProductionKmsReady();
  await assertProductionKmsRotationReady();
  await assertProductionExternalSecretsReady();
  assertProductionFinancialGatewayEgressReady();
  assertProductionProviderResponsePolicyReady();
  assertProductionNotificationGatewayEgressReady();
  assertProductionPaymentActionPolicyReady();
  assertProductionInboundBodyLimitsReady();
  const bodyLimits = inboundBodyLimits();
  assertProductionTelehealthReady();
  assertProductionEmergencyAmbulanceReady();
  assertProductionSmartPublicEndpointsReady();
  const origins = browserOrigins(process.env);
  await assertProductionObjectStorageReady();
  await assertProductionDatabaseReady();
  await assertProductionRedisReady();
  await assertProductionOtlpReady();
  assertProductionSiemReady();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { cors: false, bodyParser: false });

  app.disable("x-powered-by");
  if (process.env.TRUST_PROXY === "true") app.set("trust proxy", 1);
  app.use(helmet({
    strictTransportSecurity: process.env.NODE_ENV === "production"
      ? { maxAge: 31_536_000, includeSubDomains: true, preload: true }
      : false,
    referrerPolicy: { policy: "no-referrer" },
  }));
  app.use(LIVEKIT_WEBHOOK_PATH, createLiveKitWebhookRawBodyMiddleware());
  app.useBodyParser("json", { limit: bodyLimits.jsonBytes });
  app.useBodyParser("urlencoded", { limit: bodyLimits.formBytes, extended: true });
  app.enableCors({
    origin: origins,
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "Idempotency-Key", "X-Request-Id", "traceparent"],
  });
  app.setGlobalPrefix("api/v1");
  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port, "0.0.0.0");
}

void bootstrap();
