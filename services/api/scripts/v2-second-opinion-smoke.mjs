import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const model = read("../prisma/v2_second_opinions.prisma");
const migration = read("../prisma/migrations/20260924032000_v2_second_opinions/migration.sql");
const moduleSource = read("../src/modules/second-opinions/second-opinions.module.ts");
const service = read("../src/modules/second-opinions/second-opinions.service.ts");
const app = read("../src/app.module.ts");
const api = read("../../../packages/mobile_core/lib/carepoint_api.dart");
const coordination = read("../../../packages/mobile_core/lib/doctor_orders_coordination.dart");
const mobile = read("../../../packages/mobile_core/lib/second_opinion.dart");

assert.match(model, /model SecondOpinionRequest/);
assert.match(model, /snapshotHash/);
assert.match(model, /snapshotCiphertext/);
assert.match(model, /responseCiphertext/);
assert.match(model, /consentIds\s+Json/);
assert.match(migration, /SecondOpinionRequest_snapshot_immutable/);
assert.match(migration, /Second-opinion clinical snapshot is immutable/);
assert.match(migration, /Second-opinion response is immutable once recorded/);
assert.match(migration, /SecondOpinionRequest_no_delete/);

assert.match(moduleSource, /@Post\("patients\/:patientId\/second-opinions"\)/);
assert.match(moduleSource, /@Get\("second-opinions\/inbox"\)/);
assert.match(moduleSource, /@Post\("second-opinions\/:requestId\/respond"\)/);
assert.match(moduleSource, /CARE_COORDINATION_MANAGE/);

assert.match(service, /normalizeTemporaryShareScopes/);
assert.match(service, /requireExplicitDestinationConsents/);
assert.match(service, /providerId: destinationProviderId/);
assert.match(service, /purpose: "TREATMENT"/);
assert.match(service, /destinationConsentsStillActive/);
assert.match(service, /resolveClinicalConsentPolicy/);
assert.match(service, /Patient consent for this second-opinion package is no longer active/);

assert.match(service, /DoctorSnapshotService/);
assert.match(service, /providerPatientTimeline/);
assert.match(service, /snapshotHash = createHash\("sha256"\)/);
assert.match(service, /snapshot integrity validation failed/);
assert.match(service, /MAX_SNAPSHOT_BYTES/);
assert.match(service, /encryptRecord\(requestPayload\)/);
assert.match(service, /immutableSnapshot: true/);
assert.doesNotMatch(model, /firstName|lastName|question\s+String|response\s+String/);

assert.match(service, /referral\.status !== "IN_PROGRESS"/);
assert.match(service, /Accept and start the linked referral/);
assert.match(service, /status: "COMPLETED"/);
assert.match(service, /SECOND_OPINION_RESPONDED/);
assert.match(service, /responseCiphertext: null/);

assert.match(app, /SecondOpinionsModule/);
assert.match(api, /doctorPatientSecondOpinions/);
assert.match(api, /doctorSecondOpinionInbox/);
assert.match(api, /createDoctorSecondOpinion/);
assert.match(api, /respondDoctorSecondOpinion/);
assert.match(coordination, /doctor-second-opinion-entry/);
assert.match(coordination, /DoctorSecondOpinionPage/);
assert.match(mobile, /class DoctorSecondOpinionPage/);
assert.match(mobile, /CLINICAL_RECORD_READ/);
assert.match(mobile, /HEALTH_PROFILE_READ/);
assert.match(mobile, /QUESTIONNAIRE_READ/);
assert.match(mobile, /OBSERVATION_READ/);
assert.match(mobile, /CLINICAL_PROFILE_READ/);
assert.match(mobile, /JsonEncoder\.withIndent/);
assert.match(mobile, /snapshotHash/);
assert.match(mobile, /actDoctorReferral/);
assert.match(mobile, /respondDoctorSecondOpinion/);
for (const locale of ["CarePointLocale.en", "CarePointLocale.ar", "CarePointLocale.fr", "CarePointLocale.es"]) {
  assert.ok(mobile.includes(locale), `Missing second-opinion locale ${locale}`);
}

console.log("BE-034 / DOC-079 governed second-opinion acceptance passed");

function read(relative) {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}
