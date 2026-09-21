import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  resolveClinicalConsentPolicy,
  normalizeTemporaryShareScopes,
  normalizeTemporaryShareExpiry,
  validateClinicalConsentGrantContract,
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


test("direct V2 consent grants enforce registered version, purpose and provider role", () => {
  assert.deepEqual(
    validateClinicalConsentGrantContract({
      scope: "health_profile_read",
      version: "health-profile-v1",
      purpose: "TREATMENT",
      providerRole: "DOCTOR",
    }),
    {
      scope: "HEALTH_PROFILE_READ",
      version: "health-profile-v1",
      purpose: "TREATMENT",
    },
  );
  assert.throws(
    () => validateClinicalConsentGrantContract({
      scope: "HEALTH_PROFILE_READ",
      version: "legacy-v0",
      purpose: "TREATMENT",
      providerRole: "DOCTOR",
    }),
    /must be 'health-profile-v1'/,
  );
  assert.deepEqual(
    validateClinicalConsentGrantContract({
      scope: "QUESTIONNAIRE_READ",
      version: "questionnaire-read-v1",
      purpose: "TREATMENT",
      providerRole: "OTHER_PROVIDER",
    }),
    {
      scope: "QUESTIONNAIRE_READ",
      version: "questionnaire-read-v1",
      purpose: "TREATMENT",
    },
  );
  assert.throws(
    () => validateClinicalConsentGrantContract({
      scope: "CLINICAL_PROFILE_WRITE",
      version: "clinical-profile-v1",
      purpose: "TREATMENT",
      providerRole: "OTHER_PROVIDER",
    }),
    /not eligible/,
  );
  assert.deepEqual(
    validateClinicalConsentGrantContract({
      scope: "LEGACY_NON_CLINICAL_SCOPE",
      version: "legacy-v1",
      purpose: null,
      providerRole: null,
    }),
    {
      scope: "LEGACY_NON_CLINICAL_SCOPE",
      version: "legacy-v1",
      purpose: null,
    },
  );
});
