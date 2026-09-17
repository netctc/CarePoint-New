import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  GcpExternalSecretValueResolver,
} = require("../dist/infrastructure/secrets/gcp-external-secret-value-resolver.js");

const region = "me-central2";
const projectId = "carepoint-r1";
const serviceAccountEmail = `carepoint-runtime@${projectId}.iam.gserviceaccount.com`;
const keyRing = `projects/${projectId}/locations/${region}/keyRings/carepoint-r1`;
const externalSecretKey = `${keyRing}/cryptoKeys/external-secrets`;
const paymentSecretRef = `projects/${projectId}/locations/${region}/secrets/payment-gateway-api-key`;
const secretManagerHost = `secretmanager.${region}.rep.googleapis.com`;
const metadataHost = "metadata.google.internal";
const plaintext = "carepoint-provider-token";
const plaintextBase64 = Buffer.from(plaintext, "utf8").toString("base64");
const plaintextCrc32c = "2865599378";

function secretRef(name) {
  return `projects/${projectId}/locations/${region}/secrets/${name}`;
}

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
    CAREPOINT_DOCUMENT_KEY_REF: `${keyRing}/cryptoKeys/clinical-documents`,
    CAREPOINT_DOCUMENT_SIGNING_KEY_REF: `${keyRing}/cryptoKeys/clinical-document-attestation`,
    CAREPOINT_EXTERNAL_SECRET_KEY_REF: externalSecretKey,
    CAREPOINT_KEY_MAX_ROTATION_DAYS: "365",
    CAREPOINT_EXTERNAL_SECRET_PROVIDER: "gcp-secret-manager",
    CAREPOINT_EXTERNAL_SECRET_REGION: region,
    CAREPOINT_PAYMENT_GATEWAY_SECRET_REF: paymentSecretRef,
    CAREPOINT_INSURANCE_GATEWAY_SECRET_REF: secretRef("insurance-gateway-api-key"),
    CAREPOINT_CLAIMS_GATEWAY_SECRET_REF: secretRef("claims-gateway-api-key"),
    CAREPOINT_NOTIFICATION_GATEWAY_SECRET_REF: secretRef("notification-gateway-api-key"),
    CAREPOINT_SIEM_EXPORT_SECRET_REF: secretRef("siem-export-api-key"),
    CAREPOINT_LIVEKIT_API_KEY_SECRET_REF: secretRef("livekit-api-key"),
    CAREPOINT_LIVEKIT_API_SECRET_REF: secretRef("livekit-api-secret"),
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

function fakeFetch(options = {}) {
  const calls = [];
  let tokenCalls = 0;
  let emailCalls = 0;
  let accessCalls = 0;

  return {
    calls,
    get tokenCalls() { return tokenCalls; },
    get emailCalls() { return emailCalls; },
    get accessCalls() { return accessCalls; },
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
          access_token: options.token ?? "short-lived-secret-token",
          expires_in: options.expiresIn ?? 3600,
          token_type: options.tokenType ?? "Bearer",
        }, {
          headers: { "metadata-flavor": "Google" },
        });
      }
      if (url.hostname === secretManagerHost) {
        accessCalls += 1;
        assert.equal(url.protocol, "https:");
        assert.equal(url.search, "");
        assert.equal(url.hash, "");
        assert.equal(init.method, "GET");
        assert.equal(init.redirect, "error");
        assert.equal(init.headers?.Authorization, "Bearer short-lived-secret-token");
        assert.equal(
          decodeURIComponent(url.pathname),
          `/v1/${paymentSecretRef}/versions/latest:access`,
        );
        if (options.httpStatus) {
          return response("PROVIDER-SECRET-BODY-MUST-NOT-ESCAPE", { status: options.httpStatus });
        }
        if (options.oversizedBody) {
          return response("x".repeat(64 * 1024 + 1), {
            headers: { "content-type": "application/json" },
          });
        }
        return jsonResponse({
          name: options.versionName ?? `${paymentSecretRef}/versions/7`,
          payload: {
            data: options.data ?? plaintextBase64,
            dataCrc32c: options.crc32c ?? plaintextCrc32c,
          },
        });
      }
      throw new Error(`Unexpected URL host: ${url.hostname}`);
    },
  };
}

{
  const fake = fakeFetch();
  const resolver = new GcpExternalSecretValueResolver(env(), {
    fetch: fake.fetch,
    now: () => 1_700_000_000_000,
  });
  const first = await resolver.resolve("payment-gateway-api-key");
  const second = await resolver.resolve("payment-gateway-api-key");
  assert.equal(first, plaintext);
  assert.equal(second, first);
  assert.equal(fake.emailCalls, 1, "runtime identity should be validated once");
  assert.equal(fake.tokenCalls, 1, "short-lived token should remain cached in memory");
  assert.equal(fake.accessCalls, 2, "latest version identity should be re-checked on each resolution");
  assert.ok(fake.calls.every((call) => call.init.signal), "all metadata/provider calls require timeout signals");
  assert.ok(fake.calls.some((call) => new URL(call.url).hostname === secretManagerHost));
  await resolver.close();
  await assert.rejects(
    () => resolver.resolve("payment-gateway-api-key"),
    /resolver is closed/,
  );
}

async function rejects(pattern, mutate = () => {}, options = {}) {
  const config = env();
  mutate(config);
  const fake = fakeFetch(options);
  const resolver = new GcpExternalSecretValueResolver(config, { fetch: fake.fetch });
  await assert.rejects(() => resolver.resolve("payment-gateway-api-key"), pattern);
  await resolver.close();
}

await rejects(
  /CAREPOINT_GCP_AUTH_MODE must be 'metadata-service'/,
  (config) => { config.CAREPOINT_GCP_AUTH_MODE = "service-account-key"; },
);
await rejects(
  /GOOGLE_APPLICATION_CREDENTIALS static credential configuration is forbidden/,
  (config) => { config.GOOGLE_APPLICATION_CREDENTIALS = "/tmp/key.json"; },
);
await rejects(
  /CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE static credential configuration is forbidden/,
  (config) => { config.CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE = "/tmp/gcloud.json"; },
);
await rejects(
  /endpoint overrides are forbidden/,
  (config) => { config.CAREPOINT_GCP_SECRET_MANAGER_ENDPOINT = "https://example.invalid"; },
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
  /unexpected resource/,
  () => {},
  { versionName: `${secretRef("other-secret")}/versions/7` },
);
await rejects(
  /invalid version identity/,
  () => {},
  { versionName: `${paymentSecretRef}/versions/latest` },
);
await rejects(
  /canonical base64/,
  () => {},
  { data: "not-base64" },
);
await rejects(
  /CRC32C integrity validation/,
  () => {},
  { crc32c: "1" },
);
await rejects(
  /missing a valid CRC32C checksum/,
  () => {},
  { crc32c: "not-a-checksum" },
);
await rejects(
  /plaintext is invalid/,
  () => {},
  {
    data: Buffer.from("line1\nline2", "utf8").toString("base64"),
    crc32c: "383717795",
  },
);

{
  const config = env();
  const knownPlaintext = "123456789";
  const fake = fakeFetch({
    data: Buffer.from(knownPlaintext, "utf8").toString("base64"),
    crc32c: "3808858755",
  });
  const resolver = new GcpExternalSecretValueResolver(config, { fetch: fake.fetch });
  assert.equal(await resolver.resolve("payment-gateway-api-key"), knownPlaintext);
  await resolver.close();
}

{
  const fake = fakeFetch({ httpStatus: 500 });
  const resolver = new GcpExternalSecretValueResolver(env(), { fetch: fake.fetch });
  let failure;
  try {
    await resolver.resolve("payment-gateway-api-key");
  } catch (error) {
    failure = error;
  }
  assert.ok(failure instanceof Error);
  assert.match(failure.message, /HTTP 500/);
  assert.doesNotMatch(failure.message, /PROVIDER-SECRET-BODY-MUST-NOT-ESCAPE/);
  await resolver.close();
}

await rejects(
  /response exceeds the permitted size/,
  () => {},
  { oversizedBody: true },
);

console.log("R3 GCP regional Secret Manager value runtime smoke passed");
