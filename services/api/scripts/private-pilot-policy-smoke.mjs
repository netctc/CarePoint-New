import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
const { carePointRuntimeFeatures } = require("../dist/infrastructure/release/private-pilot-policy.js");

const disabledPilot = {
  NODE_ENV: "production",
  CAREPOINT_PRIVATE_PILOT: "true",
  CAREPOINT_PATIENT_SELF_REGISTRATION_ENABLED: "false",
  CAREPOINT_PAYMENTS_ENABLED: "false",
  CAREPOINT_TELEHEALTH_ENABLED: "false",
  CAREPOINT_EXTERNAL_NOTIFICATIONS_ENABLED: "false",
  EMERGENCY_AMBULANCE_ENABLED: "false",
  NOTIFICATION_GATEWAY_PROVIDER: "mock",
};

assert.deepEqual(carePointRuntimeFeatures({ NODE_ENV: "production" }), {
  privatePilot: false,
  patientSelfRegistration: true,
  payments: true,
  telehealth: true,
  externalNotifications: true,
});

assert.deepEqual(carePointRuntimeFeatures(disabledPilot), {
  privatePilot: true,
  patientSelfRegistration: false,
  payments: false,
  telehealth: false,
  externalNotifications: false,
});

assert.throws(
  () => carePointRuntimeFeatures({ ...disabledPilot, NODE_ENV: "test" }),
  /requires NODE_ENV=production/,
);
assert.throws(
  () => carePointRuntimeFeatures({ ...disabledPilot, CAREPOINT_PAYMENTS_ENABLED: "true" }),
  /CAREPOINT_PAYMENTS_ENABLED=false/,
);
assert.throws(
  () => carePointRuntimeFeatures({ ...disabledPilot, EMERGENCY_AMBULANCE_ENABLED: "true" }),
  /EMERGENCY_AMBULANCE_ENABLED=false/,
);
assert.throws(
  () => carePointRuntimeFeatures({ ...disabledPilot, NOTIFICATION_GATEWAY_PROVIDER: "external" }),
  /NOTIFICATION_GATEWAY_PROVIDER=mock/,
);

const appModule = await readFile(new URL("../src/app.module.ts", import.meta.url), "utf8");
assert.match(appModule, /runtimeFeatures\.payments \? \[BillingModule, ClaimsModule\] : \[\]/);
assert.match(appModule, /runtimeFeatures\.telehealth \? \[TelehealthModule\] : \[\]/);

const iamModule = await readFile(new URL("../src/modules/iam/iam.module.ts", import.meta.url), "utf8");
assert.match(iamModule, /patientSelfRegistration/);
assert.match(iamModule, /Patient self-registration is not available/);

await import("./v2-feature-policy-smoke.mjs");
console.log("Private pilot runtime policy acceptance passed");
