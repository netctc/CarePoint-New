import test from "node:test";
import assert from "node:assert/strict";
import {
  OtherProviderFamilies,
  assertDoctorRole,
  assertOtherProviderFamily,
  assertValidEmergencyLocation,
} from "../dist/index.js";

test("other provider taxonomy never includes doctors", () => {
  assert.equal(OtherProviderFamilies.includes("DOCTOR"), false);
  assert.throws(() => assertOtherProviderFamily("DOCTOR"));
});

test("doctor app boundary accepts only doctor role", () => {
  assert.doesNotThrow(() => assertDoctorRole("DOCTOR"));
  assert.throws(() => assertDoctorRole("OTHER_PROVIDER"));
});

test("emergency location is validated", () => {
  assert.doesNotThrow(() => assertValidEmergencyLocation(33.8938, 35.5018));
  assert.throws(() => assertValidEmergencyLocation(100, 35.5));
});
