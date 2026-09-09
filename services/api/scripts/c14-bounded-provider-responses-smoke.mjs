import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  assertProductionProviderResponsePolicyReady,
  externalProviderMaxResponseBytes,
  readBoundedProviderJsonObject,
} = require("../dist/infrastructure/http/bounded-provider-response.js");
const { PaymentGatewayService } = require("../dist/modules/billing/payment-gateway.service.js");
const { InsuranceGatewayService } = require("../dist/modules/billing/insurance-gateway.service.js");
const { ClaimsGatewayService } = require("../dist/modules/claims/claims-gateway.service.js");
const { NotificationGatewayService } = require("../dist/modules/communications/notification-gateway.service.js");

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

function replaceProcessEnv(env) {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, env);
}

function productionEnv(overrides = {}) {
  return {
    NODE_ENV: "production",
    EXTERNAL_PROVIDER_MAX_RESPONSE_BYTES: "4096",
    PAYMENT_GATEWAY_PROVIDER: "external",
    PAYMENT_GATEWAY_BASE_URL: "https://payments.example.test/api/",
    PAYMENT_GATEWAY_TIMEOUT_MS: "5000",
    INSURANCE_GATEWAY_PROVIDER: "external",
    INSURANCE_GATEWAY_BASE_URL: "https://insurance.example.test/api/",
    INSURANCE_GATEWAY_TIMEOUT_MS: "6000",
    CLAIMS_GATEWAY_PROVIDER: "external",
    CLAIMS_GATEWAY_BASE_URL: "https://claims.example.test/api/",
    CLAIMS_GATEWAY_TIMEOUT_MS: "7000",
    NOTIFICATION_GATEWAY_PROVIDER: "external",
    NOTIFICATION_GATEWAY_BASE_URL: "https://notifications.example.test/api/",
    NOTIFICATION_GATEWAY_TIMEOUT_MS: "8000",
    ...overrides,
  };
}

function jsonResponse(payload, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json", ...headers },
  });
}

async function expectRejected(promise, pattern) {
  try {
    await promise;
    assert.fail("expected promise rejection");
  } catch (error) {
    assert.match(String(error), pattern);
    return String(error);
  }
}

try {
  assert.equal(externalProviderMaxResponseBytes({ NODE_ENV: "test" }), 65_536);
  assert.equal(externalProviderMaxResponseBytes(productionEnv()), 4_096);
  assert.doesNotThrow(() => assertProductionProviderResponsePolicyReady(productionEnv()));
  assert.throws(
    () => assertProductionProviderResponsePolicyReady({ NODE_ENV: "production" }),
    /EXTERNAL_PROVIDER_MAX_RESPONSE_BYTES is required in production/,
  );
  assert.throws(
    () => externalProviderMaxResponseBytes(productionEnv({ EXTERNAL_PROVIDER_MAX_RESPONSE_BYTES: "4095" })),
    /between 4096 and 1048576/,
  );
  assert.throws(
    () => externalProviderMaxResponseBytes(productionEnv({ EXTERNAL_PROVIDER_MAX_RESPONSE_BYTES: "1048577" })),
    /between 4096 and 1048576/,
  );
  assert.throws(
    () => externalProviderMaxResponseBytes(productionEnv({ EXTERNAL_PROVIDER_MAX_RESPONSE_BYTES: "64kb" })),
    /must be an integer/,
  );

  const valid = await readBoundedProviderJsonObject(
    new Response('{"status":"ok"}', { headers: { "content-type": "application/json; charset=utf-8" } }),
    productionEnv(),
  );
  assert.equal(valid.status, "ok");

  const problem = await readBoundedProviderJsonObject(
    new Response('{"type":"bounded"}', { headers: { "content-type": "application/problem+json" } }),
    productionEnv(),
  );
  assert.equal(problem.type, "bounded");

  await expectRejected(
    readBoundedProviderJsonObject(new Response("<html></html>", { headers: { "content-type": "text/html" } }), productionEnv()),
    /Content-Type must be JSON/,
  );
  await expectRejected(
    readBoundedProviderJsonObject(new Response('{"ok":true}', { headers: { "content-type": "application/json", "content-length": "5000" } }), productionEnv()),
    /Content-Length exceeds the configured size limit/,
  );
  await expectRejected(
    readBoundedProviderJsonObject(new Response("not-json", { headers: { "content-type": "application/json" } }), productionEnv()),
    /not valid JSON/,
  );
  await expectRejected(
    readBoundedProviderJsonObject(new Response("[]", { headers: { "content-type": "application/json" } }), productionEnv()),
    /JSON must be an object/,
  );
  await expectRejected(
    readBoundedProviderJsonObject(new Response(new Uint8Array([0xff]), { headers: { "content-type": "application/json" } }), productionEnv()),
    /not valid UTF-8/,
  );

  const oversizedStream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(3_000));
      controller.enqueue(new Uint8Array(3_000));
      controller.close();
    },
  });
  await expectRejected(
    readBoundedProviderJsonObject(new Response(oversizedStream, { headers: { "content-type": "application/json" } }), productionEnv()),
    /body exceeds the configured size limit/,
  );

  replaceProcessEnv(productionEnv());
  const fakeSecrets = { resolve: async () => "c14-provider-secret" };
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const target = String(url);
    if (target.includes("payments")) return jsonResponse({ reference: "payment-ref", status: "SUCCEEDED" });
    if (target.includes("insurance")) return jsonResponse({ reference: "eligibility-ref", status: "ELIGIBLE" });
    if (target.includes("claims")) return jsonResponse({ reference: "claim-ref", status: "SUBMITTED" });
    return jsonResponse({ reference: "notification-ref" });
  };

  const payment = new PaymentGatewayService(fakeSecrets);
  const insurance = new InsuranceGatewayService(fakeSecrets);
  const claims = new ClaimsGatewayService(fakeSecrets);
  const notifications = new NotificationGatewayService(fakeSecrets);

  await payment.createIntent({ idempotencyKey: "c14-pay", amountMinor: 1000, currency: "SAR", reference: "invoice-c14" });
  await insurance.checkEligibility({ idempotencyKey: "c14-ins", payerCode: "C14", externalPolicyRef: "opaque-policy", appointmentId: "appointment-c14", serviceId: "service-c14", totalMinor: 1000, currency: "SAR" });
  await claims.submitClaim({ idempotencyKey: "c14-claim", payerCode: "C14", externalPolicyRef: "opaque-policy", appointmentId: "appointment-c14", invoiceId: "invoice-c14", serviceId: "service-c14", submittedAmountMinor: 1000, currency: "SAR" });
  await notifications.send({ notificationId: "notification-c14", channel: "PUSH", destinationRef: "opaque-destination", locale: "en", safeTitleKey: "delivery.ready.title", safeBodyKey: "delivery.ready.body", entityType: "APPOINTMENT", entityId: "appointment-c14" });
  assert.equal(calls.length, 4);

  globalThis.fetch = async () => new Response('{"providerDetail":"must-never-leak"}', {
    status: 200,
    headers: { "content-type": "application/json", "content-length": "5000" },
  });

  const paymentError = await expectRejected(payment.retrieveIntent("payment-ref"), /External payment gateway returned an invalid response/);
  const insuranceError = await expectRejected(
    insurance.checkEligibility({ idempotencyKey: "c14-ins-oversize", payerCode: "C14", externalPolicyRef: "opaque-policy", appointmentId: "appointment-c14", serviceId: "service-c14", totalMinor: 1000, currency: "SAR" }),
    /External insurance gateway returned an invalid response/,
  );
  const claimsError = await expectRejected(
    claims.submitClaim({ idempotencyKey: "c14-claim-oversize", payerCode: "C14", externalPolicyRef: "opaque-policy", appointmentId: "appointment-c14", invoiceId: "invoice-c14", serviceId: "service-c14", submittedAmountMinor: 1000, currency: "SAR" }),
    /External claims gateway returned an invalid response/,
  );
  const notificationError = await expectRejected(
    notifications.send({ notificationId: "notification-c14-oversize", channel: "EMAIL", destinationRef: "opaque-destination", locale: "en", safeTitleKey: "delivery.update.title", safeBodyKey: "delivery.update.body", entityType: "APPOINTMENT", entityId: "appointment-c14" }),
    /External notification provider returned an invalid response/,
  );
  for (const error of [paymentError, insuranceError, claimsError, notificationError]) {
    assert.doesNotMatch(error, /must-never-leak|providerDetail/);
  }

  globalThis.fetch = async () => new Response('{"secret":"must-not-be-reflected"}', {
    status: 502,
    headers: { "content-type": "application/json" },
  });
  const upstreamError = await expectRejected(payment.retrieveIntent("payment-ref"), /HTTP 502/);
  assert.doesNotMatch(upstreamError, /must-not-be-reflected|secret/);

  const mainSource = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  assert.ok(
    mainSource.indexOf("assertProductionProviderResponsePolicyReady();") < mainSource.indexOf("NestFactory.create"),
    "C14 provider response preflight must execute before Nest application creation",
  );

  for (const path of [
    "../src/modules/billing/payment-gateway.service.ts",
    "../src/modules/billing/insurance-gateway.service.ts",
    "../src/modules/claims/claims-gateway.service.ts",
    "../src/modules/communications/notification-gateway.service.ts",
  ]) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    assert.match(source, /readBoundedProviderJsonObject/, `${path} must use the bounded provider JSON reader`);
    assert.match(source, /discardProviderResponseBody/, `${path} must discard non-success provider bodies`);
    assert.doesNotMatch(source, /response\.json\s*\(/, `${path} must not use unbounded response.json()`);
  }

  const packageSource = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.ok(packageSource.scripts.test.includes("c14:bounded-provider-responses"));
  assert.equal(packageSource.dependencies["stream-json"], undefined, "C14 must not add a JSON streaming dependency");

  console.log("Phase C14 bounded provider responses acceptance passed");
} finally {
  globalThis.fetch = originalFetch;
  replaceProcessEnv(originalEnv);
}
