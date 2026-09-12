import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  EXTERNAL_SECRET_DEFINITIONS,
  resolveExternalSecret,
} = require("../dist/infrastructure/secrets/external-secret-resolver.service.js");

assert.equal(EXTERNAL_SECRET_DEFINITIONS.length, 7);
assert.deepEqual(
  EXTERNAL_SECRET_DEFINITIONS.map((item) => item.name),
  [
    "payment-gateway-api-key",
    "insurance-gateway-api-key",
    "claims-gateway-api-key",
    "notification-gateway-api-key",
    "siem-export-api-key",
    "livekit-api-key",
    "livekit-api-secret",
  ],
);

const dir = await mkdtemp(join(tmpdir(), "carepoint-c12-"));
const secretFile = join(dir, "payment.kms.b64");
const rotatedFile = join(dir, "payment.kms.b64.next");
const encodeCipher = (marker) => Buffer.from(marker, "utf8").toString("base64");
let decryptCalls = 0;
const contexts = [];
const keyIds = [];
const fakeKms = {
  async send(command) {
    decryptCalls += 1;
    contexts.push(command.input.EncryptionContext);
    keyIds.push(command.input.KeyId);
    const marker = Buffer.from(command.input.CiphertextBlob).toString("utf8");
    const value = marker === "cipher-one" ? "resolved-value-one" : marker === "cipher-two" ? "resolved-value-two" : "unexpected";
    return { Plaintext: Buffer.from(value, "utf8"), KeyId: "kms-key-id-redacted" };
  },
};

try {
  await writeFile(secretFile, `${encodeCipher("cipher-one")}\n`, { mode: 0o600 });
  const env = {
    NODE_ENV: "test",
    EXTERNAL_SECRET_KMS_KEY_ID: "alias/carepoint/external-secrets",
    PAYMENT_GATEWAY_API_KEY_KMS_FILE: secretFile,
  };
  const cache = new Map();

  assert.equal(await resolveExternalSecret("payment-gateway-api-key", env, fakeKms, cache), "resolved-value-one");
  assert.equal(decryptCalls, 1);
  assert.equal(keyIds[0], "alias/carepoint/external-secrets");
  assert.deepEqual(contexts[0], { purpose: "carepoint-external-secret", secret: "payment-gateway-api-key" });

  assert.equal(await resolveExternalSecret("payment-gateway-api-key", env, fakeKms, cache), "resolved-value-one");
  assert.equal(decryptCalls, 1, "unchanged ciphertext should reuse the in-memory decrypted value");

  await writeFile(rotatedFile, `${encodeCipher("cipher-two")}\n`, { mode: 0o600 });
  await rename(rotatedFile, secretFile);
  assert.equal(await resolveExternalSecret("payment-gateway-api-key", env, fakeKms, cache), "resolved-value-two");
  assert.equal(decryptCalls, 2, "atomic ciphertext replacement must trigger KMS re-decryption without process restart");
  assert.equal(keyIds[1], "alias/carepoint/external-secrets");

  const legacyValue = ["development", "placeholder", "value"].join("-");
  assert.equal(
    await resolveExternalSecret(
      "payment-gateway-api-key",
      { NODE_ENV: "test", PAYMENT_GATEWAY_API_KEY: legacyValue },
      fakeKms,
      new Map(),
    ),
    legacyValue,
  );
  assert.equal(decryptCalls, 2, "development legacy fallback must not call KMS");

  await assert.rejects(
    resolveExternalSecret(
      "payment-gateway-api-key",
      { NODE_ENV: "production", PAYMENT_GATEWAY_API_KEY: ["forbidden", "plaintext"].join("-") },
      fakeKms,
      new Map(),
    ),
    /plaintext environment configuration is forbidden in production/,
  );
  await assert.rejects(
    resolveExternalSecret("payment-gateway-api-key", { NODE_ENV: "production" }, fakeKms, new Map()),
    /PAYMENT_GATEWAY_API_KEY_KMS_FILE is required in production/,
  );
  await assert.rejects(
    resolveExternalSecret(
      "payment-gateway-api-key",
      { NODE_ENV: "production", PAYMENT_GATEWAY_API_KEY_KMS_FILE: secretFile },
      fakeKms,
      new Map(),
    ),
    /EXTERNAL_SECRET_KMS_KEY_ID is required in production/,
  );
  await assert.rejects(
    resolveExternalSecret(
      "payment-gateway-api-key",
      { NODE_ENV: "test", PAYMENT_GATEWAY_API_KEY_KMS_FILE: "relative-secret-file" },
      fakeKms,
      new Map(),
    ),
    /must be an absolute path/,
  );

  await chmod(secretFile, 0o666);
  await assert.rejects(
    resolveExternalSecret("payment-gateway-api-key", env, fakeKms, new Map()),
    /must not be group\/world writable/,
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}

const mainSource = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
assert.ok(
  mainSource.indexOf("assertProductionExternalSecretsReady();") < mainSource.indexOf("NestFactory.create"),
  "C12 external secret preflight must execute before Nest application creation",
);
const appSource = await readFile(new URL("../src/app.module.ts", import.meta.url), "utf8");
assert.match(appSource, /ExternalSecretsModule/);

const consumers = [
  ["../src/modules/billing/payment-gateway.service.ts", "payment-gateway-api-key"],
  ["../src/modules/billing/insurance-gateway.service.ts", "insurance-gateway-api-key"],
  ["../src/modules/claims/claims-gateway.service.ts", "claims-gateway-api-key"],
  ["../src/modules/communications/notification-gateway.service.ts", "notification-gateway-api-key"],
  ["../src/infrastructure/siem/siem-gateway.service.ts", "siem-export-api-key"],
  ["../src/modules/telehealth/telehealth-provider.service.ts", "livekit-api-key"],
  ["../src/modules/telehealth/telehealth-provider.service.ts", "livekit-api-secret"],
];
for (const [path, secretName] of consumers) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  assert.ok(source.includes(`secrets.resolve(\"${secretName}\")`), `${path} must resolve ${secretName} through C12`);
}

const kmsSource = await readFile(new URL("../src/infrastructure/security/production-kms-preflight.ts", import.meta.url), "utf8");
assert.match(kmsSource, /EXTERNAL_SECRET_KMS_KEY_ID/);
const packageSource = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
assert.ok(packageSource.scripts.test.includes("c12:external-secret-rotation"));
assert.equal(packageSource.dependencies["@aws-sdk/client-kms"], "3.1128.0");
assert.equal(packageSource.dependencies["@aws-sdk/client-secrets-manager"], undefined, "C12 must not change the canonical dependency graph");

console.log("Phase C12 external secret rotation acceptance passed");
