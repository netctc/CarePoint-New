import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { assertProductionDatabaseReady } = require("../dist/infrastructure/prisma/production-database-preflight.js");

function configureProduction() {
  process.env.NODE_ENV = "production";
  process.env.DATABASE_URL = "postgresql://carepoint:carepoint-test-password@db.internal:5432/carepoint?schema=public&sslmode=verify-full&connection_limit=10";
  process.env.DATABASE_POOL_MODE = "direct";
  process.env.DATABASE_HA_MODE = "managed";
  process.env.DATABASE_PITR_MODE = "managed";
  process.env.DATABASE_MIN_SERVER_MAJOR = "16";
  process.env.DATABASE_MIN_STREAMING_REPLICAS = "1";
}

function validInspection(overrides = {}) {
  return {
    serverVersionNum: 160005,
    sslActive: true,
    sslVersion: "TLSv1.3",
    sslCipher: "TLS_AES_256_GCM_SHA384",
    inRecovery: false,
    transactionReadOnly: false,
    walLevel: "replica",
    archiveMode: "off",
    archiveCommandConfigured: false,
    streamingReplicas: 0,
    ...overrides,
  };
}

async function accept(inspection = validInspection()) {
  configureProduction();
  let calls = 0;
  await assertProductionDatabaseReady({
    inspectDatabase: async (configuration) => {
      calls += 1;
      assert.match(configuration.url, /^postgresql:/);
      assert.equal(configuration.poolMode, "direct");
      assert.equal(configuration.haMode, "managed");
      assert.equal(configuration.pitrMode, "managed");
      assert.equal(configuration.connectionLimit, 10);
      return structuredClone(inspection);
    },
  });
  assert.equal(calls, 1);
}

async function expectReject(pattern, mutate, inspection = validInspection()) {
  configureProduction();
  mutate();
  await assert.rejects(
    () => assertProductionDatabaseReady({ inspectDatabase: async () => structuredClone(inspection) }),
    pattern,
  );
}

process.env.NODE_ENV = "test";
delete process.env.DATABASE_URL;
let nonProductionCalls = 0;
await assertProductionDatabaseReady({
  inspectDatabase: async () => {
    nonProductionCalls += 1;
    return validInspection();
  },
});
assert.equal(nonProductionCalls, 0, "non-production database preflight must not connect");

await accept();

await expectReject(/DATABASE_URL is required/, () => { delete process.env.DATABASE_URL; });
await expectReject(/valid PostgreSQL URL/, () => { process.env.DATABASE_URL = "not-a-url"; });
await expectReject(/postgresql:\/\/ or postgres:\/\//, () => { process.env.DATABASE_URL = "mysql://user:password@db.internal/carepoint"; });
await expectReject(/must include database authentication credentials/, () => {
  process.env.DATABASE_URL = "postgresql://db.internal:5432/carepoint?sslmode=verify-full&connection_limit=10";
});
await expectReject(/must not target a local loopback host/, () => {
  process.env.DATABASE_URL = "postgresql://carepoint:test@127.0.0.1:5432/carepoint?sslmode=verify-full&connection_limit=10";
});
await expectReject(/must set sslmode=/, () => {
  process.env.DATABASE_URL = "postgresql://carepoint:test@db.internal:5432/carepoint?connection_limit=10";
});
await expectReject(/must not disable PostgreSQL TLS certificate validation/, () => {
  process.env.DATABASE_URL = "postgresql://carepoint:test@db.internal:5432/carepoint?sslmode=require&sslaccept=accept_invalid_certs&connection_limit=10";
});
await expectReject(/must set an explicit positive connection_limit/, () => {
  process.env.DATABASE_URL = "postgresql://carepoint:test@db.internal:5432/carepoint?sslmode=verify-full";
});
await expectReject(/connection_limit must be a positive integer/, () => {
  process.env.DATABASE_URL = "postgresql://carepoint:test@db.internal:5432/carepoint?sslmode=verify-full&connection_limit=0";
});
await expectReject(/DATABASE_POOL_MODE must be explicitly set/, () => { delete process.env.DATABASE_POOL_MODE; });
await expectReject(/DATABASE_HA_MODE must be explicitly set/, () => { delete process.env.DATABASE_HA_MODE; });
await expectReject(/DATABASE_PITR_MODE must be explicitly set/, () => { delete process.env.DATABASE_PITR_MODE; });
await expectReject(/pgbouncer=true/, () => { process.env.DATABASE_POOL_MODE = "pgbouncer"; });

configureProduction();
process.env.DATABASE_POOL_MODE = "pgbouncer";
process.env.DATABASE_URL += "&pgbouncer=true";
await assertProductionDatabaseReady({ inspectDatabase: async () => validInspection() });

await expectReject(/DATABASE_MIN_SERVER_MAJOR must be a positive integer/, () => { process.env.DATABASE_MIN_SERVER_MAJOR = "0"; });
await expectReject(/DATABASE_MIN_STREAMING_REPLICAS must be a non-negative integer/, () => { process.env.DATABASE_MIN_STREAMING_REPLICAS = "-1"; });
await expectReject(/must negotiate TLS/, () => {}, validInspection({ sslActive: false }));
await expectReject(/writable PostgreSQL primary/, () => {}, validInspection({ inRecovery: true }));
await expectReject(/connection is read-only/, () => {}, validInspection({ transactionReadOnly: true }));
await expectReject(/server major version must be >= 16, got 15/, () => {}, validInspection({ serverVersionNum: 150012 }));

await expectReject(
  /requires at least 1 streaming replica/,
  () => { process.env.DATABASE_HA_MODE = "replicated"; },
  validInspection({ streamingReplicas: 0 }),
);
configureProduction();
process.env.DATABASE_HA_MODE = "replicated";
await assertProductionDatabaseReady({ inspectDatabase: async () => validInspection({ streamingReplicas: 1 }) });

await expectReject(
  /wal_level=replica or logical/,
  () => { process.env.DATABASE_PITR_MODE = "native"; },
  validInspection({ walLevel: "minimal", archiveMode: "on", archiveCommandConfigured: true }),
);
await expectReject(
  /archive_mode=on or always/,
  () => { process.env.DATABASE_PITR_MODE = "native"; },
  validInspection({ walLevel: "replica", archiveMode: "off", archiveCommandConfigured: true }),
);
await expectReject(
  /requires a configured PostgreSQL archive_command/,
  () => { process.env.DATABASE_PITR_MODE = "native"; },
  validInspection({ walLevel: "replica", archiveMode: "on", archiveCommandConfigured: false }),
);
configureProduction();
process.env.DATABASE_PITR_MODE = "native";
await assertProductionDatabaseReady({
  inspectDatabase: async () => validInspection({ walLevel: "replica", archiveMode: "on", archiveCommandConfigured: true }),
});

configureProduction();
await assert.rejects(
  () => assertProductionDatabaseReady({ inspectDatabase: async () => { throw new Error("Connection refused"); } }),
  /could not verify database readiness: Connection refused/,
);

configureProduction();
let redactedError;
try {
  await assertProductionDatabaseReady({
    inspectDatabase: async () => {
      throw new Error(`dial ${process.env.DATABASE_URL} password=carepoint-test-password user=carepoint`);
    },
  });
} catch (error) {
  redactedError = error;
}
assert.ok(redactedError instanceof Error);
assert.doesNotMatch(redactedError.message, /carepoint-test-password/);
assert.doesNotMatch(redactedError.message, /postgresql:\/\//);
assert.match(redactedError.message, /<database-url>/);

console.log("Phase C5 production PostgreSQL readiness acceptance passed");
