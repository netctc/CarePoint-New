import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  createProductionGcpObjectStorageRuntime,
} = require("../dist/infrastructure/cloud/gcp-object-storage-runtime.js");

const region = "me-central2";
const projectId = "carepoint-r1";
const serviceAccountEmail = `carepoint-runtime@${projectId}.iam.gserviceaccount.com`;
const keyRing = `projects/${projectId}/locations/${region}/keyRings/carepoint-r1`;
const documentKey = `${keyRing}/cryptoKeys/clinical-documents`;
const documentBucket = "carepoint-r1-clinical";
const bulkBucket = "carepoint-r1-bulk";
const metadataHost = "metadata.google.internal";
const storageHost = "storage.googleapis.com";

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
    CAREPOINT_OBJECT_STORAGE_PROVIDER: "gcp-cloud-storage",
    CAREPOINT_OBJECT_STORAGE_REGION: region,
    CAREPOINT_DOCUMENT_BUCKET_REF: documentBucket,
    CAREPOINT_DOCUMENT_STORAGE_KEY_REF: documentKey,
    CAREPOINT_DOCUMENT_STORAGE_PREFIX: "carepoint/clinical",
    CAREPOINT_BULK_EXPORT_BUCKET_REF: bulkBucket,
    CAREPOINT_BULK_EXPORT_STORAGE_KEY_REF: documentKey,
    CAREPOINT_BULK_EXPORT_PREFIX: "carepoint/bulk-export",
    BULK_EXPORT_RETENTION_SECONDS: "86400",
  };
}

function response(body, options = {}) {
  return new Response(body, {
    status: options.status ?? 200,
    headers: options.headers ?? {},
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

function recorder(options = {}) {
  const calls = [];
  let emailCalls = 0;
  let tokenCalls = 0;
  const stored = new Map();

  return {
    calls,
    get emailCalls() { return emailCalls; },
    get tokenCalls() { return tokenCalls; },
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
          access_token: options.token ?? "short-lived-storage-token",
          expires_in: options.expiresIn ?? 3600,
          token_type: options.tokenType ?? "Bearer",
        }, {
          headers: { "metadata-flavor": "Google" },
        });
      }

      assert.equal(url.hostname, storageHost);
      assert.equal(url.protocol, "https:");
      assert.equal(url.search, "");
      assert.equal(url.hash, "");
      assert.equal(init.redirect, "error");
      assert.ok(init.signal, "Cloud Storage calls require timeout signals");
      const headers = new Headers(init.headers);
      assert.equal(headers.get("authorization"), "Bearer short-lived-storage-token");

      if (options.httpStatus) {
        return response("PROVIDER-STORAGE-BODY-MUST-NOT-ESCAPE", { status: options.httpStatus });
      }

      const objectPath = decodeURIComponent(url.pathname);
      if (init.method === "PUT") {
        const body = Buffer.from(init.body);
        assert.equal(headers.get("content-length"), String(body.byteLength));
        assert.equal(headers.get("content-md5"), createHash("md5").update(body).digest("base64"));
        assert.equal(headers.get("cache-control"), "no-store");
        assert.equal(headers.get("x-goog-encryption-kms-key-name"), documentKey);
        stored.set(objectPath, body.toString("utf8"));
        return response(null);
      }
      if (init.method === "GET") {
        if (options.oversizedGet) {
          return response("x", { headers: { "content-length": String(64 * 1024 * 1024 + 1) } });
        }
        return response(stored.get(objectPath) ?? "", {
          headers: { "content-type": "application/octet-stream" },
        });
      }
      if (init.method === "DELETE") {
        stored.delete(objectPath);
        return response(null, { status: 204 });
      }
      throw new Error(`Unexpected Cloud Storage request: ${init.method} ${objectPath}`);
    },
  };
}

assert.equal(await createProductionGcpObjectStorageRuntime({ NODE_ENV: "test" }), null);
assert.equal(
  await createProductionGcpObjectStorageRuntime({ NODE_ENV: "production", CAREPOINT_CLOUD_PROVIDER: "oci" }),
  null,
);

{
  const fake = recorder();
  const runtime = await createProductionGcpObjectStorageRuntime(validEnv(), {
    fetch: fake.fetch,
    now: () => 1_700_000_000_000,
  });
  assert.ok(runtime);

  await runtime.putString("clinical-documents", "patient/record.enc", "ciphertext", {
    contentType: "application/octet-stream",
    metadata: { carepoint: "clinical-document", encrypted: "true" },
  });
  const documentPut = fake.calls.find((call) => call.init.method === "PUT");
  assert.ok(documentPut);
  assert.equal(
    decodeURIComponent(new URL(documentPut.url).pathname),
    `/${documentBucket}/carepoint/clinical/patient/record.enc`,
  );
  const documentHeaders = new Headers(documentPut.init.headers);
  assert.equal(documentHeaders.get("x-goog-meta-carepoint"), "clinical-document");
  assert.equal(documentHeaders.get("x-goog-meta-encrypted"), "true");
  assert.equal(await runtime.getString("clinical-documents", "patient/record.enc"), "ciphertext");
  await runtime.delete("clinical-documents", "patient/record.enc");

  await runtime.putString("fhir-bulk-export", "export/1.ndjson", "{\"resourceType\":\"Patient\"}\n", {
    contentType: "application/fhir+ndjson",
    metadata: { carepoint: "fhir-bulk-export", expiresat: "2026-09-17T00:00:00Z" },
  });
  const bulkPut = fake.calls.filter((call) => call.init.method === "PUT")[1];
  assert.ok(bulkPut);
  assert.equal(
    decodeURIComponent(new URL(bulkPut.url).pathname),
    `/${bulkBucket}/carepoint/bulk-export/export/1.ndjson`,
  );
  const bulkHeaders = new Headers(bulkPut.init.headers);
  assert.equal(bulkHeaders.get("content-type"), "application/fhir+ndjson");
  assert.equal(bulkHeaders.get("x-goog-meta-carepoint"), "fhir-bulk-export");
  assert.equal(await runtime.getString("fhir-bulk-export", "export/1.ndjson"), "{\"resourceType\":\"Patient\"}\n");

  assert.equal(fake.emailCalls, 1, "runtime identity should be validated once");
  assert.equal(fake.tokenCalls, 1, "metadata access token should be cached in memory");

  await assert.rejects(
    () => runtime.putString("clinical-documents", "../escape", "x"),
    /Unsafe GCP Cloud Storage object key/,
  );
  await runtime.close();
  await assert.rejects(
    () => runtime.getString("clinical-documents", "patient/record.enc"),
    /runtime is closed/,
  );
}

await assert.rejects(
  () => createProductionGcpObjectStorageRuntime({
    ...validEnv(),
    GOOGLE_APPLICATION_CREDENTIALS: "/tmp/static-key.json",
  }, { fetch: recorder().fetch }),
  /GOOGLE_APPLICATION_CREDENTIALS static credential configuration is forbidden/,
);

await assert.rejects(
  () => createProductionGcpObjectStorageRuntime({
    ...validEnv(),
    CAREPOINT_GCP_STORAGE_ENDPOINT: "https://example.invalid",
  }, { fetch: recorder().fetch }),
  /CAREPOINT_GCP_STORAGE_ENDPOINT endpoint overrides are forbidden/,
);

await assert.rejects(
  () => createProductionGcpObjectStorageRuntime({
    ...validEnv(),
    CAREPOINT_GCP_AUTH_MODE: "service-account-key",
  }, { fetch: recorder().fetch }),
  /CAREPOINT_GCP_AUTH_MODE must be 'metadata-service'/,
);

await assert.rejects(
  () => createProductionGcpObjectStorageRuntime({
    ...validEnv(),
    CAREPOINT_DOCUMENT_STORAGE_KEY_REF: `projects/other-project/locations/${region}/keyRings/carepoint-r1/cryptoKeys/clinical-documents`,
  }, { fetch: recorder().fetch }),
  /CMEK must belong to GCP_PROJECT_ID/,
);

{
  const fake = recorder({ email: `wrong-runtime@${projectId}.iam.gserviceaccount.com` });
  const runtime = await createProductionGcpObjectStorageRuntime(validEnv(), { fetch: fake.fetch });
  await assert.rejects(
    () => runtime.putString("clinical-documents", "record.enc", "ciphertext"),
    /runtime service-account identity does not match/,
  );
}

{
  const fake = recorder({ httpStatus: 503 });
  const runtime = await createProductionGcpObjectStorageRuntime(validEnv(), { fetch: fake.fetch });
  let providerError;
  try {
    await runtime.putString("clinical-documents", "record.enc", "ciphertext");
  } catch (error) {
    providerError = error;
  }
  assert.ok(providerError instanceof Error);
  assert.match(providerError.message, /HTTP 503/);
  assert.doesNotMatch(providerError.message, /PROVIDER-STORAGE-BODY-MUST-NOT-ESCAPE/);
}

{
  const fake = recorder({ oversizedGet: true });
  const runtime = await createProductionGcpObjectStorageRuntime(validEnv(), { fetch: fake.fetch });
  await assert.rejects(
    () => runtime.getString("clinical-documents", "record.enc"),
    /response exceeds the permitted size/,
  );
}

console.log("R3 GCP Cloud Storage runtime smoke passed");
