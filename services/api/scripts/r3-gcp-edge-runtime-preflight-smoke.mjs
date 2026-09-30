import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  createProductionGcpCloudRunInspectionRuntime,
} = require("../dist/infrastructure/http/gcp-cloud-run-inspection-runtime.js");
const {
  assertProductionGcpEdgeRuntimeReady,
} = require("../dist/infrastructure/http/production-gcp-edge-runtime-preflight.js");

const region = "me-central2";
const projectId = "carepoint-r1";
const serviceId = "carepoint-api";
const serviceAccountEmail = `carepoint-runtime@${projectId}.iam.gserviceaccount.com`;
const runHost = "run.googleapis.com";
const resourceName = `projects/${projectId}/locations/${region}/services/${serviceId}`;

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
    CAREPOINT_GCP_CLOUD_RUN_SERVICE: serviceId,
    CAREPOINT_GCP_EDGE_MODE: "external-application-load-balancer",
    CAREPOINT_PUBLIC_API_ORIGIN: "https://api.carepoint.example",
    ALLOWED_ORIGINS: "https://admin.carepoint.example,https://patient.carepoint.example",
    TRUST_PROXY: "true",
  };
}

function validInspection(overrides = {}) {
  return {
    resourceName,
    projectId,
    region,
    serviceId,
    ingress: "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER",
    defaultUriDisabled: true,
    reconciling: false,
    terminalState: "CONDITION_SUCCEEDED",
    serviceAccountEmail,
    minInstanceCount: 1,
    cpuIdle: false,
    privateVpcConfigured: true,
    vpcEgress: "PRIVATE_RANGES_ONLY",
    ...overrides,
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

function successfulFetchRecorder() {
  const calls = [];
  let tokenCalls = 0;
  const fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });

    if (url.hostname === "metadata.google.internal") {
      assert.equal(url.protocol, "http:");
      assert.equal(init.headers?.["Metadata-Flavor"], "Google");
      if (url.pathname.endsWith("/email")) {
        return response(serviceAccountEmail, { headers: { "metadata-flavor": "Google" } });
      }
      if (url.pathname.endsWith("/token")) {
        tokenCalls += 1;
        return jsonResponse({
          access_token: "short-lived-cloud-run-token",
          expires_in: 3600,
          token_type: "Bearer",
        }, { headers: { "metadata-flavor": "Google" } });
      }
    }

    assert.equal(url.protocol, "https:");
    assert.equal(url.hostname, runHost);
    assert.equal(url.pathname, `/v2/projects/${projectId}/locations/${region}/services/${serviceId}`);
    assert.equal(url.search, "");
    assert.equal(url.hash, "");
    assert.equal(init.method, "GET");
    assert.equal(init.headers?.Authorization, "Bearer short-lived-cloud-run-token");
    assert.equal(init.redirect, "error");
    assert.ok(init.signal);

    return jsonResponse({
      name: resourceName,
      ingress: "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER",
      defaultUriDisabled: true,
      reconciling: false,
      terminalCondition: { state: "CONDITION_SUCCEEDED" },
      scaling: { minInstanceCount: 1 },
      template: {
        serviceAccount: serviceAccountEmail,
        containers: [{ resources: { cpuIdle: false } }],
        vpcAccess: {
          connector: `projects/${projectId}/locations/${region}/connectors/carepoint-prod`,
          egress: "PRIVATE_RANGES_ONLY",
        },
      },
    });
  };
  return {
    fetch,
    calls,
    get tokenCalls() {
      return tokenCalls;
    },
  };
}

assert.equal(await createProductionGcpCloudRunInspectionRuntime({ NODE_ENV: "test" }), null);
assert.equal(
  await createProductionGcpCloudRunInspectionRuntime({ NODE_ENV: "production", CAREPOINT_CLOUD_PROVIDER: "oci" }),
  null,
);

const recorder = successfulFetchRecorder();
const runtime = await createProductionGcpCloudRunInspectionRuntime(validEnv(), {
  fetch: recorder.fetch,
  now: () => 1_700_000_000_000,
});
assert.ok(runtime);
assert.equal(runtime.serviceAccountEmail, serviceAccountEmail);
assert.deepEqual(await runtime.inspectService(), validInspection());
await runtime.inspectService();
assert.equal(recorder.tokenCalls, 1, "Cloud Run runtime must cache only the short-lived metadata token in memory");
await runtime.close();

await assertProductionGcpEdgeRuntimeReady(validEnv(), {
  inspectService: async () => validInspection(),
});

for (const [envOverrides, expected] of [
  [{ CAREPOINT_GCP_EDGE_MODE: "direct" }, /CAREPOINT_GCP_EDGE_MODE/],
  [{ TRUST_PROXY: "false" }, /TRUST_PROXY must be true/],
  [{ CAREPOINT_PUBLIC_API_ORIGIN: "https://carepoint-r1-me-central2.run.app" }, /not run\.app/],
  [{ ALLOWED_ORIGINS: "http://admin.carepoint.example" }, /HTTPS in production/],
]) {
  await assert.rejects(
    assertProductionGcpEdgeRuntimeReady({ ...validEnv(), ...envOverrides }, {
      inspectService: async () => validInspection(),
    }),
    expected,
  );
}

for (const [overrides, expected] of [
  [{ region: "me-central1" }, /outside the approved production project\/region\/service identity/],
  [{ reconciling: true }, /still reconciling/],
  [{ terminalState: "CONDITION_FAILED" }, /successful terminal condition/],
  [{ ingress: "INGRESS_TRAFFIC_ALL" }, /internal-and-cloud-load-balancing/],
  [{ defaultUriDisabled: false }, /default run\.app URI must be disabled/],
  [{ serviceAccountEmail: `other-runtime@${projectId}.iam.gserviceaccount.com` }, /revision identity must match/],
  [{ minInstanceCount: 0 }, /at least one warm service instance/],
  [{ cpuIdle: true }, /instance-based CPU allocation/],
  [{ cpuIdle: null }, /instance-based CPU allocation/],
  [{ privateVpcConfigured: false }, /requires VPC egress/],
  [{ vpcEgress: "VPC_EGRESS_UNSPECIFIED" }, /must cover private database\/cache traffic/],
]) {
  await assert.rejects(
    assertProductionGcpEdgeRuntimeReady(validEnv(), {
      inspectService: async () => validInspection(overrides),
    }),
    expected,
  );
}

await assert.rejects(
  () => createProductionGcpCloudRunInspectionRuntime({
    ...validEnv(),
    GOOGLE_APPLICATION_CREDENTIALS: "/tmp/static-service-account.json",
  }, { fetch: successfulFetchRecorder().fetch }),
  /GOOGLE_APPLICATION_CREDENTIALS static credential configuration is forbidden/,
);
await assert.rejects(
  () => createProductionGcpCloudRunInspectionRuntime({
    ...validEnv(),
    CAREPOINT_GCP_RUN_ENDPOINT: "https://example.invalid",
  }, { fetch: successfulFetchRecorder().fetch }),
  /CAREPOINT_GCP_RUN_ENDPOINT endpoint overrides are forbidden/,
);

const leakingRuntime = await createProductionGcpCloudRunInspectionRuntime(validEnv(), {
  fetch: async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/email")) {
      return response(serviceAccountEmail, { headers: { "metadata-flavor": "Google" } });
    }
    if (url.pathname.endsWith("/token")) {
      return jsonResponse({
        access_token: "short-lived-cloud-run-token",
        expires_in: 3600,
        token_type: "Bearer",
      }, { headers: { "metadata-flavor": "Google" } });
    }
    return response("TOP-SECRET-PROVIDER-BODY", { status: 500 });
  },
});
await assert.rejects(leakingRuntime.inspectService(), /HTTP 500/);
try {
  await leakingRuntime.inspectService();
} catch (error) {
  assert.doesNotMatch(error.message, /TOP-SECRET-PROVIDER-BODY/);
}
await leakingRuntime.close();

const mainSource = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
assert.match(mainSource, /assertProductionGcpEdgeRuntimeReady/);
assert.ok(
  mainSource.indexOf("await assertProductionGcpEdgeRuntimeReady()") < mainSource.indexOf("NestFactory.create"),
  "GCP Cloud Run edge/runtime preflight must execute before Nest application creation",
);

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
assert.equal(packageJson.scripts["r3:gcp-edge-runtime-preflight"], "node scripts/r3-gcp-edge-runtime-preflight-smoke.mjs");
assert.ok(packageJson.scripts.test.includes("r3:gcp-edge-runtime-preflight"));

console.log("R3 GCP Cloud Run edge/runtime preflight smoke passed");
