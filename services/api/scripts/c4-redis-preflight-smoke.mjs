import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { assertProductionRedisReady } = require("../dist/infrastructure/redis/production-redis-preflight.js");

function configureProduction() {
  process.env.NODE_ENV = "production";
  process.env.REDIS_URL = "rediss://default:carepoint-test-password@redis.internal:6379";
  process.env.REDIS_CONNECT_TIMEOUT_MS = "3000";
  process.env.REDIS_MIN_REPLICAS = "1";
  process.env.REDIS_PERSISTENCE_MODE = "managed";
  delete process.env.REDIS_TLS_REJECT_UNAUTHORIZED;
}

function validInspection(overrides = {}) {
  return {
    ping: "PONG",
    role: "master",
    connectedReplicas: 1,
    clusterEnabled: false,
    aofEnabled: false,
    aofLastWriteStatus: "ok",
    rdbLastSaveTime: 1_700_000_000,
    rdbLastBgsaveStatus: "ok",
    writeProbeVerified: true,
    ...overrides,
  };
}

async function accept(inspection = validInspection()) {
  configureProduction();
  let calls = 0;
  await assertProductionRedisReady({
    inspectRedis: async (connection) => {
      calls += 1;
      assert.match(connection.url, /^rediss:/);
      assert.equal(connection.options.enableOfflineQueue, false);
      assert.equal(connection.options.maxRetriesPerRequest, 1);
      assert.equal(connection.options.enableReadyCheck, true);
      return structuredClone(inspection);
    },
  });
  assert.equal(calls, 1);
}

async function expectReject(pattern, mutate, inspection = validInspection()) {
  configureProduction();
  mutate();
  await assert.rejects(
    () => assertProductionRedisReady({ inspectRedis: async () => structuredClone(inspection) }),
    pattern,
  );
}

process.env.NODE_ENV = "test";
delete process.env.REDIS_URL;
let nonProductionCalls = 0;
await assertProductionRedisReady({
  inspectRedis: async () => {
    nonProductionCalls += 1;
    return validInspection();
  },
});
assert.equal(nonProductionCalls, 0, "non-production Redis preflight must not connect");

await accept();

await expectReject(/REDIS_URL is required/, () => { delete process.env.REDIS_URL; });
await expectReject(/valid Redis URL/, () => { process.env.REDIS_URL = "not-a-url"; });
await expectReject(/must use rediss:\/\/ TLS/, () => { process.env.REDIS_URL = "redis://default:test@redis.internal:6379"; });
await expectReject(/must include Redis authentication credentials/, () => { process.env.REDIS_URL = "rediss://redis.internal:6379"; });
await expectReject(/must not target a local loopback host/, () => { process.env.REDIS_URL = "rediss://default:test@127.0.0.1:6379"; });
await expectReject(/certificate verification is forbidden/, () => { process.env.REDIS_TLS_REJECT_UNAUTHORIZED = "false"; });
await expectReject(/REDIS_CONNECT_TIMEOUT_MS must be a positive integer/, () => { process.env.REDIS_CONNECT_TIMEOUT_MS = "0"; });
await expectReject(/REDIS_MIN_REPLICAS must be a non-negative integer/, () => { process.env.REDIS_MIN_REPLICAS = "-1"; });
await expectReject(/REDIS_PERSISTENCE_MODE must be explicitly set/, () => { delete process.env.REDIS_PERSISTENCE_MODE; });
await expectReject(/REDIS_PERSISTENCE_MODE must be explicitly set/, () => { process.env.REDIS_PERSISTENCE_MODE = "unknown"; });

await expectReject(/successful PING/, () => {}, validInspection({ ping: "NOPE" }));
await expectReject(/writable master/, () => {}, validInspection({ role: "slave" }));
await expectReject(/write\/read\/delete probe failed/, () => {}, validInspection({ writeProbeVerified: false }));
await expectReject(/Cluster mode is not supported/, () => {}, validInspection({ clusterEnabled: true }));
await expectReject(/at least 1 connected replica/, () => {}, validInspection({ connectedReplicas: 0 }));

configureProduction();
process.env.REDIS_MIN_REPLICAS = "0";
await assertProductionRedisReady({ inspectRedis: async () => validInspection({ connectedReplicas: 0 }) });

configureProduction();
process.env.REDIS_PERSISTENCE_MODE = "aof";
await assertProductionRedisReady({ inspectRedis: async () => validInspection({ aofEnabled: true, aofLastWriteStatus: "ok" }) });
await expectReject(
  /aof_enabled=1/,
  () => { process.env.REDIS_PERSISTENCE_MODE = "aof"; },
  validInspection({ aofEnabled: false }),
);
await expectReject(
  /AOF last write status is 'err'/,
  () => { process.env.REDIS_PERSISTENCE_MODE = "aof"; },
  validInspection({ aofEnabled: true, aofLastWriteStatus: "err" }),
);

configureProduction();
process.env.REDIS_PERSISTENCE_MODE = "rdb";
await assertProductionRedisReady({ inspectRedis: async () => validInspection({ rdbLastSaveTime: 1_700_000_000, rdbLastBgsaveStatus: "ok" }) });
await expectReject(
  /valid rdb_last_save_time/,
  () => { process.env.REDIS_PERSISTENCE_MODE = "rdb"; },
  validInspection({ rdbLastSaveTime: 0 }),
);
await expectReject(
  /RDB last background-save status is 'err'/,
  () => { process.env.REDIS_PERSISTENCE_MODE = "rdb"; },
  validInspection({ rdbLastBgsaveStatus: "err" }),
);

configureProduction();
await assert.rejects(
  () => assertProductionRedisReady({ inspectRedis: async () => { throw new Error("Connection refused"); } }),
  /could not verify Redis readiness: Connection refused/,
);

configureProduction();
let redactedError;
try {
  await assertProductionRedisReady({
    inspectRedis: async () => {
      throw new Error(`dial ${process.env.REDIS_URL} password=carepoint-test-password`);
    },
  });
} catch (error) {
  redactedError = error;
}
assert.ok(redactedError instanceof Error);
assert.doesNotMatch(redactedError.message, /carepoint-test-password/);
assert.doesNotMatch(redactedError.message, /rediss:\/\//);
assert.match(redactedError.message, /<redis-url>/);

console.log("Phase C4 production Redis readiness acceptance passed");
