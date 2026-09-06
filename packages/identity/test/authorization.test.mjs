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
