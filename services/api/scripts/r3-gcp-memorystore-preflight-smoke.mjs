import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
const {
  createProductionGcpMemorystoreInspectionRuntime,
} = require("../dist/infrastructure/redis/gcp-memorystore-inspection-runtime.js");
const {
  assertProductionGcpMemorystoreReady,
} = require("../dist/infrastructure/redis/production-gcp-memorystore-preflight.js");
const {
  redisRuntimeConnection,
} = require("../dist/infrastructure/redis/redis-production-config.js");

const region = "me-central2";
const projectId = "carepoint-r1";
const instanceId = "carepoint-redis";
const network = `projects/${projectId}/global/networks/carepoint-prod`;
const serviceAccountEmail = `carepoint-runtime@${projectId}.iam.gserviceaccount.com`;
const host = "10.20.0.5";
const port = 6378;
const resourceName = `projects/${projectId}/locations/${region}/instances/${instanceId}`;
const redisApiHost = "redis.googleapis.com";

function validEnv(caFile = "/tmp/carepoint-memorystore-ca.pem") {
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
    CAREPOINT_GCP_REDIS_INSTANCE: instanceId,
    CAREPOINT_GCP_REDIS_NETWORK: network,
    CAREPOINT_GCP_REDIS_MIN_MAJOR: "7",
    REDIS_URL: `rediss://default:runtime-test-secret@${host}:${port}`,
    REDIS_PERSISTENCE_MODE: "managed",
    REDIS_CONNECT_TIMEOUT_MS: "3000",
    REDIS_MIN_REPLICAS: "1",
    REDIS_TLS_CA_FILE: caFile,
  };
}

function instanceResource(overrides = {}) {
  return {
    name: resourceName,
    state: "READY",
    tier: "STANDARD_HA",
    redisVersion: "REDIS_7_2",
    authEnabled: true,
    transitEncryptionMode: "SERVER_AUTHENTICATION",
    connectMode: "PRIVATE_SERVICE_ACCESS",
    authorizedNetwork: network,
    locationId: `${region}-a`,
    alternativeLocationId: `${region}-b`,
    replicaCount: 1,
    nodes: [
      { id: "node-0", zone: `${region}-a` },
      { id: "node-1", zone: `${region}-b` },
    ],
    host,
    port,
    serverCaCerts: [{
      cert: "-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----\n",
      serialNumber: "01",
    }],
    ...overrides,
  };
}

function textResponse(value, options = {}) {
  return new Response(value, {
    status: options.status ?? 200,
    headers: options.headers ?? {},
  });
}

function jsonResponse(value, options = {}) {
  return textResponse(JSON.stringify(value), {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers ?? {}),
    },
  });
}

function successfulFetch(resource = instanceResource()) {
  const calls = [];
  let tokenCalls = 0;
  const fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    calls.push({ url: url.toString(), init });

    if (url.hostname === "metadata.google.internal") {
      assert.equal(url.protocol, "http:");
      assert.equal(init.headers?.["Metadata-Flavor"], "Google");
      if (url.pathname.endsWith("/email")) {
        return textResponse(serviceAccountEmail, { headers: { "metadata-flavor": "Google" } });
      }
      if (url.pathname.endsWith("/token")) {
        tokenCalls += 1;
        return jsonResponse({
          access_token: "short-lived-memorystore-token",
          expires_in: 3600,
          token_type: "Bearer",
        }, { headers: { "metadata-flavor": "Google" } });
      }
      throw new Error("unexpected metadata path");
    }

    assert.equal(url.protocol, "https:");
    assert.equal(url.hostname, redisApiHost);
    assert.equal(url.pathname, `/v1/projects/${projectId}/locations/${region}/instances/${instanceId}`);
    assert.equal(url.search, "");
    assert.equal(url.hash, "");
    assert.equal(init.headers?.Authorization, "Bearer short-lived-memorystore-token");
    assert.equal(init.redirect, "error");
    assert.ok(init.signal);
    return jsonResponse(resource);
  };
  return {
    fetch,
    calls,
    get tokenCalls() {
      return tokenCalls;
    },
  };
}

assert.equal(await createProductionGcpMemorystoreInspectionRuntime({ NODE_ENV: "test" }), null);
assert.equal(await createProductionGcpMemorystoreInspectionRuntime({ NODE_ENV: "production", CAREPOINT_CLOUD_PROVIDER: "oci" }), null);

const runtimeRecorder = successfulFetch();
const runtime = await createProductionGcpMemorystoreInspectionRuntime(validEnv(), {
  fetch: runtimeRecorder.fetch,
  now: () => 1_700_000_000_000,
});
assert.ok(runtime);
assert.equal(runtime.serviceAccountEmail, serviceAccountEmail);
const liveInspection = await runtime.inspectInstance();
assert.equal(liveInspection.projectId, projectId);
assert.equal(liveInspection.instanceId, instanceId);
assert.equal(liveInspection.region, region);
assert.equal(liveInspection.tier, "STANDARD_HA");
assert.deepEqual(liveInspection.nodeZones, [`${region}-a`, `${region}-b`]);
assert.equal(liveInspection.serverCaCertCount, 1);
assert.equal(runtimeRecorder.tokenCalls, 1);
await runtime.inspectInstance();
assert.equal(runtimeRecorder.tokenCalls, 1, "metadata access token should be reused while valid");
await runtime.close();

let nonProductionCalls = 0;
await assertProductionGcpMemorystoreReady({ NODE_ENV: "test" }, {
  inspectInstance: async () => {
    nonProductionCalls += 1;
    return liveInspection;
  },
});
assert.equal(nonProductionCalls, 0);

await assertProductionGcpMemorystoreReady(validEnv(), {
  inspectInstance: async () => structuredClone(liveInspection),
});

await assertProductionGcpMemorystoreReady(validEnv(), {
  inspectInstance: async () => ({
    ...structuredClone(liveInspection),
    nodeZones: [],
    locationId: `${region}-a`,
    alternativeLocationId: `${region}-b`,
  }),
});

async function rejectWith(pattern, envOverrides = {}, inspectionOverrides = {}) {
  await assert.rejects(
    () => assertProductionGcpMemorystoreReady({ ...validEnv(), ...envOverrides }, {
      inspectInstance: async () => ({ ...structuredClone(liveInspection), ...inspectionOverrides }),
    }),
    pattern,
  );
}

await rejectWith(/must remain in 'me-central2'/, {}, { region: "me-central1" });
await rejectWith(/must be READY/, {}, { state: "MAINTENANCE" });
await rejectWith(/STANDARD_HA/, {}, { tier: "BASIC" });
await rejectWith(/at least one replica/, {}, { replicaCount: 0 });
await rejectWith(/enable Redis AUTH/, {}, { authEnabled: false });
await rejectWith(/SERVER_AUTHENTICATION TLS/, {}, { transitEncryptionMode: "DISABLED" });
await rejectWith(/server CA certificate/, {}, { serverCaCertCount: 0 });
await rejectWith(/PRIVATE_SERVICE_ACCESS/, {}, { connectMode: "DIRECT_PEERING" });
await rejectWith(/authorized network/, {}, { authorizedNetwork: `projects/${projectId}/global/networks/other` });
await rejectWith(/at least two distinct Dammam zones/, {}, { nodeZones: [`${region}-a`] });
await rejectWith(/nodes must remain inside/, {}, { nodeZones: [`${region}-a`, "me-central1-a"] });
await rejectWith(/at least two distinct Dammam zones/, {}, {
  nodeZones: [],
  locationId: `${region}-a`,
  alternativeLocationId: `${region}-a`,
});
await rejectWith(/Redis major version must be >= 7/, {}, { redisVersion: "REDIS_6_X" });
await rejectWith(/host does not match/, { REDIS_URL: "rediss://default:test@10.20.0.6:6378" });
await rejectWith(/port does not match/, { REDIS_URL: `rediss://default:test@${host}:6379` });
await rejectWith(
  /secure port 6378/,
  { REDIS_URL: `rediss://default:test@${host}:6379` },
  { port: 6379 },
);
await rejectWith(/REDIS_PERSISTENCE_MODE=managed/, { REDIS_PERSISTENCE_MODE: "rdb" });
await rejectWith(/REDIS_TLS_CA_FILE is required/, { REDIS_TLS_CA_FILE: "" });

await assert.rejects(
  () => createProductionGcpMemorystoreInspectionRuntime({
    ...validEnv(),
    GOOGLE_APPLICATION_CREDENTIALS: "/tmp/static-key.json",
  }, { fetch: successfulFetch().fetch }),
  /GOOGLE_APPLICATION_CREDENTIALS static credential configuration is forbidden/,
);
await assert.rejects(
  () => createProductionGcpMemorystoreInspectionRuntime({
    ...validEnv(),
    CAREPOINT_GCP_REDIS_API_ENDPOINT: "https://example.invalid",
  }, { fetch: successfulFetch().fetch }),
  /endpoint overrides are forbidden/,
);
await assert.rejects(
  () => createProductionGcpMemorystoreInspectionRuntime(validEnv(), {
    fetch: async (input) => {
      const url = new URL(String(input));
      if (url.hostname === "metadata.google.internal" && url.pathname.endsWith("/email")) {
        return textResponse(`wrong-runtime@${projectId}.iam.gserviceaccount.com`, {
          headers: { "metadata-flavor": "Google" },
        });
      }
      throw new Error("unexpected call");
    },
  }),
  /runtime service-account identity does not match/,
);

const tempDir = await mkdtemp(join(tmpdir(), "carepoint-gcp-redis-"));
try {
  const caFile = join(tempDir, "memorystore-ca.pem");
  await writeFile(
    caFile,
    "-----BEGIN CERTIFICATE-----\nTEST-CA\n-----END CERTIFICATE-----\n",
    { mode: 0o644 },
  );
  const connection = redisRuntimeConnection(validEnv(caFile));
  assert.ok(connection);
  assert.equal(connection.options.tls?.rejectUnauthorized, true);
  assert.equal(connection.options.tls?.minVersion, "TLSv1.2");
  assert.match(String(connection.options.tls?.ca), /BEGIN CERTIFICATE/);

  assert.throws(
    () => redisRuntimeConnection(validEnv("relative-ca.pem")),
    /must be an absolute mounted-file path/,
  );
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

const mainSource = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
assert.match(mainSource, /assertProductionGcpMemorystoreReady/);
assert.ok(
  mainSource.indexOf("await assertProductionGcpMemorystoreReady()")
    < mainSource.indexOf("await assertProductionRedisReady()"),
  "GCP Memorystore control-plane preflight must execute before the live Redis data-plane probe",
);
assert.ok(
  mainSource.indexOf("await assertProductionRedisReady()") < mainSource.indexOf("NestFactory.create"),
  "Redis readiness must remain fail-closed before Nest application creation",
);

console.log("R3 GCP Memorystore HA/TLS production preflight smoke passed");
