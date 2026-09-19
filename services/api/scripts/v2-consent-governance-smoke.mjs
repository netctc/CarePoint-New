import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  resolveClinicalConsentPolicy,
  normalizeTemporaryShareScopes,
  normalizeTemporaryShareExpiry,
} = require("../dist/modules/clinical-governance/clinical-consent-policy.js");

test("known V2 consent scopes resolve to explicit versions", () => {
  assert.equal(resolveClinicalConsentPolicy("HEALTH_PROFILE_READ").version, "health-profile-v1");
  assert.equal(resolveClinicalConsentPolicy("OBSERVATION_READ:HEART_RATE").version, "observation-read-v1");
  assert.equal(resolveClinicalConsentPolicy("UNKNOWN_SCOPE"), null);
});

test("temporary sharing is read-only and metric-selective", () => {
  assert.deepEqual(
    normalizeTemporaryShareScopes([
      "OBSERVATION_READ:heart_rate",
      "HEALTH_PROFILE_READ",
      "OBSERVATION_READ:heart_rate",
    ]),
    [
      { scope: "OBSERVATION_READ:HEART_RATE", version: "observation-read-v1" },
      { scope: "HEALTH_PROFILE_READ", version: "health-profile-v1" },
    ],
  );
  assert.throws(
    () => normalizeTemporaryShareScopes(["CLINICAL_PROFILE_WRITE"]),
    /not temporary-share eligible/,
  );
});

test("temporary shares are strictly time bounded", () => {
  const now = new Date("2026-09-19T00:00:00.000Z");
  assert.equal(
    normalizeTemporaryShareExpiry("2026-09-19T01:00:00.000Z", now).toISOString(),
    "2026-09-19T01:00:00.000Z",
  );
  assert.throws(
    () => normalizeTemporaryShareExpiry("2026-09-21T00:00:00.000Z", now),
    /must be between/,
  );
});

console.log("V2 consent governance acceptance passed");
