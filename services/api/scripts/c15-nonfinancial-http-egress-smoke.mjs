import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  assertProductionNotificationGatewayEgressReady,
  notificationGatewayTimeoutMs,
  validatedNotificationGatewayBaseUrl,
} = require("../dist/infrastructure/http/notification-gateway-egress.js");
const { otlpHttpConfiguration, sendOtlpJson } = require("../dist/infrastructure/observability/otlp-http-exporter.js");
const { NotificationGatewayService } = require("../dist/modules/communications/notification-gateway.service.js");

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

function replaceProcessEnv(env) {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, env);
}

function notificationProduction(overrides = {}) {
  return {
    NODE_ENV: "production",
    EXTERNAL_PROVIDER_MAX_RESPONSE_BYTES: "65536",
    NOTIFICATION_GATEWAY_PROVIDER: "external",
    NOTIFICATION_GATEWAY_BASE_URL: "https://notifications.example.test/api/",
    NOTIFICATION_GATEWAY_TIMEOUT_MS: "5000",
    ...overrides,
  };
}

function otlpProduction(overrides = {}) {
  return {
    NODE_ENV: "production",
    OTEL_EXPORTER_OTLP_ENDPOINT: "https://otel.example.test/root",
    OTEL_EXPORTER_OTLP_PROTOCOL: "http/json",
    OTEL_EXPORTER_OTLP_TIMEOUT: "5000",
    CAREPOINT_OTEL_EXPORT_MODE: "required",
    ...overrides,
  };
}

try {
  assert.doesNotThrow(() => assertProductionNotificationGatewayEgressReady({ NODE_ENV: "test" }));
  assert.doesNotThrow(() => assertProductionNotificationGatewayEgressReady(notificationProduction()));
  assert.equal(validatedNotificationGatewayBaseUrl(notificationProduction()), "https://notifications.example.test/api/");
  assert.equal(notificationGatewayTimeoutMs(notificationProduction()), 5000);
  assert.equal(notificationGatewayTimeoutMs({ NODE_ENV: "test" }), 10000);

  assert.throws(
    () => assertProductionNotificationGatewayEgressReady(notificationProduction({ NOTIFICATION_GATEWAY_PROVIDER: "" })),
    /NOTIFICATION_GATEWAY_PROVIDER=external is required in production/,
  );
  assert.throws(
    () => assertProductionNotificationGatewayEgressReady(notificationProduction({ NOTIFICATION_GATEWAY_TIMEOUT_MS: "" })),
    /NOTIFICATION_GATEWAY_TIMEOUT_MS is required in production/,
  );
  assert.throws(
    () => notificationGatewayTimeoutMs(notificationProduction({ NOTIFICATION_GATEWAY_TIMEOUT_MS: "99" })),
    /between 100 and 30000/,
  );
  assert.throws(
    () => notificationGatewayTimeoutMs(notificationProduction({ NOTIFICATION_GATEWAY_TIMEOUT_MS: "30001" })),
    /between 100 and 30000/,
  );
  assert.throws(
    () => validatedNotificationGatewayBaseUrl(notificationProduction({ NOTIFICATION_GATEWAY_BASE_URL: "http://notifications.example.test" })),
    /must use HTTPS in production/,
  );
  assert.throws(
    () => validatedNotificationGatewayBaseUrl(notificationProduction({ NOTIFICATION_GATEWAY_BASE_URL: "https://user:secret@notifications.example.test" })),
    /must not contain embedded credentials/,
  );
  assert.throws(
    () => validatedNotificationGatewayBaseUrl(notificationProduction({ NOTIFICATION_GATEWAY_BASE_URL: "https://notifications.example.test/api/#hidden" })),
    /must not contain a URL fragment/,
  );
  assert.throws(
    () => validatedNotificationGatewayBaseUrl(notificationProduction({ NOTIFICATION_GATEWAY_BASE_URL: "https://[::1]:9443" })),
    /must not target loopback/,
  );
  assert.throws(
    () => validatedNotificationGatewayBaseUrl(notificationProduction({ NOTIFICATION_GATEWAY_BASE_URL: "https://internal.localhost" })),
    /must not target loopback/,
  );

  replaceProcessEnv(notificationProduction());
  const notificationCalls = [];
  globalThis.fetch = async (url, init = {}) => {
    notificationCalls.push({ url: String(url), init });
    return new Response(JSON.stringify({ reference: "notification-c15-ref" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const notifications = new NotificationGatewayService({ resolve: async () => "c15-notification-secret" });
  const delivery = await notifications.send({
    notificationId: "notification-c15",
    channel: "PUSH",
    destinationRef: "opaque-destination",
    locale: "en",
    safeTitleKey: "delivery.ready.title",
    safeBodyKey: "delivery.ready.body",
    entityType: "APPOINTMENT",
    entityId: "appointment-c15",
  });
  assert.equal(delivery.reference, "notification-c15-ref");
  assert.equal(notificationCalls.length, 1);
  assert.equal(notificationCalls[0].init.redirect, "error", "notification redirects must be rejected");
  assert.ok(notificationCalls[0].init.signal instanceof AbortSignal, "notification fetch must carry a bounded AbortSignal");
  assert.equal(notificationCalls[0].init.signal.aborted, false);

  assert.doesNotThrow(() => otlpHttpConfiguration(otlpProduction()));
  assert.throws(
    () => otlpHttpConfiguration(otlpProduction({ OTEL_EXPORTER_OTLP_TIMEOUT: "" })),
    /requires OTEL_EXPORTER_OTLP_TIMEOUT or both signal-specific OTLP timeouts/,
  );
  assert.throws(
    () => otlpHttpConfiguration(otlpProduction({ OTEL_EXPORTER_OTLP_TIMEOUT: "99" })),
    /OTEL_EXPORTER_OTLP_TIMEOUT must be between 100 and 30000/,
  );
  assert.throws(
    () => otlpHttpConfiguration(otlpProduction({ OTEL_EXPORTER_OTLP_TIMEOUT: "30001" })),
    /OTEL_EXPORTER_OTLP_TIMEOUT must be between 100 and 30000/,
  );
  assert.throws(
    () => otlpHttpConfiguration(otlpProduction({ OTEL_EXPORTER_OTLP_ENDPOINT: "https://otel.example.test/root#hidden" })),
    /must not contain a URL fragment/,
  );

  let otlpCancelled = false;
  const otlpCalls = [];
  globalThis.fetch = async (url, init = {}) => {
    otlpCalls.push({ url: String(url), init });
    const stream = new ReadableStream({
      cancel() {
        otlpCancelled = true;
      },
    });
    return new Response(stream, { status: 200, headers: { "content-type": "application/json" } });
  };
  await sendOtlpJson("https://otel.example.test/v1/traces", { authorization: "Bearer opaque" }, 5000, { resourceSpans: [] });
  assert.equal(otlpCalls.length, 1);
  assert.equal(otlpCalls[0].init.redirect, "error", "OTLP redirects must be rejected");
  assert.ok(otlpCalls[0].init.signal instanceof AbortSignal, "OTLP fetch must carry an abort signal");
  assert.equal(otlpCancelled, true, "unused OTLP response body must be cancelled");

  const mainSource = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  assert.ok(
    mainSource.indexOf("assertProductionNotificationGatewayEgressReady();") < mainSource.indexOf("NestFactory.create"),
    "C15 notification egress preflight must execute before Nest application creation",
  );

  const notificationSource = await readFile(new URL("../src/modules/communications/notification-gateway.service.ts", import.meta.url), "utf8");
  assert.match(notificationSource, /redirect:\s*"error"/, "notification gateway must reject redirects");
  assert.match(notificationSource, /notificationGatewayTimeoutMs/, "notification gateway must use the shared bounded timeout policy");
  assert.match(notificationSource, /validatedNotificationGatewayBaseUrl/, "notification gateway must use the shared URL policy");

  const otlpSource = await readFile(new URL("../src/infrastructure/observability/otlp-http-exporter.ts", import.meta.url), "utf8");
  assert.match(otlpSource, /redirect:\s*"error"/, "OTLP exporter must reject redirects");
  assert.match(otlpSource, /response\.body\?\.cancel\(\)/, "OTLP exporter must cancel unused response bodies");
  assert.match(otlpSource, /boundedOtlpTimeout/, "OTLP exporter must use bounded timeouts");

  const packageSource = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.ok(packageSource.scripts.test.includes("c15:nonfinancial-http-egress"));
  assert.equal(packageSource.dependencies.undici, undefined, "C15 must not add a new HTTP dependency");

  console.log("Phase C15 nonfinancial HTTP egress resilience acceptance passed");
} finally {
  globalThis.fetch = originalFetch;
  replaceProcessEnv(originalEnv);
}
