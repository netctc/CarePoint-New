import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  createProductionGcpCloudSqlInspectionRuntime,
} = require("../dist/infrastructure/prisma/gcp-cloud-sql-inspection-runtime.js");
const {
  assertProductionGcpCloudSqlReady,
} = require("../dist/infrastructure/prisma/production-gcp-cloud-sql-preflight.js");

const region = "me-central2";
const projectId = "carepoint-r1";
const instanceId = "carepoint-prod-db";
const serviceAccountEmail = `carepoint-runtime@${projectId}.iam.gserviceaccount.com`;
const sqlAdminHost = "sqladmin.googleapis.com";

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
    CAREPOINT_GCP_CLOUD_SQL_INSTANCE: instanceId,
    DATABASE_MIN_SERVER_MAJOR: "16",
  };
}

function validInspection(overrides = {}) {
  return {
    projectId,
    instanceId,
    region,
    state: "RUNNABLE",
    databaseVersion: "POSTGRES_16",
    availabilityType: "REGIONAL",
    backupEnabled: true,
    pointInTimeRecoveryEnabled: true,
    publicIpv4Enabled: false,
    privateNetworkConfigured: true,
    pscEnabled: false,
    sslMode: "ENCRYPTED_ONLY",
    requireSsl: false,
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
          access_token: "short-lived-cloud-sql-token",
          expires_in: 3600,
          token_type: "Bearer",
        }, { headers: { "metadata-flavor": "Google" } });
      }
    }

    assert.equal(url.protocol, "https:");
    assert.equal(url.hostname, sqlAdminHost);
    assert.equal(url.pathname, `/sql/v1beta4/projects/${projectId}/instances/${instanceId}`);
    assert.equal(url.search, "");
    assert.equal(url.hash, "");
    assert.equal(init.method, "GET");
    assert.equal(init.headers?.Authorization, "Bearer short-lived-cloud-sql-token");
    assert.equal(init.redirect, "error");
    assert.ok(init.signal);

    return jsonResponse({
      project: projectId,
      name: instanceId,
      region,
      state: "RUNNABLE",
      databaseVersion: "POSTGRES_16",
      settings: {
        availabilityType: "REGIONAL",
        backupConfiguration: {
          enabled: true,
          pointInTimeRecoveryEnabled: true,
        },
        ipConfiguration: {
          ipv4Enabled: false,
          privateNetwork: `projects/${projectId}/global/networks/carepoint-prod`,
          sslMode: "ENCRYPTED_ONLY",
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

assert.equal(await createProductionGcpCloudSqlInspectionRuntime({ NODE_ENV: "test" }), null);
assert.equal(
  await createProductionGcpCloudSqlInspectionRuntime({ NODE_ENV: "production", CAREPOINT_CLOUD_PROVIDER: "oci" }),
  null,
);

const recorder = successfulFetchRecorder();
const runtime = await createProductionGcpCloudSqlInspectionRuntime(validEnv(), {
  fetch: recorder.fetch,
  now: () => 1_700_000_000_000,
});
assert.ok(runtime);
assert.equal(runtime.serviceAccountEmail, serviceAccountEmail);
const inspection = await runtime.inspectInstance();
assert.deepEqual(inspection, validInspection());
await runtime.inspectInstance();
assert.equal(recorder.tokenCalls, 1, "Cloud SQL runtime must cache only the short-lived metadata token in memory");
await runtime.close();

await assertProductionGcpCloudSqlReady(validEnv(), {
  inspectInstance: async () => validInspection(),
});

for (const [overrides, expected] of [
  [{ region: "me-central1" }, /must remain in 'me-central2'/],
  [{ state: "MAINTENANCE" }, /must be RUNNABLE/],
  [{ databaseVersion: "POSTGRES_15" }, /major version must be >= 16/],
  [{ availabilityType: "ZONAL" }, /REGIONAL high availability/],
  [{ backupEnabled: false }, /enable automated backups/],
  [{ pointInTimeRecoveryEnabled: false }, /enable point-in-time recovery/],
  [{ publicIpv4Enabled: true }, /disable public IPv4/],
  [{ privateNetworkConfigured: false, pscEnabled: false }, /private networking or Private Service Connect/],
  [{ sslMode: "ALLOW_UNENCRYPTED_AND_ENCRYPTED", requireSsl: false }, /must enforce TLS/],
]) {
  await assert.rejects(
    assertProductionGcpCloudSqlReady(validEnv(), {
      inspectInstance: async () => validInspection(overrides),
    }),
    expected,
  );
}

await assert.rejects(
  () => createProductionGcpCloudSqlInspectionRuntime({
    ...validEnv(),
    GOOGLE_APPLICATION_CREDENTIALS: "/tmp/static-service-account.json",
  }, { fetch: successfulFetchRecorder().fetch }),
  /GOOGLE_APPLICATION_CREDENTIALS static credential configuration is forbidden/,
);
await assert.rejects(
  () => createProductionGcpCloudSqlInspectionRuntime({
    ...validEnv(),
    CAREPOINT_GCP_SQLADMIN_ENDPOINT: "https://example.invalid",
  }, { fetch: successfulFetchRecorder().fetch }),
  /CAREPOINT_GCP_SQLADMIN_ENDPOINT endpoint overrides are forbidden/,
);
await assert.rejects(
  () => createProductionGcpCloudSqlInspectionRuntime(validEnv(), {
    fetch: async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/email")) {
        return response(`wrong-runtime@${projectId}.iam.gserviceaccount.com`, {
          headers: { "metadata-flavor": "Google" },
        });
      }
      throw new Error("unexpected call");
    },
  }),
  /runtime service-account identity does not match/,
);

const leakingRuntime = await createProductionGcpCloudSqlInspectionRuntime(validEnv(), {
  fetch: async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/email")) {
      return response(serviceAccountEmail, { headers: { "metadata-flavor": "Google" } });
    }
    if (url.pathname.endsWith("/token")) {
      return jsonResponse({
        access_token: "short-lived-cloud-sql-token",
        expires_in: 3600,
        token_type: "Bearer",
      }, { headers: { "metadata-flavor": "Google" } });
    }
    return response("TOP-SECRET-PROVIDER-BODY", { status: 500 });
  },
});
await assert.rejects(
  leakingRuntime.inspectInstance(),
  /HTTP 500/,
);
try {
  await leakingRuntime.inspectInstance();
} catch (error) {
  assert.doesNotMatch(error.message, /TOP-SECRET-PROVIDER-BODY/);
}
await leakingRuntime.close();

const mainSource = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
assert.match(mainSource, /assertProductionGcpCloudSqlReady/);
assert.ok(
  mainSource.indexOf("await assertProductionGcpCloudSqlReady()") < mainSource.indexOf("await assertProductionDatabaseReady()"),
  "GCP Cloud SQL control-plane preflight must execute before the live PostgreSQL SQL-level preflight",
);
assert.ok(
  mainSource.indexOf("await assertProductionDatabaseReady()") < mainSource.indexOf("NestFactory.create"),
  "Cloud SQL and SQL-level database preflights must execute before Nest application creation",
);

console.log("R3 GCP Cloud SQL production preflight smoke passed");
