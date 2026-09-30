import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  productionObjectStorageContract,
} = require("../dist/infrastructure/cloud/production-object-storage.js");
const {
  createProductionGcpObjectStorageInspectionRuntime,
} = require("../dist/infrastructure/cloud/gcp-object-storage-inspection-runtime.js");
const {
  assertProductionGcpObjectStorageReady,
} = require("../dist/infrastructure/security/production-gcp-object-storage-preflight.js");

const region = "me-central2";
const projectId = "carepoint-r1";
const serviceAccountEmail = `carepoint-runtime@${projectId}.iam.gserviceaccount.com`;
const keyRing = `projects/${projectId}/locations/${region}/keyRings/carepoint-r1`;
const documentKey = `${keyRing}/cryptoKeys/clinical-documents`;
const documentBucket = "carepoint-r1-clinical";
const bulkBucket = "carepoint-r1-bulk";
const metadataHost = "metadata.google.internal";
const storageHost = "storage.googleapis.com";

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

function inspectionFor(domain, overrides = {}) {
  return {
    provider: "gcp-cloud-storage",
    region,
    bucketRef: domain.bucketRef,
    publicAccessDisabled: true,
    customerManagedEncryption: true,
    kmsKeyRef: domain.kmsKeyRef,
    uniformBucketLevelAccessEnabled: true,
    lifecycleRules: domain.label === "fhir-bulk-export"
      ? [{
          actionType: "Delete",
          ageDays: 1,
          isLive: true,
          matchesPrefix: [domain.prefix],
          unsupportedConditions: [],
        }]
      : [],
    ...overrides,
  };
}

{
  const config = env();
  let calls = 0;
  await assertProductionGcpObjectStorageReady(config, {
    inspectBucket: async (domain) => {
      calls += 1;
      return inspectionFor(domain);
    },
  });
  assert.equal(calls, 2);
}

async function rejectsPreflight(pattern, mutate) {
  const config = env();
  const contract = productionObjectStorageContract(config);
  assert.ok(contract);
  await assert.rejects(
    () => assertProductionGcpObjectStorageReady(config, {
      inspectBucket: async (domain) => mutate(domain, inspectionFor(domain)),
    }),
    pattern,
  );
}

await rejectsPreflight(/public access disabled/, (_domain, inspection) => ({ ...inspection, publicAccessDisabled: false }));
await rejectsPreflight(/customer-managed encryption/, (_domain, inspection) => ({ ...inspection, customerManagedEncryption: false }));
await rejectsPreflight(/encryption key does not match/, (_domain, inspection) => ({ ...inspection, kmsKeyRef: `${keyRing}/cryptoKeys/wrong` }));
await rejectsPreflight(/uniform bucket-level access/, (_domain, inspection) => ({ ...inspection, uniformBucketLevelAccessEnabled: false }));
await rejectsPreflight(/Delete lifecycle rule/, (domain, inspection) => domain.label === "fhir-bulk-export" ? { ...inspection, lifecycleRules: [] } : inspection);
await rejectsPreflight(/Delete lifecycle rule/, (domain, inspection) => domain.label === "fhir-bulk-export" ? {
  ...inspection,
  lifecycleRules: [{
    actionType: "Delete",
    ageDays: 1,
    isLive: false,
    matchesPrefix: [domain.prefix],
    unsupportedConditions: [],
  }],
} : inspection);
await rejectsPreflight(/Delete lifecycle rule/, (domain, inspection) => domain.label === "fhir-bulk-export" ? {
  ...inspection,
  lifecycleRules: [{
    actionType: "Delete",
    ageDays: 1,
    isLive: true,
    matchesPrefix: [domain.prefix],
    unsupportedConditions: ["matchesStorageClass"],
  }],
} : inspection);

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

function fakeFetch(options = {}) {
  const calls = [];
  let emailCalls = 0;
  let tokenCalls = 0;
  let bucketCalls = 0;
  return {
    calls,
    get emailCalls() { return emailCalls; },
    get tokenCalls() { return tokenCalls; },
    get bucketCalls() { return bucketCalls; },
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
          access_token: "short-lived-inspection-token",
          expires_in: 3600,
          token_type: "Bearer",
        }, {
          headers: { "metadata-flavor": "Google" },
        });
      }

      assert.equal(url.hostname, storageHost);
      assert.match(url.pathname, /^\/storage\/v1\/b\//);
      assert.equal(init.method, "GET");
      assert.equal(new Headers(init.headers).get("authorization"), "Bearer short-lived-inspection-token");
      assert.ok(url.searchParams.get("fields")?.includes("publicAccessPrevention"));
      assert.ok(url.searchParams.get("fields")?.includes("uniformBucketLevelAccess"));
      assert.ok(url.searchParams.get("fields")?.includes("lifecycle"));
      assert.equal(init.redirect, "error");
      assert.ok(init.signal);
      bucketCalls += 1;

      if (options.httpStatus) {
        return response("PROVIDER-BUCKET-BODY-MUST-NOT-ESCAPE", { status: options.httpStatus });
      }

      const bucket = decodeURIComponent(url.pathname.split("/").at(-1));
      return jsonResponse({
        name: bucket,
        location: options.location ?? region.toUpperCase(),
        iamConfiguration: {
          publicAccessPrevention: options.publicAccessPrevention ?? "enforced",
          uniformBucketLevelAccess: { enabled: options.uniformBucketLevelAccess ?? true },
        },
        encryption: {
          defaultKmsKeyName: options.kmsKeyRef ?? documentKey,
        },
        lifecycle: bucket === bulkBucket
          ? {
              rule: [{
                action: { type: "Delete" },
                condition: options.lifecycleCondition ?? {
                  age: 1,
                  isLive: true,
                  matchesPrefix: ["carepoint/bulk-export"],
                },
              }],
            }
          : undefined,
      });
    },
  };
}

{
  const config = env();
  const fake = fakeFetch();
  const runtime = await createProductionGcpObjectStorageInspectionRuntime(config, {
    fetch: fake.fetch,
    now: () => 1_700_000_000_000,
  });
  assert.ok(runtime);
  const contract = productionObjectStorageContract(config);
  assert.ok(contract);
  const document = await runtime.inspectBucket(contract.domains[0]);
  const bulk = await runtime.inspectBucket(contract.domains[1]);
  assert.equal(document.bucketRef, documentBucket);
  assert.equal(document.region, region);
  assert.equal(document.publicAccessDisabled, true);
  assert.equal(document.uniformBucketLevelAccessEnabled, true);
  assert.equal(document.kmsKeyRef, documentKey);
  assert.equal(bulk.lifecycleRules[0]?.actionType, "Delete");
  assert.equal(bulk.lifecycleRules[0]?.ageDays, 1);
  assert.deepEqual(bulk.lifecycleRules[0]?.matchesPrefix, ["carepoint/bulk-export"]);
  assert.deepEqual(bulk.lifecycleRules[0]?.unsupportedConditions, []);
  assert.equal(fake.emailCalls, 1);
  assert.equal(fake.tokenCalls, 1, "inspection runtime should cache the short-lived metadata token");
  assert.equal(fake.bucketCalls, 2);
  await runtime.close();
  await assert.rejects(() => runtime.inspectBucket(contract.domains[0]), /runtime is closed/);
}

await assert.rejects(
  () => createProductionGcpObjectStorageInspectionRuntime({
    ...env(),
    GOOGLE_APPLICATION_CREDENTIALS: "/tmp/key.json",
  }, { fetch: fakeFetch().fetch }),
  /static credential configuration is forbidden/,
);

await assert.rejects(
  () => createProductionGcpObjectStorageInspectionRuntime({
    ...env(),
    STORAGE_EMULATOR_HOST: "http://127.0.0.1:4443",
  }, { fetch: fakeFetch().fetch }),
  /endpoint overrides are forbidden/,
);

{
  const fake = fakeFetch({ httpStatus: 503 });
  const runtime = await createProductionGcpObjectStorageInspectionRuntime(env(), { fetch: fake.fetch });
  const contract = productionObjectStorageContract(env());
  let failure;
  try {
    await runtime.inspectBucket(contract.domains[0]);
  } catch (error) {
    failure = error;
  }
  assert.ok(failure instanceof Error);
  assert.match(failure.message, /HTTP 503/);
  assert.doesNotMatch(failure.message, /PROVIDER-BUCKET-BODY-MUST-NOT-ESCAPE/);
}

console.log("R3 GCP Cloud Storage production preflight smoke passed");
