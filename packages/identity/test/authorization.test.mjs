import test from "node:test";
import assert from "node:assert/strict";
import { canActOnAccount, canOwnOnboarding, roleHasPermission } from "../dist/index.js";

test("patient cannot review providers", () => {
  assert.equal(roleHasPermission("PATIENT", "PROVIDER_REVIEW"), false);
});

test("admin can manage another account", () => {
  assert.equal(canActOnAccount({ accountId: "admin-1", role: "ADMIN", sessionId: "s-1" }, "user-2"), true);
});

test("doctor can own only their own onboarding", () => {
  const principal = { accountId: "doctor-1", role: "DOCTOR", sessionId: "s-1" };
  assert.equal(canOwnOnboarding(principal, "doctor-1"), true);
  assert.equal(canOwnOnboarding(principal, "doctor-2"), false);
});

test("providers can manage services and availability but patients cannot", () => {
  for (const role of ["DOCTOR", "OTHER_PROVIDER"]) {
    assert.equal(roleHasPermission(role, "PROVIDER_MANAGE_SERVICES"), true);
    assert.equal(roleHasPermission(role, "PROVIDER_MANAGE_AVAILABILITY"), true);
  }
  assert.equal(roleHasPermission("PATIENT", "PROVIDER_MANAGE_SERVICES"), false);
});

test("patients can book and manage their appointments", () => {
  assert.equal(roleHasPermission("PATIENT", "PATIENT_BOOK_APPOINTMENT"), true);
  assert.equal(roleHasPermission("PATIENT", "PATIENT_MANAGE_APPOINTMENT"), true);
  assert.equal(roleHasPermission("DOCTOR", "PATIENT_BOOK_APPOINTMENT"), false);
});
