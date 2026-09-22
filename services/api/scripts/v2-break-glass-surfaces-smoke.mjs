import "./v2-doctor-clinical-integrity-ui-smoke.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const service = read("../src/modules/emergency-access/emergency-access.service.ts");
const moduleSource = read("../src/modules/emergency-access/emergency-access.module.ts");
const mobile = read("../../../packages/mobile_core/lib/emergency_access.dart");
const actions = read("../../../packages/mobile_core/lib/care_provider_actions.dart");
const client = read("../../../packages/mobile_core/lib/carepoint_api.dart");

assert.match(moduleSource, /@Controller\("provider\/emergency-access"\)/);
assert.match(moduleSource, /@Controller\("admin\/emergency-access"\)/);
assert.match(service, /isMfaAssuredSessionId\(principal\.sessionId\)/);
assert.match(service, /requestedTtlMinutes/);
assert.match(service, /expiresAt: \{ gt: new Date\(\) \}/);
assert.match(service, /EMERGENCY_ACCESS_GRANTED/);
assert.match(service, /EMERGENCY_ACCESS_USED/);
assert.match(service, /EMERGENCY_ACCESS_REVIEWED/);

// ADM-094: review queue derives usage from immutable audit evidence instead of a second source of truth.
assert.match(service, /auditEvent\.findMany/);
assert.match(service, /objectType: "EMERGENCY_ACCESS_GRANT"/);
assert.match(service, /action: "EMERGENCY_ACCESS_USED"/);
assert.match(service, /accessSummary/);
assert.match(service, /usageCount/);
assert.match(service, /firstUsedAt/);
assert.match(service, /lastUsedAt/);
assert.match(service, /accessedScopes/);

// DOC-086: Doctor-only mobile entry; explicit patient, scope, reason, bounded TTL and revoke.
assert.match(actions, /session\.role == 'DOCTOR'.*'emergencyAccess'/s);
assert.match(actions, /EmergencyAccessPage/);
assert.match(mobile, /patientId/);
assert.match(mobile, /CLINICAL_PROFILE_READ/);
assert.match(mobile, /LIFE_THREATENING_EMERGENCY/);
assert.match(mobile, /\[5,15,30,45,60\]/);
assert.match(mobile, /revokeEmergencyAccess/);
assert.match(client, /\/provider\/emergency-access/);
assert.doesNotMatch(mobile, /CAREPOINT_API_BASE|localhost:|127\.0\.0\.1/);

console.log("V2 break-glass surfaces acceptance passed: BE-022/DOC-086/ADM-094");

function read(relative) {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}
