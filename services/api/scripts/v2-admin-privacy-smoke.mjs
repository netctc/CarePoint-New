import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const adminService = readFileSync(new URL("../src/modules/patient-clinical-export/patient-clinical-export-admin.service.ts", import.meta.url), "utf8");
const exportModule = readFileSync(new URL("../src/modules/patient-clinical-export/patient-clinical-export.module.ts", import.meta.url), "utf8");
const shell = readFileSync(new URL("../../../apps/admin/components/AppShell.tsx", import.meta.url), "utf8");
const exportUi = readFileSync(new URL("../../../apps/admin/components/PrivacyExportMonitor.tsx", import.meta.url), "utf8");
const retentionUi = readFileSync(new URL("../../../apps/admin/components/RetentionGovernance.tsx", import.meta.url), "utf8");
const exportRoute = readFileSync(new URL("../../../apps/admin/app/api/admin/privacy/exports/route.ts", import.meta.url), "utf8");
const policiesRoute = readFileSync(new URL("../../../apps/admin/app/api/admin/privacy/retention/policies/route.ts", import.meta.url), "utf8");
const holdsRoute = readFileSync(new URL("../../../apps/admin/app/api/admin/privacy/retention/legal-holds/route.ts", import.meta.url), "utf8");

assert.match(exportModule, /@Controller\("admin\/patient-exports"\)/);
assert.match(exportModule, /@RequirePermissions\("DATA_GOVERNANCE_MANAGE"\)/);
assert.match(adminService, /patientReference: this\.patientReference\(row\.patientId\)/);
assert.match(adminService, /clinicalPayloadReturned: false/);
assert.match(adminService, /downloadCapabilityReturned: false/);
assert.match(adminService, /rawPatientIdReturned: false/);
assert.doesNotMatch(adminService, /patientId:\s*row\.patientId/);
assert.doesNotMatch(adminService, /objectKey:\s*row\.objectKey/);
assert.doesNotMatch(adminService, /contentDigest:\s*row\.contentDigest/);
assert.match(adminService, /ADMIN_PATIENT_EXPORT_JOBS_READ/);

assert.match(exportRoute, /\/admin\/patient-exports/);
assert.match(policiesRoute, /\/admin\/retention\/policies/);
assert.match(holdsRoute, /\/admin\/retention\/legal-holds/);
assert.match(policiesRoute, /requireSameOrigin: true/);
assert.match(holdsRoute, /requireSameOrigin: true/);

assert.match(shell, /\/privacy\/exports/);
assert.match(exportUi, /clinicalPayloadReturned === false/);
assert.match(exportUi, /downloadCapabilityReturned === false/);
assert.doesNotMatch(exportUi, /download-token|signedUrl|objectKey|contentDigest/);
assert.match(retentionUi, /\/api\/admin\/privacy\/retention\/policies/);
assert.match(retentionUi, /\/api\/admin\/privacy\/retention\/legal-holds/);
assert.match(retentionUi, /expectedVersion:policy\.currentVersion/);
assert.match(retentionUi, /subjectType === "GLOBAL"/);
assert.match(retentionUi, /EN|en:/);
assert.match(retentionUi, /ar:/);
assert.match(retentionUi, /fr:/);
assert.match(retentionUi, /es:/);

console.log("ADM-095/ADM-096 admin privacy governance acceptance passed");
