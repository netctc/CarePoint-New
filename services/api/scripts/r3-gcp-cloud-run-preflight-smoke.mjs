import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  createProductionGcpCloudRunInspectionRuntime,
} = require("../dist/infrastructure/cloud/gcp-cloud-run-inspection-runtime.js");
const {
  assertProductionGcpCloudRunReady,
} = require("../dist/infrastructure/cloud/production-gcp-cloud-run-preflight.js");

const region = "me-central2";
const projectId = "carepoint-r1";
const serviceId = "carepoint-api";
const serviceAccountEmail = `api-runtime@${projectId}.iam.gserviceaccount.com`;
const network = "carepoint-r1-vpc";
const subnetwork = "carepoint-r1-app-me-central2";

function configureGcpProduction() {
  Object.assign(process.env, {
    NODE_ENV: "production",
    CAREPOINT_CLOUD_PROVIDER: "gcp",
    CAREPOINT_RESIDENCY_JURISDICTION: "SA",
    CAREPOINT_APPROVED_DATA_REGIONS: region,
    CAREPOINT_PRIMARY_REGION: region,
    GCP_REGION: region,
    GCP_PROJECT_ID: projectId,
    CAREPOINT_GCP_AUTH_MODE: "metadata-service",
    CAREPOINT_GCP_SERVICE_ACCOUNT_EMAIL: serviceAccountEmail,
    CAREPOINT_GCP_CLOUD_RUN_SERVICE: serviceId,
    CAREPOINT_GCP_CLOUD_RUN_NETWORK: network,
    CAREPOINT_GCP_CLOUD_RUN_SUBNETWORK: subnetwork,
    CAREPOINT_GCP_CLOUD_RUN_VPC_EGRESS: "PRIVATE_RANGES_ONLY",
    K_SERVICE: serviceId,
    K_CONFIGURATION: serviceId,
    K_REVISION: `${serviceId}-00042-abc`,
    PORT: "8080",
  });
  for (const name of [
    "CAREPOINT_DR_REGION",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE",
    "GOOGLE_GHA_CREDS_PATH",
    "CAREPOINT_GCP_ACCESS_TOKEN",
    "GCP_ACCESS_TOKEN",
    "GOOGLE_API_KEY",
    "CAREPOINT_GCP_RUN_ENDPOINT",
    "GOOGLE_CLOUD_RUN_ENDPOINT",
    "RUN_EMULATOR_HOST",
  ]) delete process.env[name];
}

function serviceResource(overrides = {}) {
  const base = {
    name: `projects/${projectId}/locations/${region}/services/${serviceId}`,
    ingress: "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER",
    invokerIamDisabled: false,
    template: {
      serviceAccount: serviceAccountEmail,
      vpcAccess: {
        egress: "PRIVATE_RANGES_ONLY",
        networkInterfaces: [{ network, subnetwork }],
      },
    },
  };
  return {
    ...base,
    ...overrides,
    template: overrides.template ?? base.template,
  };
}

function fakeFetch(resource = serviceResource(), calls = []) {
  return async (input, init = {}) => {
    const url = input instanceof URL ? input : new URL(String(input));
    calls.push({ url: url.toString(), init });

    if (url.hostname === "metadata.google.internal") {
      assert.equal(url.protocol, "http:");
      assert.equal(url.port, "");
      assert.equal(new Headers(init.headers).get("metadata-flavor"), "Google");
      if (url.pathname.endsWith("/email")) {
        return new Response(serviceAccountEmail, {
          status: 200,
          headers: { "Metadata-Flavor": "Google" },
        });
      }
      if (url.pathname.endsWith("/token")) {
        return new Response(JSON.stringify({
          access_token: "gcp-cloud-run-smoke-token",
          token_type: "Bearer",
          expires_in: 3600,
        }), {
          status: 200,
          headers: { "Metadata-Flavor": "Google", "Content-Type": "application/json" },
        });
      }
      return new Response("not found", { status: 404, headers: { "Metadata-Flavor": "Google" } });
    }

    assert.equal(url.protocol, "https:");
    assert.equal(url.hostname, "run.googleapis.com");
    assert.equal(url.port, "");
    assert.equal(url.pathname, `/v2/projects/${projectId}/locations/${region}/services/${serviceId}`);
    assert.equal(url.search, "");
    assert.equal(url.hash, "");
    assert.equal(new Headers(init.headers).get("authorization"), "Bearer gcp-cloud-run-smoke-token");
    return new Response(JSON.stringify(resource), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
}

process.env.NODE_ENV = "test";
let bypassCalls = 0;
await assertProductionGcpCloudRunReady(process.env, {
  inspectService: async () => {
    bypassCalls += 1;
    throw new Error("unexpected");
  },
});
assert.equal(bypassCalls, 0, "non-production Cloud Run preflight must bypass provider inspection");

configureGcpProduction();
const calls = [];
const runtime = await createProductionGcpCloudRunInspectionRuntime(process.env, {
  fetch: fakeFetch(serviceResource(), calls),
  now: () => 1_700_000_000_000,
});
assert.ok(runtime, "GCP production must create the Cloud Run inspection runtime");
const inspection = await runtime.inspectService();
assert.deepEqual(inspection, {
  projectId,
  region,
  serviceId,
  serviceAccountEmail,
  ingress: "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER",
  invokerIamDisabled: false,
  vpcEgress: "PRIVATE_RANGES_ONLY",
  vpcConnector: "",
  vpcNetwork: network,
  vpcSubnetwork: subnetwork,
});
await runtime.close();
assert.equal(calls.filter((call) => new URL(call.url).hostname === "run.googleapis.com").length, 1);

configureGcpProduction();
await assert.doesNotReject(
  assertProductionGcpCloudRunReady(process.env, { inspectService: async () => inspection }),
);

for (const [field, value, pattern] of [
  ["GOOGLE_APPLICATION_CREDENTIALS", "/tmp/service-account.json", /static credential configuration is forbidden/],
  ["CAREPOINT_GCP_ACCESS_TOKEN", "static-token", /static credential configuration is forbidden/],
  ["CAREPOINT_GCP_RUN_ENDPOINT", "https://example.invalid", /endpoint overrides are forbidden/],
]) {
  configureGcpProduction();
  process.env[field] = value;
  await assert.rejects(
    createProductionGcpCloudRunInspectionRuntime(process.env, { fetch: fakeFetch() }),
    pattern,
  );
}

configureGcpProduction();
process.env.K_SERVICE = "other-service";
await assert.rejects(
  createProductionGcpCloudRunInspectionRuntime(process.env, { fetch: fakeFetch() }),
  /K_SERVICE must match CAREPOINT_GCP_CLOUD_RUN_SERVICE/,
);

configureGcpProduction();
process.env.K_REVISION = "unrelated-revision";
await assert.rejects(
  createProductionGcpCloudRunInspectionRuntime(process.env, { fetch: fakeFetch() }),
  /K_REVISION must identify a valid revision/,
);

const negativeInspections = [
  [{ ...inspection, region: "us-central1" }, /must remain in 'me-central2'/],
  [{ ...inspection, serviceAccountEmail: `other@${projectId}.iam.gserviceaccount.com` }, /revision service account does not match/],
  [{ ...inspection, ingress: "INGRESS_TRAFFIC_ALL" }, /production ingress must be INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER/],
  [{ ...inspection, invokerIamDisabled: true }, /must keep the Cloud Run Invoker IAM check enabled/],
  [{ ...inspection, vpcConnector: `projects/${projectId}/locations/${region}/connectors/legacy` }, /must use Direct VPC egress/],
  [{ ...inspection, vpcNetwork: "other-network" }, /Direct VPC network does not match/],
  [{ ...inspection, vpcSubnetwork: "other-subnetwork" }, /Direct VPC subnetwork does not match/],
  [{ ...inspection, vpcEgress: "ALL_TRAFFIC" }, /VPC egress does not match/],
];
for (const [candidate, pattern] of negativeInspections) {
  configureGcpProduction();
  await assert.rejects(
    assertProductionGcpCloudRunReady(process.env, { inspectService: async () => candidate }),
    pattern,
  );
}

configureGcpProduction();
process.env.CAREPOINT_GCP_CLOUD_RUN_VPC_EGRESS = "UNSPECIFIED";
await assert.rejects(
  assertProductionGcpCloudRunReady(process.env, { inspectService: async () => inspection }),
  /must be PRIVATE_RANGES_ONLY or ALL_TRAFFIC/,
);

configureGcpProduction();
const failedRuntime = await createProductionGcpCloudRunInspectionRuntime(process.env, {
  fetch: async (input, init = {}) => {
    const url = input instanceof URL ? input : new URL(String(input));
    if (url.hostname === "metadata.google.internal") {
      if (url.pathname.endsWith("/email")) {
        return new Response(serviceAccountEmail, { status: 200, headers: { "Metadata-Flavor": "Google" } });
      }
      return new Response(JSON.stringify({
        access_token: "gcp-cloud-run-smoke-token",
        token_type: "Bearer",
        expires_in: 3600,
      }), { status: 200, headers: { "Metadata-Flavor": "Google" } });
    }
    assert.equal(new Headers(init.headers).get("authorization"), "Bearer gcp-cloud-run-smoke-token");
    return new Response("provider-secret-must-not-leak", { status: 500 });
  },
});
assert.ok(failedRuntime);
await assert.rejects(
  failedRuntime.inspectService(),
  (error) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /HTTP 500/);
    assert.doesNotMatch(error.message, /provider-secret-must-not-leak/);
    return true;
  },
);
await failedRuntime.close();

const mainSource = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
assert.match(mainSource, /assertProductionGcpCloudRunReady/);
assert.ok(
  mainSource.indexOf("await assertProductionGcpCloudRunReady()") < mainSource.indexOf("NestFactory.create"),
  "GCP Cloud Run preflight must execute before Nest application creation",
);

console.log("R3 GCP Cloud Run runtime/edge production preflight smoke passed");
