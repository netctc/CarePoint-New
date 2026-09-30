import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ageYears, evaluatePreventiveRule } from "../src/modules/preventive-care/preventive-care.engine.ts";

const schema = read("../prisma/v2_preventive_care.prisma");
const migration = read("../prisma/migrations/20260924150000_v2_preventive_care/migration.sql");
const moduleSource = read("../src/modules/preventive-care/preventive-care.module.ts");
const app = read("../src/app.module.ts");
const api = read("../../../packages/mobile_core/lib/carepoint_api.dart");
const mobile = read("../../../packages/mobile_core/lib/preventive_care.dart");
const patientMain = read("../../../apps/patient-mobile/lib/main.dart");

// Versioned policy + append-only patient preference events.
assert.match(schema, /model PreventiveCareRule/);
assert.match(schema, /model PreventiveCareRuleVersion/);
assert.match(schema, /model PreventiveCareAction/);
assert.match(schema, /@@unique\(\[ruleId, version\]\)/);
assert.match(schema, /@@unique\(\[patientId, idempotencyKey\]\)/);
assert.match(migration, /DRAFT/);
assert.match(migration, /PUBLISHED/);
assert.match(migration, /RETIRED/);
assert.match(migration, /AGE_WINDOW/);
assert.match(migration, /IMMUNIZATION_INTERVAL/);
assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN/);

// Admin publication is explicit and audited.
assert.match(moduleSource, /@Controller\("admin\/preventive-care\/rules"\)/);
assert.match(moduleSource, /CATALOG_MANAGE/);
assert.match(moduleSource, /Only DRAFT preventive-care versions can be published/);
assert.match(moduleSource, /status: "RETIRED"/);
assert.match(moduleSource, /PREVENTIVE_CARE_RULE_VERSION_PUBLISHED/);

// Runtime fails closed on missing canonical jurisdiction instead of assuming a country.
assert.match(moduleSource, /version\.jurisdiction === "GLOBAL"/);
assert.match(moduleSource, /GLOBAL_ONLY_UNTIL_CANONICAL_PATIENT_JURISDICTION/);
assert.match(moduleSource, /skippedJurisdiction/);

// Active patient/dependent context is required; no diagnosis/risk inference is created.
assert.match(moduleSource, /resolveEffectivePatient\(principal, "CLINICAL_READ"\)/);
assert.match(moduleSource, /resolveEffectivePatient\(principal, "CLINICAL_WRITE"\)/);
assert.match(moduleSource, /diagnosisInference: false/);
assert.match(moduleSource, /patientHealthProfile\.findUnique/);
assert.match(moduleSource, /immunization\.findMany/);
assert.match(moduleSource, /decryptRecord<HealthPayload>/);
assert.match(moduleSource, /decryptRecord<ImmunizationPayload>/);

// Patient can postpone/dismiss only the current published rule version.
assert.match(moduleSource, /@Controller\("patient\/preventive-care"\)/);
assert.match(moduleSource, /PATIENT_READ_HEALTH_PROFILE/);
assert.match(moduleSource, /PATIENT_MANAGE_CLINICAL_PROFILE/);
assert.match(moduleSource, /action must be DISMISSED or POSTPONED/);
assert.match(moduleSource, /maxPostponeDays/);
assert.match(moduleSource, /idempotencyKey is bound to another preventive-care action/);

// Deterministic engine behavior.
const now = new Date("2026-09-24T12:00:00.000Z");
assert.equal(ageYears("1986-09-24", now), 40);
assert.deepEqual(
  evaluatePreventiveRule(
    { triggerType:"AGE_WINDOW", minAgeYears:40, maxAgeYears:50, vaccineCodeSystem:null, vaccineCode:null, intervalDays:null },
    "1986-09-24",
    [],
    now,
  ),
  { due:true, reason:"AGE_WINDOW_MATCH", ageYears:40 },
);
assert.equal(
  evaluatePreventiveRule(
    { triggerType:"IMMUNIZATION_INTERVAL", minAgeYears:null, maxAgeYears:null, vaccineCodeSystem:"urn:test", vaccineCode:"VAC", intervalDays:365 },
    "1986-09-24",
    [{ occurredOn:"2025-01-01", vaccineCodeSystem:"urn:test", vaccineCode:"VAC" }],
    now,
  ).reason,
  "IMMUNIZATION_INTERVAL_DUE",
);

// Patient Mobile exposes source/rule and actions, with no diagnostic language.
assert.match(api, /patientPreventiveCare\(\)/);
assert.match(api, /actPatientPreventiveCare/);
assert.match(patientMain, /patient-preventive-care-entry/);
assert.match(mobile, /class PatientPreventiveCarePage/);
assert.match(mobile, /sourceReference/);
assert.match(mobile, /POSTPONED/);
assert.match(mobile, /DISMISSED/);
assert.match(mobile, /do not diagnose a condition or infer disease/);
for (const locale of ["'en'","'ar'","'fr'","'es'"]) assert.ok(mobile.includes(locale));
assert.match(app, /PreventiveCareModule/);

console.log("V2 PAT-140 preventive-care reminders acceptance passed");

function read(relative) {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}
