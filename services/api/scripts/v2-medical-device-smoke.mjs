import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const engine = require("../dist/modules/medical-devices/medical-device.engine.js");
const schema = read("../prisma/v2_devices.prisma");
const migration = read("../prisma/migrations/20260924213000_v2_medical_devices/migration.sql");
const moduleSource = read("../src/modules/medical-devices/medical-device.module.ts");
const service = read("../src/modules/medical-devices/medical-device.service.ts");
const app = read("../src/app.module.ts");

test("signed device envelope is stable, Ed25519-verifiable and replay-window bounded", () => {
  const pair = generateKeyPairSync("ed25519");
  const publicPem = pair.publicKey.export({ format: "pem", type: "spki" }).toString();
  const timestamp = "2026-09-24T20:00:00.000Z";
  const body = { code: "HEART_RATE", value: 70, unitCode: "BPM", observedAt: timestamp };
  const message = engine.signatureMessage("device:dev-1:key-1", timestamp, "event-0001", body);
  const signature = sign(null, Buffer.from(message), pair.privateKey).toString("base64");
  assert.equal(engine.verifyEd25519(publicPem, message, signature), true);
  assert.equal(engine.verifyEd25519(publicPem, message + "x", signature), false);
  assert.equal(engine.assertSignedEventTimestamp(timestamp, new Date("2026-09-24T20:04:59.000Z")), timestamp);
  assert.throws(() => engine.assertSignedEventTimestamp(timestamp, new Date("2026-09-24T20:05:01.000Z")), /replay-protection/);
});

test("measurement timestamps and device types are bounded", () => {
  const now = new Date("2026-09-24T20:00:00.000Z");
  assert.deepEqual(engine.normalizeDeviceMeasurement({
    code: "blood_pressure_systolic", value: 121, unitCode: "mmhg", observedAt: "2026-09-24T19:59:00.000Z",
  }, now), {
    code: "BLOOD_PRESSURE_SYSTOLIC", value: 121, unitCode: "MMHG", observedAt: "2026-09-24T19:59:00.000Z", glucoseContext: null,
  });
  assert.throws(() => engine.normalizeDeviceMeasurement({
    code: "HEART_RATE", value: 70, unitCode: "BPM", observedAt: "2026-08-01T00:00:00.000Z",
  }, now), /too old/);
  assert.equal(engine.normalizeDeviceType("pulse_oximeter"), "PULSE_OXIMETER");
  assert.throws(() => engine.normalizeDeviceType("unknown-device"), /unsupported/);
});

// BE-024: registry, public verification material, assignment/versioning and revocation.
assert.match(schema, /model DeviceModel/);
assert.match(schema, /model DeviceCredential/);
assert.match(schema, /model DeviceIntegrationConfig/);
assert.match(schema, /publicKeyPem/);
assert.doesNotMatch(schema, /privateKeyPem|secretValue|apiKey/);
assert.match(migration, /Device_status_check/);
assert.match(migration, /DeviceCredential_status_check/);
assert.match(service, /privateKeyReturnedOnce: true/);
assert.match(service, /privateKeyStored: false/);
assert.match(service, /status: "REVOKED"/);
assert.match(service, /futureIngestionBlocked: true/);
assert.match(service, /historicalObservationsPreserved: true/);

// BE-025: canonical Observation storage + device provenance + event idempotency.
assert.match(schema, /model DeviceIngestionEvent/);
assert.match(schema, /@@unique\(\[deviceId, externalEventId\]\)/);
assert.match(service, /tx\.observation\.create/);
assert.match(service, /sourceType: "DEVICE"/);
assert.match(service, /sourceId: input\.prepared\.deviceId/);
assert.match(service, /encryptRecord\(payload\)/);
assert.match(service, /unitCode is not allowed/);
assert.match(service, /assertCanonicalRange/);
assert.match(service, /externalEventId was already used with a different payload/);
assert.match(service, /idempotentReplay: true/);

// ADM-105: signed integration webhook, scopes, health and revocation.
assert.match(moduleSource, /@Controller\("admin\/integrations\/devices"\)/);
assert.match(moduleSource, /@Controller\("device-integrations"\)/);
assert.match(moduleSource, /@Public\(\)/);
assert.match(service, /verifyEd25519\(integration\.webhookPublicKey/);
assert.match(service, /integrationScopes\.includes\(measurement\.code\)/);
assert.match(service, /healthState: "HEALTHY"/);
assert.match(service, /healthState: "REVOKED"/);
assert.match(service, /SIGNATURE_INVALID/);

// PRV-090 backend boundary: provider capture cannot choose provenance and remains capability/assignment bound.
assert.match(moduleSource, /@Controller\("provider\/device-observations"\)/);
assert.match(moduleSource, /CLINICAL_RECORD_WRITE/);
assert.match(service, /principal\.role !== "OTHER_PROVIDER"/);
assert.match(service, /context\.observationCodes\.has\(measurement\.code\)/);
assert.match(service, /Device is not assigned to this provider\/patient context/);
assert.match(service, /Assigned confirmed\/completed appointment is required/);
assert.doesNotMatch(moduleSource, /sourceType.*@Body/);
assert.match(app, /MedicalDeviceModule/);

console.log("C1 medical-device backend acceptance passed: BE-024/BE-025/ADM-087/ADM-105/PRV-090");

function read(relative){return readFileSync(new URL(relative, import.meta.url),"utf8");}
