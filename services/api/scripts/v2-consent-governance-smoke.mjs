import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

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

{
  const schema = readFileSync(new URL("../prisma/v2_consent_policy_governance.prisma", import.meta.url), "utf8");
  const coreSchema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../prisma/migrations/20260924203000_v2_consent_policy_governance/migration.sql", import.meta.url), "utf8");
  const moduleSource = readFileSync(new URL("../src/modules/clinical-governance/clinical-governance.module.ts", import.meta.url), "utf8");
  const managed = readFileSync(new URL("../src/modules/clinical-governance/consent-policy-governance.service.ts", import.meta.url), "utf8");
  const governance = readFileSync(new URL("../src/modules/clinical-governance/clinical-governance.service.ts", import.meta.url), "utf8");
  const consent = readFileSync(new URL("../src/modules/consent/persistent-consent.service.ts", import.meta.url), "utf8");

  assert.match(schema, /model ConsentPolicyDefinition/);
  assert.match(schema, /model ConsentPolicyVersion/);
  assert.match(schema, /@@unique\(\[scopePattern, jurisdiction\]\)/);
  assert.match(schema, /@@unique\(\[policyId, version\]\)/);
  assert.match(coreSchema, /policyVersionId\s+String\?/);
  assert.match(coreSchema, /policyJurisdiction\s+String\?/);
  assert.match(migration, /ConsentPolicyVersion_status_ck/);
  assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN/);

  assert.match(moduleSource, /@Controller\("admin\/consent-policies"\)/);
  assert.match(moduleSource, /DATA_GOVERNANCE_MANAGE/);
  assert.match(moduleSource, /@Post\(":policyId\/versions"\)/);
  assert.match(moduleSource, /@Post\(":policyId\/versions\/:version\/activate"\)/);
  assert.doesNotMatch(moduleSource, /@Delete\(/);
  assert.doesNotMatch(moduleSource, /@Patch\(/);

  assert.match(managed, /validateClinicalConsentGrantContract/);
  assert.match(managed, /resolveClinicalConsentPolicy/);
  assert.match(managed, /cannot expand beyond the core safety policy/);
  assert.match(managed, /cannot enable temporary sharing beyond the core safety policy/);
  assert.match(managed, /Only a DRAFT consent policy version can be activated/);
  assert.match(managed, /status: "RETIRED"/);
  assert.match(managed, /RUNTIME_CONSENT_JURISDICTION = "GLOBAL"/);

  assert.match(consent, /this\.policies\.validateGrant/);
  assert.match(consent, /policyVersionId: contract\.policyVersionId/);
  assert.match(consent, /policyJurisdiction: contract\.policyJurisdiction/);
  assert.match(consent, /sourcePolicyVersionId/);
  assert.match(consent, /regrant: true/);
  assert.match(consent, /presentationsByIds/);
  assert.match(governance, /temporaryShare: true/);
  assert.match(governance, /policyVersionId: item\.policyVersionId/);
}
console.log("ADM-091 managed consent policy governance acceptance passed");
