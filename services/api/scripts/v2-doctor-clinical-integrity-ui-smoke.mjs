import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const clinicalModule = read("../src/modules/clinical/clinical.module.ts");
const addenda = read("../src/modules/clinical/encounter-addenda.service.ts");
const followController = read("../src/modules/provider-follow-up/provider-follow-up.controller.ts");
const followService = read("../src/modules/provider-follow-up/provider-follow-up.service.ts");
const mobileRecord = read("../../../packages/mobile_core/lib/clinical_record.dart");
const mobileApi = read("../../../packages/mobile_core/lib/carepoint_api.dart");
const mobileFollow = read("../../../packages/mobile_core/lib/follow_up_recommendation.dart");

// DOC-081 / BE-037 addendum: finalized encounter only, append-only create path, signed exact envelope.
assert.match(clinicalModule, /@Post\(":encounterId\/addenda"\)/);
assert.match(addenda, /appointment\.status !== "COMPLETED"/);
assert.match(addenda, /encounterAddendum\.create/);
assert.match(addenda, /signatureAlgorithm/);
assert.match(addenda, /payloadDigest/);
assert.match(addenda, /signedAt/);
assert.doesNotMatch(addenda, /encounterAddendum\.(?:update|delete|updateMany|deleteMany)\s*\(/);

// Doctor UI only offers addendum after finalized; original fields remain disabled.
assert.match(mobileRecord, /widget\.session\.role == 'DOCTOR' && finalized/);
assert.match(mobileRecord, /onPressed: saving \? null : _addAddendum/);
assert.match(mobileRecord, /enabled: !finalized/);
assert.match(mobileRecord, /createEncounterAddendum/);
assert.match(mobileApi, /\/provider\/encounters\/.*\/addenda/);
assert.match(mobileRecord, /encounter\?\['addenda'\]/);

// DOC-083 follow-up: existing backend remains a recommendation, not an automatic booking.
assert.match(followController, /provider\/follow-up-recommendations/);
assert.match(followService, /PROVIDER_FOLLOW_UP_RECOMMENDATION_CREATED/);
assert.match(mobileRecord, /ProviderFollowUpPage/);
assert.match(mobileFollow, /This is a recommendation only/);
assert.match(mobileFollow, /patient must book separately/i);
assert.doesNotMatch(mobileFollow, /\/bookings|book\(/);

console.log("V2 Doctor clinical integrity UI acceptance passed: DOC-081/DOC-083");

function read(relative) {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}
