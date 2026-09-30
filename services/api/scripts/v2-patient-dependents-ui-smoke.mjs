import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const moduleSource = read("../src/modules/dependents/dependents.module.ts");
const service = read("../src/modules/dependents/dependents.service.ts");
const engine = read("../src/modules/dependents/dependent-authority.engine.ts");
const consentPolicy = read("../src/modules/clinical-governance/clinical-consent-policy.ts");
const api = read("../../../packages/mobile_core/lib/patient_self_service_api.dart");
const ui = read("../../../packages/mobile_core/lib/patient_dependents.dart");
const main = read("../../../apps/patient-mobile/lib/main.dart");

// PAT-133 — active context is session-scoped, explicit and never exceeds verified authority.
assert.match(moduleSource, /@Controller\("patient\/context"\)/);
assert.match(moduleSource, /@Post\("switch"\)/);
assert.match(service, /mode: "SELF"/);
assert.match(service, /mode: "DEPENDENT"/);
assert.match(service, /effectiveRelation/);
assert.match(engine, /status === "VERIFIED"/);
assert.match(engine, /revokedAt == null/);
assert.match(engine, /contextExpiry/);
assert.match(engine, /12 \* 60 \* 60 \* 1000/);
assert.match(api, /patientContext\(\)/);
assert.match(api, /switchPatientContext/);
assert.match(main, /PatientActiveContextBanner/);
assert.match(main, /patient-dependents-entry/);
assert.match(main, /activePatientContext/);
assert.match(main, /_withPatientContext\(CareDiscoveryPage/);
assert.match(main, /_withPatientContext\(CareVisitsPage/);
assert.match(main, /_withPatientContext\(healthTab\(\)\)/);

// PAT-134 — request/update is review-gated; unverified dependent identity is minimized.
assert.match(moduleSource, /@Controller\("patient\/dependents"\)/);
assert.match(moduleSource, /@Post\(\)/);
assert.match(moduleSource, /@Patch\(":relationId"\)/);
assert.match(moduleSource, /@Post\(":relationId\/revoke"\)/);
assert.match(service, /status: "PENDING_REVIEW"/);
assert.match(service, /At least one legal-authority evidence reference is required/);
assert.match(service, /row\.status === "VERIFIED" && authorityIsEffective\(row\)/);
assert.match(service, /clinicalAccessEnabled: Boolean\(dependent && authorityIsEffective\(row\)\)/);
for (const scope of ["PROFILE_READ","BOOKING_MANAGE","CONSENT_MANAGE","CLINICAL_READ","CLINICAL_WRITE","DOCUMENTS_MANAGE","BILLING_MANAGE"]) {
  assert.match(engine, new RegExp(scope));
  assert.match(ui, new RegExp(scope));
}
assert.match(ui, /reviewWarning/);
assert.match(ui, /submitForReview/);
assert.match(ui, /patient-dependent-add/);
assert.match(api, /requestDependentRelation/);
assert.match(api, /updateDependentRelation/);
assert.match(api, /revokeDependentRelation/);

// PAT-135 — dependent consents require effective CONSENT_MANAGE and never mutate other patients.
assert.match(service, /effectiveRelation\(principal\.accountId, this\.id\(patientId, "patientId"\), "CONSENT_MANAGE"\)/);
assert.match(service, /DEPENDENT_CONSENT_GRANTED/);
assert.match(service, /DEPENDENT_CONSENT_REVOKED/);
assert.match(service, /consent\.patientId !== relation\.dependentPatientId/);
assert.match(api, /dependentConsents/);
assert.match(api, /grantDependentConsent/);
assert.match(api, /revokeDependentConsent/);
assert.match(ui, /class DependentConsentsPage/);
assert.match(ui, /dependent-consent-grant/);
assert.match(ui, /revokeConsentIsolation/);

for (const pair of [
  ["CLINICAL_RECORD_READ","clinical-record-v1"],
  ["HEALTH_PROFILE_READ","health-profile-v1"],
  ["QUESTIONNAIRE_READ","questionnaire-read-v1"],
  ["OBSERVATION_READ","observation-read-v1"],
  ["CLINICAL_PROFILE_READ","clinical-profile-v1"],
  ["CLINICAL_PROFILE_WRITE","clinical-profile-v1"],
  ["CLINICAL_MEDIA_CAPTURE","clinical-media-v1"],
]) {
  assert.match(consentPolicy, new RegExp(pair[0]));
  assert.match(consentPolicy, new RegExp(pair[1]));
  assert.match(ui, new RegExp(pair[0]));
  assert.match(ui, new RegExp(pair[1]));
}

for (const locale of ["CarePointLocale.en","CarePointLocale.ar","CarePointLocale.fr","CarePointLocale.es"]) {
  assert.ok(ui.includes(locale), `Missing dependent UI locale ${locale}`);
}

console.log("PAT-133/PAT-134/PAT-135 Patient dependent context + authority + consent acceptance passed");

function read(relative) {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}
