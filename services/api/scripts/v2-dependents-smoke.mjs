import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const engine = require("../dist/modules/dependents/dependent-authority.engine.js");

test("dependent authority scopes are explicit and closed", () => {
  assert.deepEqual(
    engine.normalizeAuthorityScopes(["consent_manage", "profile_read"]),
    ["CONSENT_MANAGE", "PROFILE_READ"],
  );
  assert.throws(() => engine.normalizeAuthorityScopes(["EVERYTHING"]), /scopes is invalid/);
});

test("authority is fail-closed until verified and expires immediately", () => {
  const now = new Date("2026-09-19T00:00:00.000Z");
  const base = { validFrom: new Date("2026-09-18T00:00:00.000Z"), validUntil: new Date("2026-09-20T00:00:00.000Z"), revokedAt: null };
  assert.equal(engine.authorityIsEffective({ ...base, status: "PENDING_REVIEW" }, now), false);
  assert.equal(engine.authorityIsEffective({ ...base, status: "VERIFIED" }, now), true);
  assert.equal(engine.authorityIsEffective({ ...base, status: "VERIFIED", validUntil: new Date("2026-09-18T23:59:59.000Z") }, now), false);
  assert.equal(engine.authorityIsEffective({ ...base, status: "VERIFIED", revokedAt: now }, now), false);
});

test("dependent session context never outlives authority or twelve hours", () => {
  const now = new Date("2026-09-19T00:00:00.000Z");
  assert.equal(engine.contextExpiry(null, now).toISOString(), "2026-09-19T12:00:00.000Z");
  assert.equal(engine.contextExpiry(new Date("2026-09-19T02:00:00.000Z"), now).toISOString(), "2026-09-19T02:00:00.000Z");
});

console.log("V2 dependent authority acceptance passed");

await import("./v2-patient-dependents-ui-smoke.mjs");
