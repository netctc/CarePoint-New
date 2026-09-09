import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  assertProductionEmergencyAmbulanceReady,
  emergencyAmbulanceLaunchConfiguration,
  emergencyAmbulanceModuleEnabled,
} = require("../dist/modules/emergency/emergency-launch-policy.js");

function cleanEnv() {
  for (const name of [
    "EMERGENCY_AMBULANCE_ENABLED",
    "EMERGENCY_AMBULANCE_JURISDICTION",
    "EMERGENCY_AMBULANCE_LICENSED_OPERATOR_REF",
    "EMERGENCY_AMBULANCE_LOCAL_APPROVAL_REF",
    "EMERGENCY_AMBULANCE_24X7_SUPPORT_CONFIRMED",
  ]) delete process.env[name];
}

const original = { ...process.env };

try {
  cleanEnv();
  process.env.NODE_ENV = "test";
  assert.equal(emergencyAmbulanceModuleEnabled(process.env), true, "non-production keeps the emergency module available for test/dev acceptance");

  process.env.EMERGENCY_AMBULANCE_ENABLED = "false";
  assert.equal(emergencyAmbulanceModuleEnabled(process.env), false);

  process.env.EMERGENCY_AMBULANCE_ENABLED = "invalid";
  assert.throws(() => emergencyAmbulanceModuleEnabled(process.env), /must be explicitly set to 'true' or 'false'/);

  cleanEnv();
  process.env.NODE_ENV = "production";
  assert.equal(emergencyAmbulanceModuleEnabled(process.env), false, "production must default emergency ambulance to disabled");
  assert.doesNotThrow(() => assertProductionEmergencyAmbulanceReady(process.env));

  process.env.EMERGENCY_AMBULANCE_ENABLED = "true";
  assert.throws(
    () => assertProductionEmergencyAmbulanceReady(process.env),
    /EMERGENCY_AMBULANCE_JURISDICTION/,
  );

  process.env.EMERGENCY_AMBULANCE_JURISDICTION = "KSA";
  assert.throws(
    () => assertProductionEmergencyAmbulanceReady(process.env),
    /EMERGENCY_AMBULANCE_LICENSED_OPERATOR_REF/,
  );

  process.env.EMERGENCY_AMBULANCE_LICENSED_OPERATOR_REF = "restricted-evidence:operator-approval";
  assert.throws(
    () => assertProductionEmergencyAmbulanceReady(process.env),
    /EMERGENCY_AMBULANCE_LOCAL_APPROVAL_REF/,
  );

  process.env.EMERGENCY_AMBULANCE_LOCAL_APPROVAL_REF = "restricted-evidence:local-clinical-legal-approval";
  assert.throws(
    () => assertProductionEmergencyAmbulanceReady(process.env),
    /EMERGENCY_AMBULANCE_24X7_SUPPORT_CONFIRMED=true/,
  );

  process.env.EMERGENCY_AMBULANCE_24X7_SUPPORT_CONFIRMED = "true";
  assert.doesNotThrow(() => assertProductionEmergencyAmbulanceReady(process.env));
  const approved = emergencyAmbulanceLaunchConfiguration(process.env);
  assert.deepEqual(approved, {
    enabled: true,
    jurisdiction: "KSA",
    licensedOperatorRef: "restricted-evidence:operator-approval",
    localApprovalRef: "restricted-evidence:local-clinical-legal-approval",
    support24x7Confirmed: true,
  });
  assert.equal(emergencyAmbulanceModuleEnabled(process.env), true);

  process.env.EMERGENCY_AMBULANCE_LOCAL_APPROVAL_REF = "bad\nreference";
  assert.throws(() => assertProductionEmergencyAmbulanceReady(process.env), /single-line values/);

  console.log("R9 emergency ambulance launch gate acceptance passed");
} finally {
  for (const key of Object.keys(process.env)) {
    if (!(key in original)) delete process.env[key];
  }
  Object.assign(process.env, original);
}
