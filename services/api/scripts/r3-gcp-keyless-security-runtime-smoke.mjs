import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  createProductionGcpSecurityRuntime,
} = require("../dist/infrastructure/cloud/gcp-production-security-runtime.js");
const {
  productionKeyManagementContract,
  assertProductionKeyManagementInspectionReady,
} = require("../dist/infrastructure/cloud/production-key-management.js");
const {
  assertProductionExternalSecretInspectionReady,
} = require("../dist/infrastructure/cloud/production-secret-store.js");

const region = "me-central2";
const projectId = "carepoint-r1";
const serviceAccountEmail = `carepoint-runtime@${projectId}.iam.gserviceaccount.com`;
const keyRing = `projects/${projectId}/locations/${region}/keyRings/carepoint-r1`;
const documentKey = `${keyRing}/cryptoKeys/clinical-documents`;
const signingKey = `${keyRing}/cryptoKeys/clinical-document-attestation`;
const externalSecretKey = `${keyRing}/cryptoKeys/external-secrets`;
const kmsHost = `cloudkms.${region}.rep.googleapis.com`;
const secretManagerHost = `secretmanager.${region}.rep.googleapis.com`;
const approvedRegionalHosts = new Set([kmsHost, secretManagerHost]);

function secretRef(name) {
  return `projects/${projectId}/locations/${region}/secrets/${name}`;
}

function validEnv() {
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
    CAREPOINT_DOCUMENT_KEY_REF: documentKey,
    CAREPOINT_DOCUMENT_SIGNING_KEY_REF: signingKey,
    CAREPOINT_EXTERNAL_SECRET_KEY_REF: externalSecretKey,
    CAREPOINT_KEY_MAX_ROTATION_DAYS: "365",

    CAREPOINT_EXTERNAL_SECRET_PROVIDER: "gcp-secret-manager",
    CAREPOINT_EXTERNAL_SECRET_REGION: region,
    CAREPOINT_PAYMENT_GATEWAY_SECRET_REF: secretRef("payment-gateway-api-key"),
    CAREPOINT_INSURANCE_GATEWAY_SECRET_REF: secretRef("insurance-gateway-api-key"),
    CAREPOINT_CLAIMS_GATEWAY_SECRET_REF: secretRef("claims-gateway-api-key"),
    CAREPOINT_NOTIFICATION_GATEWAY_SECRET_REF: secretRef("notification-gateway-api-key"),
    CAREPOINT_SIEM_EXPORT_SECRET_REF: secretRef("siem-export-api-key"),
    CAREPOINT_LIVEKIT_API_KEY_SECRET_REF: secretRef("livekit-api-key"),
    CAREPOINT_LIVEKIT_API_SECRET_REF: secretRef("livekit-api-secret"),
  };
}

function response(body, options = {}) {
  const headers = new Headers(options.headers ?? {});
  return new Response(body, {
    status: options.status ?? 200,
    headers,
  });
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

function providerResourcePath(url) {
  const parsed = new URL(url);
  assert.equal(parsed.protocol, "https:");
  assert.ok(approvedRegionalHosts.has(parsed.hostname));
  assert.ok(parsed.pathname.startsWith("/v1/"));
  assert.equal(parsed.search, "");
  assert.equal(parsed.hash, "");
  return {
    hostname: parsed.hostname,
    resourcePath: decodeURIComponent(parsed.pathname.slice("/v1/".length)),
  };
}

function successfulFetchRecorder() {
  const calls = [];
  let tokenCalls = 0;

  const fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });

    if (url.endsWith("/service-accounts/default/email")) {
      return response(serviceAccountEmail, {
        headers: { "metadata-flavor": "Google" },
      });
    }
    if (url.endsWith("/service-accounts/default/token")) {
      tokenCalls += 1;
      return jsonResponse({
        access_token: "short-lived-runtime-token",
        expires_in: 3600,
        token_type: "Bearer",
      }, {
        headers: { "metadata-flavor": "Google" },
      });
    }

    assert.equal(init.headers?.Authorization, "Bearer short-lived-runtime-token");
    assert.equal(init.redirect, "error");

    const { hostname, resourcePath } = providerResourcePath(url);
    if (hostname === kmsHost) {
      if (resourcePath === signingKey) {
        return jsonResponse({
          name: signingKey,
          purpose: "ASYMMETRIC_SIGN",
          primary: {
            state: "ENABLED",
            protectionLevel: "HSM",
          },
        });
      }
      const name = resourcePath === documentKey ? documentKey : externalSecretKey;
      return jsonResponse({
        name,
        purpose: "ENCRYPT_DECRYPT",
        primary: {
          state: "ENABLED",
          protectionLevel: "HSM",
        },
        rotationPeriod: "7776000s",
      });
    }

    if (hostname === secretManagerHost) {
      if (resourcePath.endsWith("/versions/latest")) {
        return jsonResponse({
          name: resourcePath,
          state: "ENABLED",
        });
      }
      return jsonResponse({
        name: resourcePath,
        customerManagedEncryption: {
          kmsKeyName: externalSecretKey,
        },
      });
    }

    throw new Error(`Unexpected test URL: ${url}`);
  };

  return {
    fetch,
    calls,
    get tokenCalls() {
      return tokenCalls;
    },
  };
}

assert.equal(await createProductionGcpSecurityRuntime({ NODE_ENV: "test" }), null);
assert.equal(await createProductionGcpSecurityRuntime({ NODE_ENV: "production", CAREPOINT_CLOUD_PROVIDER: "oci" }), null);

const env = validEnv();
const recorder = successfulFetchRecorder();
const runtime = await createProductionGcpSecurityRuntime(env, {
  fetch: recorder.fetch,
  now: () => 1_700_000_000_000,
});
assert.ok(runtime);
assert.equal(runtime.serviceAccountEmail, serviceAccountEmail);

await assertProductionKeyManagementInspectionReady(runtime.inspectManagedKey, env);
await assertProductionExternalSecretInspectionReady(runtime.inspectExternalCredential, env);
assert.equal(recorder.tokenCalls, 1, "short-lived metadata access token should be cached in-memory");

const keyContract = productionKeyManagementContract(env);
assert.equal(keyContract.provider, "gcp-cloud-kms");
const signingDomain = keyContract.domains.find((domain) => domain.label === "clinical-document-attestation");
assert.ok(signingDomain);
assert.equal(signingDomain.rotationMode, "manual");
const signingInspection = await runtime.inspectManagedKey(signingDomain);
assert.equal(signingInspection.rotationEnabled, false);
assert.equal(signingInspection.rotationPeriodDays, undefined);

for (const call of recorder.calls) {
  assert.ok(call.init.signal, "all GCP metadata/provider requests must have a timeout signal");
}
for (const call of recorder.calls) {
  const parsed = new URL(call.url);
  if (!approvedRegionalHosts.has(parsed.hostname)) continue;
  assert.equal(parsed.protocol, "https:");
  assert.ok(parsed.pathname.startsWith("/v1/"));
  assert.equal(call.init.headers?.Authorization, "Bearer short-lived-runtime-token");
}

await runtime.close();

await assert.rejects(
  () => createProductionGcpSecurityRuntime({
    ...validEnv(),
    GOOGLE_APPLICATION_CREDENTIALS: "/tmp/static-key.json",
  }, { fetch: successfulFetchRecorder().fetch }),
  /GOOGLE_APPLICATION_CREDENTIALS static credential configuration is forbidden/,
);

await assert.rejects(
  () => createProductionGcpSecurityRuntime({
    ...validEnv(),
    CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE: "/tmp/gcloud-static-creds.json",
  }, { fetch: successfulFetchRecorder().fetch }),
  /CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE static credential configuration is forbidden/,
);

await assert.rejects(
  () => createProductionGcpSecurityRuntime({
    ...validEnv(),
    CAREPOINT_GCP_AUTH_MODE: "service-account-key",
  }, { fetch: successfulFetchRecorder().fetch }),
  /CAREPOINT_GCP_AUTH_MODE must be 'metadata-service'/,
);

await assert.rejects(
  () => createProductionGcpSecurityRuntime({
    ...validEnv(),
    CAREPOINT_GCP_KMS_ENDPOINT: "https:\/\/example.invalid",
  }, { fetch: successfulFetchRecorder().fetch }),
  /CAREPOINT_GCP_KMS_ENDPOINT endpoint overrides are forbidden/,
);

await assert.rejects(
  () => createProductionGcpSecurityRuntime(validEnv(), {
    fetch: async (input) => {
      const url = String(input);
      if (url.endsWith("/email")) {
        return response(`wrong-runtime@${projectId}.iam.gserviceaccount.com`, {
          headers: { "metadata-flavor": "Google" },
        });
      }
      throw new Error("unexpected call");
    },
  }),
  /runtime service-account identity does not match/,
);

await assert.rejects(
  () => createProductionGcpSecurityRuntime(validEnv(), {
    fetch: async (input) => {
      const url = String(input);
      if (url.endsWith("/email")) {
        return response(serviceAccountEmail);
      }
      throw new Error("unexpected call");
    },
  }),
  /missing the Google metadata trust marker/,
);

const leakingRuntime = await createProductionGcpSecurityRuntime(validEnv(), {
  fetch: async (input, init = {}) => {
    const url = String(input);
    if (url.endsWith("/email")) {
      return response(serviceAccountEmail, {
        headers: { "metadata-flavor": "Google" },
      });
    }
    if (url.endsWith("/token")) {
      return jsonResponse({
        access_token: "short-lived-runtime-token",
        expires_in: 3600,
        token_type: "Bearer",
      }, {
        headers: { "metadata-flavor": "Google" },
      });
    }
    assert.equal(init.headers?.Authorization, "Bearer short-lived-runtime-token");
    const parsed = new URL(url);
    assert.ok(approvedRegionalHosts.has(parsed.hostname));
    return response("TOP-SECRET-PROVIDER-BODY", { status: 500 });
  },
});
const firstDomain = productionKeyManagementContract(validEnv()).domains[0];
let providerError;
try {
  await leakingRuntime.inspectManagedKey(firstDomain);
} catch (error) {
  providerError = error;
}
assert.ok(providerError instanceof Error);
assert.match(providerError.message, /HTTP 500/);
assert.doesNotMatch(providerError.message, /TOP-SECRET-PROVIDER-BODY/);
await leakingRuntime.close();

const oversizedRuntime = await createProductionGcpSecurityRuntime(validEnv(), {
  fetch: async (input) => {
    const url = String(input);
    if (url.endsWith("/email")) {
      return response(serviceAccountEmail, {
        headers: { "metadata-flavor": "Google" },
      });
    }
    if (url.endsWith("/token")) {
      return jsonResponse({
        access_token: "short-lived-runtime-token",
        expires_in: 3600,
        token_type: "Bearer",
      }, {
        headers: { "metadata-flavor": "Google" },
      });
    }
    const parsed = new URL(url);
    if (parsed.hostname === kmsHost) {
      return response("x".repeat(1024 * 1024 + 1), {
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error("unexpected call");
  },
});
await assert.rejects(
  () => oversizedRuntime.inspectManagedKey(firstDomain),
  /response exceeds the permitted size/,
);
await oversizedRuntime.close();

console.log("R3 GCP keyless regional security runtime smoke passed");
