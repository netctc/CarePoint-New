import "dotenv/config";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { assertProductionKmsReady } from "./infrastructure/security/production-kms-preflight";
import { assertProductionObjectStorageReady } from "./infrastructure/security/production-object-storage-preflight";

async function bootstrap(): Promise<void> {
  await assertProductionKmsReady();
  await assertProductionObjectStorageReady();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { cors: false, rawBody: true });
  const configuredOrigins = process.env.ALLOWED_ORIGINS?.trim();
  if (process.env.NODE_ENV === "production" && !configuredOrigins) {
    throw new Error("ALLOWED_ORIGINS is required in production.");
  }
  const origins = (configuredOrigins || "http://localhost:3000")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  app.disable("x-powered-by");
  if (process.env.TRUST_PROXY === "true") app.set("trust proxy", 1);
  app.use(helmet({
    strictTransportSecurity: process.env.NODE_ENV === "production"
      ? { maxAge: 31_536_000, includeSubDomains: true, preload: true }
      : false,
    referrerPolicy: { policy: "no-referrer" },
  }));
  app.useBodyParser("json", { limit: Number(process.env.JSON_BODY_LIMIT_BYTES ?? 1_048_576) });
  app.useBodyParser("urlencoded", { limit: Number(process.env.FORM_BODY_LIMIT_BYTES ?? 131_072), extended: true });
  app.enableCors({
    origin: origins,
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "Idempotency-Key", "X-Request-Id"],
  });
  app.setGlobalPrefix("api/v1");
  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port, "0.0.0.0");
}

void bootstrap();
