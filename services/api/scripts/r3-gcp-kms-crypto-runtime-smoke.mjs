import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  GcpKmsKeyProvider,
} = require("../dist/infrastructure/security/gcp-kms-key-provider.js");

const region = "me-central2";
const projectId = "carepoint-r1";
const serviceAccountEmail = `carepoint-runtime@${projectId}.iam.gserviceaccount.com`;
const keyRing = `projects/${projectId}/locations/${region}/keyRings/carepoint-r1`;
const documentKeyRef = `${keyRing}/cryptoKeys/clinical-documents`;
const signingKeyRef = `${keyRing}/cryptoKeys/clinical-document-attestation`;
const externalKeyRef = `${keyRing}/cryptoKeys/external-secrets`;
const purpose = "carepoint-clinical-document-dek";
const dataKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const wrappedBytes = Buffer.from("carepoint-gcp-wrapped-data-key", "utf8");
const wrappedCiphertext = wrappedBytes.toString("base64");
const kmsHost = `cloudkms.${region}.rep.googleapis.com`;
const metadataHost = "metadata.google.internal";

function env() {
  return {
    NODE_ENV: "production",
    CAREPOINT_CLOUD_PROVIDER: "gcp",
    CAREPOINT_RESIDENCY_JURISDICTION: "SA",
    CAREPOINT_APPROVED_DATA_REGIONS: region,
    CAREPOINT_PRIMARY_REGION: region,
    GCP_REGION: region,
    GCP_PROJECT_ID: projectId,
    CAREPOINT_GCP_AUTH_MODE: "metadata-service",
    CAREPOINT_GCP_SERVICE_ACCOUNT_EMAIL: serviceAccountEmail,
    CAREPOINT_KEY_MANAGEMENT_PROVIDER: "gcp-cloud-kms",
    CAREPOINT_KEY_MANAGEMENT_REGION: region,
    CAREPOINT_VAULT_REF: keyRing,
    CAREPOINT_DOCUMENT_KEY_REF: documentKeyRef,
    CAREPOINT_DOCUMENT_SIGNING_KEY_REF: signingKeyRef,
    CAREPOINT_EXTERNAL_SECRET_KEY_REF: externalKeyRef,
    CAREPOINT_KEY_MAX_ROTATION_DAYS: "365",
  };
}

function response(body, { status = 200, headers = {} } = {}) {
  return new Response(body, { status, headers });
}

function jsonResponse(value, options = {}) {
  return response(JSON.stringify(value), {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers ?? {}),
    },
  });
}

function crc32c(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) !== 0 ? 0x82f63b78 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function fakeFetch(options = {}) {
  const calls = [];
  let emailCalls = 0;
  let tokenCalls = 0;
  let encryptCalls = 0;
  let decryptCalls = 0;

  return {
    calls,
    get emailCalls() { return emailCalls; },
    get tokenCalls() { return tokenCalls; },
    get encryptCalls() { return encryptCalls; },
    get decryptCalls() { return decryptCalls; },
    fetch: async (input, init = {}) => {
      const url = new URL(String(input));
      calls.push({ url: url.toString(), init });

      if (url.hostname === metadataHost && url.pathname.endsWith("/service-accounts/default/email")) {
        emailCalls += 1;
        return response(options.email ?? serviceAccountEmail, {
          headers: options.omitMetadataFlavor ? {} : { "metadata-flavor": "Google" },
        });
      }

      if (url.hostname === metadataHost && url.pathname.endsWith("/service-accounts/default/token")) {
        tokenCalls += 1;
        return jsonResponse({
          access_token: options.token ?? "short-lived-kms-token",
          expires_in: options.expiresIn ?? 3600,
          token_type: options.tokenType ?? "Bearer",
        }, {
          headers: { "metadata-flavor": "Google" },
        });
      }

      if (url.hostname !== kmsHost) {
        throw new Error(`Unexpected URL host: ${url.hostname}`);
      }

      assert.equal(url.protocol, "https:");
      assert.equal(url.search, "");
      assert.equal(url.hash, "");
      assert.equal(init.method, "POST");
      assert.equal(init.redirect, "error");
      assert.equal(init.headers?.Authorization, "Bearer short-lived-kms-token");
      assert.equal(init.headers?.["Content-Type"], "application/json");
      assert.ok(init.signal, "Cloud KMS calls require timeout signals");

      if (options.httpStatus) {
        return response("PROVIDER-KMS-BODY-MUST-NOT-ESCAPE", { status: options.httpStatus });
      }
      if (options.oversizedBody) {
        return response("x".repeat(64 * 1024 + 1), {
          headers: { "content-type": "application/json" },
        });
      }

      const body = JSON.parse(String(init.body));
      const aad = Buffer.from(body.additionalAuthenticatedData, "base64");
      assert.equal(aad.toString("utf8"), `purpose=${purpose}`);
      assert.equal(Number(body.additionalAuthenticatedDataCrc32c), crc32c(aad));

      const decodedPath = decodeURIComponent(url.pathname);
      if (decodedPath === `/v1/${documentKeyRef}:encrypt`) {
        encryptCalls += 1;
        const plaintext = Buffer.from(body.plaintext, "base64");
        assert.deepEqual(Array.from(plaintext), Array.from(dataKey));
        assert.equal(Number(body.plaintextCrc32c), crc32c(plaintext));
        return jsonResponse({
          name: options.versionName ?? `${documentKeyRef}/cryptoKeyVersions/7`,
          ciphertext: options.ciphertext ?? wrappedCiphertext,
          ciphertextCrc32c: options.ciphertextCrc32c
            ?? String(crc32c(Buffer.from(options.ciphertext ?? wrappedCiphertext, "base64"))),
          verifiedPlaintextCrc32c: options.verifiedPlaintext ?? true,
          verifiedAdditionalAuthenticatedDataCrc32c: options.verifiedAad ?? true,
          protectionLevel: options.protectionLevel ?? "HSM",
        });
      }

      if (decodedPath === `/v1/${documentKeyRef}:decrypt`) {
        decryptCalls += 1;
        const ciphertext = Buffer.from(body.ciphertext, "base64");
        assert.equal(body.ciphertext, wrappedCiphertext);
        assert.equal(Number(body.ciphertextCrc32c), crc32c(ciphertext));
        const plaintext = options.plaintext ?? Buffer.from(dataKey).toString("base64");
        return jsonResponse({
          plaintext,
          plaintextCrc32c: options.plaintextCrc32c
            ?? String(crc32c(Buffer.from(plaintext, "base64"))),
          verifiedCiphertextCrc32c: options.verifiedCiphertext ?? true,
          verifiedAdditionalAuthenticatedDataCrc32c: options.verifiedAad ?? true,
          protectionLevel: options.protectionLevel ?? "HSM",
        });
      }

      throw new Error(`Unexpected Cloud KMS path: ${decodedPath}`);
    },
  };
}

async function rejects(pattern, mutate = () => {}, options = {}, operation = "wrap") {
  const config = env();
  mutate(config);
  const fake = fakeFetch(options);
  const keyId = options.configuredKeyId ?? documentKeyRef;
  const provider = new GcpKmsKeyProvider(keyId, purpose, config, {
    fetch: fake.fetch,
    now: () => 1_700_000_000_000,
  });
  const action = operation === "unwrap"
    ? () => provider.unwrapDataKey({ keyId, wrappedKey: wrappedCiphertext })
    : () => provider.wrapDataKey(dataKey);
  await assert.rejects(action, pattern);
  return fake;
}

{
  const fake = fakeFetch();
  const provider = new GcpKmsKeyProvider(documentKeyRef, purpose, env(), {
    fetch: fake.fetch,
    now: () => 1_700_000_000_000,
  });

  const wrapped = await provider.wrapDataKey(dataKey);
  assert.deepEqual(wrapped, { keyId: documentKeyRef, wrappedKey: wrappedCiphertext });
  const unwrapped = await provider.unwrapDataKey(wrapped);
  assert.deepEqual(Array.from(unwrapped), Array.from(dataKey));
  assert.equal(fake.emailCalls, 1, "runtime identity should be validated once");
  assert.equal(fake.tokenCalls, 1, "short-lived metadata token should be cached in memory");
  assert.equal(fake.encryptCalls, 1);
  assert.equal(fake.decryptCalls, 1);
  assert.ok(fake.calls.every((call) => call.init.signal), "all metadata/provider calls require timeout signals");
}

{
  const fake = fakeFetch();
  const provider = new GcpKmsKeyProvider(documentKeyRef, purpose, env(), { fetch: fake.fetch });
  await assert.rejects(
    () => provider.wrapDataKey(Uint8Array.from([1, 2, 3])),
    /exactly 32 bytes/,
  );
  assert.equal(fake.emailCalls, 0);
}

{
  const fake = fakeFetch();
  const provider = new GcpKmsKeyProvider(documentKeyRef, purpose, env(), { fetch: fake.fetch });
  await assert.rejects(
    () => provider.unwrapDataKey({ keyId: signingKeyRef, wrappedKey: wrappedCiphertext }),
    /unexpected key id/,
  );
  assert.equal(fake.emailCalls, 0);
}

await rejects(/CAREPOINT_GCP_AUTH_MODE/, (config) => { config.CAREPOINT_GCP_AUTH_MODE = "service-account-key"; });
await rejects(
  /GOOGLE_APPLICATION_CREDENTIALS static credential configuration is forbidden/,
  (config) => { config.GOOGLE_APPLICATION_CREDENTIALS = "/tmp/key.json"; },
);
await rejects(
  /endpoint overrides are forbidden/,
  (config) => { config.CAREPOINT_GCP_KMS_ENDPOINT = "https://example.invalid"; },
);
await rejects(/restricted to GCP production/, (config) => { config.CAREPOINT_CLOUD_PROVIDER = "oci"; });
await rejects(
  /approved encrypt-decrypt production key reference/,
  () => {},
  { configuredKeyId: signingKeyRef },
);
await rejects(
  /runtime service-account identity does not match/,
  () => {},
  { email: `wrong-runtime@${projectId}.iam.gserviceaccount.com` },
);
await rejects(
  /missing the Google metadata trust marker/,
  () => {},
  { omitMetadataFlavor: true },
);
await rejects(
  /unexpected CryptoKeyVersion identity/,
  () => {},
  { versionName: `${externalKeyRef}/cryptoKeyVersions/7` },
);
await rejects(/did not verify the plaintext CRC32C/, () => {}, { verifiedPlaintext: false });
await rejects(/did not verify the AAD CRC32C/, () => {}, { verifiedAad: false });
await rejects(/failed CRC32C integrity validation/, () => {}, { ciphertextCrc32c: "1" });
await rejects(/not canonical base64/, () => {}, { ciphertext: "not-base64" });
await rejects(/unsupported protection level/, () => {}, { protectionLevel: "EXTERNAL" });

{
  const fake = await rejects(/request failed \(HTTP 503\)/, () => {}, { httpStatus: 503 });
  const errorBody = "PROVIDER-KMS-BODY-MUST-NOT-ESCAPE";
  await assert.rejects(
    () => new GcpKmsKeyProvider(documentKeyRef, purpose, env(), { fetch: fake.fetch }).wrapDataKey(dataKey),
    (error) => error instanceof Error && !error.message.includes(errorBody),
  );
}

await rejects(/did not verify the ciphertext CRC32C/, () => {}, { verifiedCiphertext: false }, "unwrap");
await rejects(/did not verify the AAD CRC32C/, () => {}, { verifiedAad: false }, "unwrap");
await rejects(/failed CRC32C integrity validation/, () => {}, { plaintextCrc32c: "1" }, "unwrap");
await rejects(/not canonical base64/, () => {}, { plaintext: "not-base64", plaintextCrc32c: "1" }, "unwrap");
await rejects(
  /invalid data key length/,
  () => {},
  {
    plaintext: Buffer.from("short", "utf8").toString("base64"),
    plaintextCrc32c: String(crc32c(Buffer.from("short", "utf8"))),
  },
  "unwrap",
);
await rejects(/unsupported protection level/, () => {}, { protectionLevel: "EXTERNAL" }, "unwrap");

{
  const config = env();
  config.CAREPOINT_DOCUMENT_KEY_REF = `projects/other-project/locations/${region}/keyRings/carepoint-r1/cryptoKeys/clinical-documents`;
  const fake = fakeFetch();
  const provider = new GcpKmsKeyProvider(config.CAREPOINT_DOCUMENT_KEY_REF, purpose, config, { fetch: fake.fetch });
  await assert.rejects(() => provider.wrapDataKey(dataKey), /must belong to GCP_PROJECT_ID/);
}

console.log("R3 GCP Cloud KMS crypto runtime smoke passed");
