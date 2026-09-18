import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  assertProductionPaymentActionPolicyReady,
  trustedPaymentActionOrigins,
  validatedPaymentActionUrl,
} = require("../dist/infrastructure/http/payment-action-url-policy.js");
const { PaymentGatewayService } = require("../dist/modules/billing/payment-gateway.service.js");

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

function replaceProcessEnv(env) {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, env);
}

function productionEnv(overrides = {}) {
  return {
    NODE_ENV: "production",
    EXTERNAL_PROVIDER_MAX_RESPONSE_BYTES: "65536",
    PAYMENT_GATEWAY_PROVIDER: "external",
    PAYMENT_GATEWAY_BASE_URL: "https://api.psp.example/v1/",
    PAYMENT_GATEWAY_TIMEOUT_MS: "5000",
    PAYMENT_GATEWAY_ACTION_ORIGINS: "https://checkout.psp.example, https://checkout-eu.psp.example:443",
    ...overrides,
  };
}

async function expectRejected(promise, pattern) {
  try {
    await promise;
    assert.fail("expected rejection");
  } catch (error) {
    assert.match(String(error), pattern);
    return String(error);
  }
}

try {
  assert.doesNotThrow(() => assertProductionPaymentActionPolicyReady({ NODE_ENV: "test" }));
  assert.doesNotThrow(() => assertProductionPaymentActionPolicyReady(productionEnv()));
  assert.throws(
    () => assertProductionPaymentActionPolicyReady(productionEnv({ PAYMENT_GATEWAY_ACTION_ORIGINS: "" })),
    /PAYMENT_GATEWAY_ACTION_ORIGINS is required for external payments in production/,
  );

  assert.deepEqual(
    trustedPaymentActionOrigins(productionEnv({ PAYMENT_GATEWAY_ACTION_ORIGINS: "https://CHECKOUT.PSP.EXAMPLE:443,https://checkout.psp.example" })),
    ["https://checkout.psp.example"],
  );
  assert.deepEqual(
    trustedPaymentActionOrigins(productionEnv()),
    ["https://checkout.psp.example", "https://checkout-eu.psp.example"],
  );

  for (const [value, pattern] of [
    ["http://checkout.psp.example", /must use HTTPS/],
    ["https://user:secret@checkout.psp.example", /must not contain credentials/],
    ["https://checkout.psp.example/pay", /must not contain a path/],
    ["https://checkout.psp.example/?tenant=ksa", /must not contain a query string/],
    ["https://checkout.psp.example/#state", /must not contain a URL fragment/],
    ["https://127.0.0.1", /must not target loopback/],
    ["https://[::1]", /must not target loopback/],
    ["https://internal.localhost", /must not target loopback/],
    ["https://*.psp.example", /does not support wildcard hosts/],
    ["https://checkout.psp.example,,https://checkout-eu.psp.example", /must not contain empty entries/],
  ]) {
    assert.throws(
      () => trustedPaymentActionOrigins(productionEnv({ PAYMENT_GATEWAY_ACTION_ORIGINS: value })),
      pattern,
      `expected configured origin '${value}' to be rejected`,
    );
  }

  const trustedSession = validatedPaymentActionUrl(
    "https://checkout.psp.example/session/abc123?token=opaque#provider-state",
    productionEnv(),
  );
  assert.equal(trustedSession, "https://checkout.psp.example/session/abc123?token=opaque#provider-state");
  assert.equal(
    validatedPaymentActionUrl("https://checkout-eu.psp.example/pay/session-2", productionEnv()),
    "https://checkout-eu.psp.example/pay/session-2",
  );
  assert.throws(
    () => validatedPaymentActionUrl("https://checkout.psp.example.evil.test/session/abc", productionEnv()),
    /origin is not trusted/,
  );
  assert.throws(
    () => validatedPaymentActionUrl("https://phishing.example/session/abc", productionEnv()),
    /origin is not trusted/,
  );
  assert.throws(
    () => validatedPaymentActionUrl("https://user:secret@checkout.psp.example/session/abc", productionEnv()),
    /must not contain credentials/,
  );
  assert.throws(
    () => validatedPaymentActionUrl("https://127.0.0.1/session/abc", productionEnv({ PAYMENT_GATEWAY_ACTION_ORIGINS: "https://checkout.psp.example" })),
    /must not target loopback/,
  );

  replaceProcessEnv(productionEnv());
  const fakeSecrets = { resolve: async () => "c16-provider-secret" };
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({
      reference: "payment-action-c16",
      status: "REQUIRES_ACTION",
      actionUrl: "https://checkout.psp.example/session/c16?token=opaque",
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const payment = new PaymentGatewayService(fakeSecrets);
  const result = await payment.createIntent({
    idempotencyKey: "c16-payment",
    amountMinor: 1000,
    currency: "SAR",
    reference: "invoice-c16",
  });
  assert.equal(result.status, "REQUIRES_ACTION");
  assert.equal(result.actionUrl, "https://checkout.psp.example/session/c16?token=opaque");
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /^https:\/\/api\.psp\.example\//, "PSP API origin and hosted checkout origin may differ");

  globalThis.fetch = async () => new Response(JSON.stringify({
    reference: "payment-action-c16-attacker",
    status: "REQUIRES_ACTION",
    actionUrl: "https://phishing.example/steal?session=must-not-leak",
  }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  const attackerError = await expectRejected(
    payment.createIntent({ idempotencyKey: "c16-payment-attacker", amountMinor: 1000, currency: "SAR", reference: "invoice-c16" }),
    /Payment gateway returned an untrusted hosted action URL/,
  );
  assert.doesNotMatch(attackerError, /phishing\.example|must-not-leak|\/steal/);

  globalThis.fetch = async () => new Response(JSON.stringify({
    reference: "payment-action-c16-credentials",
    status: "REQUIRES_ACTION",
    actionUrl: "https://user:provider-secret@checkout.psp.example/session/c16",
  }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  const credentialError = await expectRejected(
    payment.retrieveIntent("payment-action-c16-credentials"),
    /Payment gateway returned an untrusted hosted action URL/,
  );
  assert.doesNotMatch(credentialError, /provider-secret|user@/);

  const mainSource = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  assert.ok(
    mainSource.indexOf("assertProductionPaymentActionPolicyReady();") < mainSource.indexOf("NestFactory.create"),
    "C16 hosted payment action preflight must execute before Nest application creation",
  );

  const paymentSource = await readFile(new URL("../src/modules/billing/payment-gateway.service.ts", import.meta.url), "utf8");
  assert.match(paymentSource, /validatedPaymentActionUrl/, "payment gateway must validate provider action URLs server-side");
  assert.match(paymentSource, /untrusted hosted action URL/, "payment gateway must expose only a sanitized action URL failure");
  assert.doesNotMatch(paymentSource, /url\.hostname\.endsWith/, "C16 must not use suffix/subdomain trust matching");

  const packageSource = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.ok(packageSource.scripts.test.includes("c16:hosted-payment-action-trust"));
  assert.equal(packageSource.dependencies.psl, undefined, "C16 must not add a hostname-matching dependency");

  console.log("Phase C16 hosted payment action trust acceptance passed");
} finally {
  globalThis.fetch = originalFetch;
  replaceProcessEnv(originalEnv);
}
