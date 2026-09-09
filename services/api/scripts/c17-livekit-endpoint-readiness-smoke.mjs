import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  assertProductionTelehealthReady,
  telehealthProvider,
  validatedLiveKitUrl,
} = require("../dist/infrastructure/http/livekit-endpoint.js");
const { TelehealthProviderService } = require("../dist/modules/telehealth/telehealth-provider.service.js");

const originalEnv = { ...process.env };

function replaceProcessEnv(env) {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, env);
}

function production(overrides = {}) {
  return {
    NODE_ENV: "production",
    TELEHEALTH_PROVIDER: "livekit",
    LIVEKIT_URL: "wss://telehealth.example.test",
    ...overrides,
  };
}

try {
  assert.equal(telehealthProvider({ NODE_ENV: "test" }), "mock");
  assert.equal(telehealthProvider({ NODE_ENV: "test", TELEHEALTH_PROVIDER: "LIVEKIT" }), "livekit");
  assert.throws(
    () => telehealthProvider({ NODE_ENV: "test", TELEHEALTH_PROVIDER: "unsupported" }),
    /Unsupported TELEHEALTH_PROVIDER/,
  );

  assert.doesNotThrow(() => assertProductionTelehealthReady({ NODE_ENV: "test" }));
  assert.doesNotThrow(() => assertProductionTelehealthReady(production()));
  assert.throws(
    () => assertProductionTelehealthReady({ NODE_ENV: "production" }),
    /TELEHEALTH_PROVIDER=livekit is required in production/,
  );
  assert.throws(
    () => assertProductionTelehealthReady(production({ TELEHEALTH_PROVIDER: "mock" })),
    /TELEHEALTH_PROVIDER=livekit is required in production/,
  );
  assert.throws(
    () => assertProductionTelehealthReady(production({ LIVEKIT_URL: "" })),
    /LIVEKIT_URL is required for the LiveKit provider/,
  );

  assert.equal(validatedLiveKitUrl(production()), "wss://telehealth.example.test");
  assert.equal(
    validatedLiveKitUrl(production({ LIVEKIT_URL: "wss://telehealth.example.test/livekit/" })),
    "wss://telehealth.example.test/livekit",
    "reverse-proxy paths remain supported",
  );
  assert.equal(
    validatedLiveKitUrl({ NODE_ENV: "test", LIVEKIT_URL: "ws://127.0.0.1:7880" }),
    "ws://127.0.0.1:7880",
    "local ws:// remains supported outside production",
  );

  assert.throws(
    () => validatedLiveKitUrl(production({ LIVEKIT_URL: "https://telehealth.example.test" })),
    /must use ws:\/\/ or wss:\/\//,
  );
  assert.throws(
    () => validatedLiveKitUrl(production({ LIVEKIT_URL: "ws://telehealth.example.test" })),
    /Production LIVEKIT_URL must use wss:\/\//,
  );
  assert.throws(
    () => validatedLiveKitUrl(production({ LIVEKIT_URL: "wss://user:secret@telehealth.example.test" })),
    /must not embed credentials/,
  );
  assert.throws(
    () => validatedLiveKitUrl(production({ LIVEKIT_URL: "wss://telehealth.example.test?token=hidden" })),
    /must not contain a query string/,
  );
  assert.throws(
    () => validatedLiveKitUrl(production({ LIVEKIT_URL: "wss://telehealth.example.test#hidden" })),
    /must not contain a URL fragment/,
  );

  for (const endpoint of [
    "wss://localhost:7880",
    "wss://internal.localhost:7880",
    "wss://127.0.0.1:7880",
    "wss://127.9.1.2:7880",
    "wss://[::1]:7880",
    "wss://0.0.0.0:7880",
    "wss://[::]:7880",
  ]) {
    assert.throws(
      () => validatedLiveKitUrl(production({ LIVEKIT_URL: endpoint })),
      /must not target a loopback, localhost, or unspecified host/,
      endpoint,
    );
  }

  replaceProcessEnv(production({ LIVEKIT_URL: "wss://127.0.0.1:7880" }));
  let invalidSecretCalls = 0;
  const invalidService = new TelehealthProviderService({
    resolve: async () => {
      invalidSecretCalls += 1;
      return "unused-c17-secret";
    },
  });
  await assert.rejects(
    () => invalidService.issueJoinToken({
      roomName: "room-c17-invalid",
      participantIdentity: "patient-c17-invalid",
      participantRole: "PATIENT",
      ttlSeconds: 900,
    }),
    /must not target a loopback, localhost, or unspecified host/,
  );
  assert.equal(invalidSecretCalls, 0, "invalid client-facing LiveKit endpoints must fail before secret resolution or JWT issuance");

  replaceProcessEnv(production({ LIVEKIT_URL: "wss://telehealth.example.test/livekit/" }));
  const validService = new TelehealthProviderService({
    resolve: async (name) => name === "livekit-api-key" ? "c17-api-key" : "c17-api-secret-with-sufficient-test-entropy",
  });
  const join = await validService.issueJoinToken({
    roomName: "room-c17",
    participantIdentity: "patient-c17",
    participantRole: "PATIENT",
    ttlSeconds: 900,
  });
  assert.equal(join.serverUrl, "wss://telehealth.example.test/livekit");
  assert.equal(join.participantToken.split(".").length, 3, "LiveKit join material must still contain a compact JWT");
  assert.ok(join.expiresAt.getTime() > Date.now());

  const mainSource = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  assert.ok(
    mainSource.indexOf("assertProductionTelehealthReady();") < mainSource.indexOf("NestFactory.create"),
    "C17 telehealth readiness must execute before Nest application creation",
  );

  const providerSource = await readFile(new URL("../src/modules/telehealth/telehealth-provider.service.ts", import.meta.url), "utf8");
  assert.match(providerSource, /validatedLiveKitUrl/, "LiveKit join material must use the C17 endpoint policy");
  assert.match(providerSource, /telehealthProvider/, "telehealth provider mode must use the shared C17 policy");
  assert.doesNotMatch(
    providerSource,
    /const\s+url\s*=\s*process\.env\.LIVEKIT_URL/,
    "LiveKit JWT issuance must not use an unvalidated raw LIVEKIT_URL",
  );

  const packageSource = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.ok(packageSource.scripts.test.includes("c17:livekit-endpoint-readiness"));
  assert.equal(packageSource.dependencies["livekit-client"], undefined, "C17 must not add a new client dependency");

  console.log("Phase C17 LiveKit endpoint readiness acceptance passed");
} finally {
  replaceProcessEnv(originalEnv);
}
