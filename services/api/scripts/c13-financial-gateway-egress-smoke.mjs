import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  assertProductionFinancialGatewayEgressReady,
  financialGatewayTimeoutMs,
  validatedFinancialGatewayBaseUrl,
} = require("../dist/infrastructure/http/financial-gateway-egress.js");
const { PaymentGatewayService } = require("../dist/modules/billing/payment-gateway.service.js");
const { InsuranceGatewayService } = require("../dist/modules/billing/insurance-gateway.service.js");
const { ClaimsGatewayService } = require("../dist/modules/claims/claims-gateway.service.js");

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

function productionEnv(overrides = {}) {
  return {
    NODE_ENV: "production",
    EXTERNAL_PROVIDER_MAX_RESPONSE_BYTES: "65536",
    PAYMENT_GATEWAY_PROVIDER: "external",
    PAYMENT_GATEWAY_BASE_URL: "https://payments.example.test/api/",
    PAYMENT_GATEWAY_TIMEOUT_MS: "5000",
    INSURANCE_GATEWAY_PROVIDER: "external",
    INSURANCE_GATEWAY_BASE_URL: "https://insurance.example.test/api/",
    INSURANCE_GATEWAY_TIMEOUT_MS: "6000",
    CLAIMS_GATEWAY_PROVIDER: "external",
    CLAIMS_GATEWAY_BASE_URL: "https://claims.example.test/api/",
    CLAIMS_GATEWAY_TIMEOUT_MS: "7000",
    ...overrides,
  };
}

function replaceProcessEnv(env) {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, env);
}

try {
  assert.doesNotThrow(() => assertProductionFinancialGatewayEgressReady({ NODE_ENV: "test" }));
  assert.doesNotThrow(() => assertProductionFinancialGatewayEgressReady(productionEnv()));
  assert.equal(financialGatewayTimeoutMs("PAYMENT_GATEWAY_TIMEOUT_MS", { NODE_ENV: "test" }), 10_000);
  assert.equal(financialGatewayTimeoutMs("PAYMENT_GATEWAY_TIMEOUT_MS", productionEnv()), 5_000);
  assert.equal(validatedFinancialGatewayBaseUrl("PAYMENT_GATEWAY_BASE_URL", productionEnv()), "https://payments.example.test/api/");

  assert.throws(
    () => assertProductionFinancialGatewayEgressReady(productionEnv({ PAYMENT_GATEWAY_PROVIDER: "mock" })),
    /PAYMENT_GATEWAY_PROVIDER=external is required in production/,
  );
  assert.throws(
    () => assertProductionFinancialGatewayEgressReady(productionEnv({ PAYMENT_GATEWAY_TIMEOUT_MS: "" })),
    /PAYMENT_GATEWAY_TIMEOUT_MS is required in production/,
  );
  assert.throws(
    () => assertProductionFinancialGatewayEgressReady(productionEnv({ INSURANCE_GATEWAY_TIMEOUT_MS: "99" })),
    /INSURANCE_GATEWAY_TIMEOUT_MS must be between 100 and 30000/,
  );
  assert.throws(
    () => assertProductionFinancialGatewayEgressReady(productionEnv({ CLAIMS_GATEWAY_TIMEOUT_MS: "30001" })),
    /CLAIMS_GATEWAY_TIMEOUT_MS must be between 100 and 30000/,
  );
  assert.throws(
    () => assertProductionFinancialGatewayEgressReady(productionEnv({ PAYMENT_GATEWAY_BASE_URL: "http://payments.example.test" })),
    /PAYMENT_GATEWAY_BASE_URL must use HTTPS in production/,
  );
  assert.throws(
    () => assertProductionFinancialGatewayEgressReady(productionEnv({ INSURANCE_GATEWAY_BASE_URL: "https://user:password@insurance.example.test" })),
    /INSURANCE_GATEWAY_BASE_URL must not contain embedded credentials/,
  );
  assert.throws(
    () => assertProductionFinancialGatewayEgressReady(productionEnv({ CLAIMS_GATEWAY_BASE_URL: "https://127.0.0.1:9443" })),
    /CLAIMS_GATEWAY_BASE_URL must not target loopback in production/,
  );
  assert.throws(
    () => assertProductionFinancialGatewayEgressReady(productionEnv({ CLAIMS_GATEWAY_BASE_URL: "https://claims.example.test/api/#secret-fragment" })),
    /CLAIMS_GATEWAY_BASE_URL must not contain a URL fragment/,
  );

  replaceProcessEnv(productionEnv());
  const fakeSecrets = { resolve: async () => "c13-provider-secret" };
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const target = String(url);
    if (target.includes("payments")) return new Response(JSON.stringify({ reference: "payment-ref", status: "SUCCEEDED" }), { status: 200, headers: { "content-type": "application/json" } });
    if (target.includes("insurance")) return new Response(JSON.stringify({ reference: "eligibility-ref", status: "ELIGIBLE" }), { status: 200, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify({ reference: "claim-ref", status: "SUBMITTED" }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const payment = new PaymentGatewayService(fakeSecrets);
  const insurance = new InsuranceGatewayService(fakeSecrets);
  const claims = new ClaimsGatewayService(fakeSecrets);

  await payment.createIntent({ idempotencyKey: "c13-pay", amountMinor: 1000, currency: "SAR", reference: "invoice-c13" });
  await insurance.checkEligibility({ idempotencyKey: "c13-ins", payerCode: "C13", externalPolicyRef: "opaque-policy", appointmentId: "appointment-c13", serviceId: "service-c13", totalMinor: 1000, currency: "SAR" });
  await claims.submitClaim({ idempotencyKey: "c13-claim", payerCode: "C13", externalPolicyRef: "opaque-policy", appointmentId: "appointment-c13", invoiceId: "invoice-c13", serviceId: "service-c13", submittedAmountMinor: 1000, currency: "SAR" });

  assert.equal(calls.length, 3);
  for (const call of calls) {
    assert.equal(call.init.redirect, "error", "financial gateway redirects must be rejected");
    assert.ok(call.init.signal instanceof AbortSignal, "financial gateway fetches must carry an AbortSignal timeout");
    assert.equal(call.init.signal.aborted, false);
    assert.match(String(call.init.headers.authorization), /^Bearer /);
  }

  globalThis.fetch = async () => {
    throw new Error("credential=must-never-leak provider-detail=internal");
  };
  try {
    await payment.retrieveIntent("payment-ref");
    assert.fail("expected sanitized payment transport failure");
  } catch (error) {
    assert.match(String(error), /External payment gateway transport failed/);
    assert.doesNotMatch(String(error), /must-never-leak|provider-detail/);
  }
  try {
    await insurance.checkEligibility({ idempotencyKey: "c13-ins-fail", payerCode: "C13", externalPolicyRef: "opaque-policy", appointmentId: "appointment-c13", serviceId: "service-c13", totalMinor: 1000, currency: "SAR" });
    assert.fail("expected sanitized insurance transport failure");
  } catch (error) {
    assert.match(String(error), /External insurance gateway transport failed/);
    assert.doesNotMatch(String(error), /must-never-leak|provider-detail/);
  }
  try {
    await claims.submitClaim({ idempotencyKey: "c13-claim-fail", payerCode: "C13", externalPolicyRef: "opaque-policy", appointmentId: "appointment-c13", invoiceId: "invoice-c13", serviceId: "service-c13", submittedAmountMinor: 1000, currency: "SAR" });
    assert.fail("expected sanitized claims transport failure");
  } catch (error) {
    assert.match(String(error), /External claims gateway transport failed/);
    assert.doesNotMatch(String(error), /must-never-leak|provider-detail/);
  }

  const mainSource = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  assert.ok(
    mainSource.indexOf("assertProductionFinancialGatewayEgressReady();") < mainSource.indexOf("NestFactory.create"),
    "C13 financial gateway preflight must execute before Nest application creation",
  );
  for (const path of [
    "../src/modules/billing/payment-gateway.service.ts",
    "../src/modules/billing/insurance-gateway.service.ts",
    "../src/modules/claims/claims-gateway.service.ts",
  ]) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    assert.match(source, /AbortSignal\.timeout\(this\.timeoutMs\(\)\)/, `${path} must use a bounded AbortSignal timeout`);
    assert.match(source, /redirect:\s*"error"/, `${path} must reject redirects`);
  }

  const packageSource = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.ok(packageSource.scripts.test.includes("c13:financial-gateway-egress"));
  assert.equal(packageSource.dependencies.undici, undefined, "C13 must not add a new HTTP dependency");

  console.log("Phase C13 financial gateway egress resilience acceptance passed");
} finally {
  globalThis.fetch = originalFetch;
  replaceProcessEnv(originalEnv);
}
