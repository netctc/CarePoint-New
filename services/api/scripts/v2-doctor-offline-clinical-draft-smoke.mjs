import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const service = read("../src/modules/provider-offline-sync/provider-offline-sync.service.ts");
const moduleSource = read("../src/modules/provider-offline-sync/provider-offline-sync.module.ts");
const schema = read("../prisma/v2_offline_field_drafts.prisma");
const api = read("../../../packages/mobile_core/lib/provider_offline_sync_api.dart");
const mobile = read("../../../packages/mobile_core/lib/doctor_offline_clinical_draft.dart");
const workspace = read("../../../packages/mobile_core/lib/provider_workspace.dart");

// DOC-087 reuses the encrypted/versioned PRV-075 persistence instead of a parallel draft table.
assert.match(schema, /model OfflineFieldDraft/);
assert.match(schema, /model OfflineFieldDraftRevision/);
assert.match(schema, /model OfflineFieldSyncConflict/);
assert.match(service, /principal\.role === "DOCTOR"/);
assert.match(service, /provider\.class !== "DOCTOR"/);
assert.match(service, /provider\.status !== "ACTIVE"/);
assert.match(service, /modality: "HOME_VISIT"/);
assert.match(service, /status: \{ in: \["CONFIRMED", "COMPLETED"\] \}/);
assert.match(service, /clinicalDraft: this\.doctorClinicalDraft/);
assert.match(service, /ClinicalEnvelopeService/);
assert.match(service, /baseServerVersion/);
assert.match(service, /offlineFieldSyncConflict\.create/);
assert.match(service, /SERVER_ADVANCED_AFTER_CONFLICT/);
assert.match(service, /KEEP_SERVER/);
assert.match(service, /USE_CLIENT/);
assert.match(service, /DOCTOR_OFFLINE_CLINICAL/);
assert.doesNotMatch(service, /data:\s*\{[^}]*chiefComplaint\s*:/s, "clinical draft text must not be plaintext Prisma metadata");

// Doctor endpoints are separated from Other Provider permissions.
assert.match(moduleSource, /@Controller\("doctor\/offline-sync"\)/);
assert.match(moduleSource, /CLINICAL_RECORD_WRITE/);
assert.match(moduleSource, /@Controller\("provider\/offline-sync"\)/);
assert.match(moduleSource, /OTHER_PROVIDER_WORKFLOW_EXECUTE/);

// Mobile local storage is encrypted, expiring, conflict-aware, and never auto-writes ClinicalRecord.
assert.match(mobile, /FlutterSecureStorage/);
assert.match(mobile, /Duration\(hours: 72\)/);
assert.match(mobile, /expiresAt/);
assert.match(mobile, /isExpired/);
assert.match(mobile, /active\.length != all\.length/);
assert.match(mobile, /'PENDING'/);
assert.match(mobile, /'SYNCED'/);
assert.match(mobile, /'CONFLICT'/);
assert.match(mobile, /'KEEP_SERVER'/);
assert.match(mobile, /'USE_CLIENT'/);
assert.match(mobile, /chiefComplaint/);
assert.match(mobile, /assessment/);
assert.match(mobile, /plan/);
assert.match(mobile, /vitals/);
assert.match(mobile, /never writes or finalizes the clinical record automatically/);
assert.doesNotMatch(mobile, /clinicalEncounterWrite|finalizeClinical|saveClinicalRecord/);

assert.match(api, /syncDoctorOfflineClinicalDraft/);
assert.match(api, /doctorOfflineClinicalConflicts/);
assert.match(api, /resolveDoctorOfflineClinicalConflict/);
assert.match(workspace, /doctor-offline-clinical-/);
assert.match(workspace, /item\['modality'\] == 'HOME_VISIT'/);
assert.match(workspace, /widget\.session\.role == 'DOCTOR'/);

for (const locale of ["CarePointLocale.en","CarePointLocale.ar","CarePointLocale.fr","CarePointLocale.es"]) {
  assert.ok(mobile.includes(locale), `Missing DOC-087 locale ${locale}`);
}

console.log("DOC-087 encrypted Doctor offline clinical draft acceptance passed");

function read(relative) {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}
