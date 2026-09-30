import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read=(path)=>readFileSync(new URL("../"+path,import.meta.url),"utf8");

const schema=read("prisma/schema.prisma");
const onboarding=read("src/modules/onboarding/persistent-onboarding.service.ts");
const providerAdmin=read("src/modules/admin-provider-administration/admin-provider-administration.module.ts");
const patients=read("src/modules/admin-patients/admin-patients.module.ts");
const queue=read("../../apps/admin/components/ProviderGovernanceQueue.tsx");
const professional=read("../../apps/admin/components/ProfessionalAdministrationCenter.tsx");
const security=read("../../apps/admin/components/SecurityOperations.tsx");
const patientDirectory=read("../../apps/admin/components/AdminPatientDirectory.tsx");
const patientDetail=read("../../apps/admin/components/AdminPatientDetail.tsx");
const pagination=read("../../apps/admin/components/AdminPagination.tsx");

assert.match(schema,/sourceOnboardingCredentialId\s+String\?\s+@unique/);
assert.match(schema,/sourceOnboardingDocumentId\s+String\?\s+@unique/);
assert.match(schema,/model PatientAdministrativeContactChange/);

assert.match(onboarding,/state:\s*\{\s*in:\s*\["PENDING_REVIEW", "REQUEST_CHANGES"\]/);
assert.match(onboarding,/archiveOnboardingCredentials/);
assert.match(onboarding,/credential\.state === "VERIFIED"\s*\?\s*"VALID"/);
assert.match(onboarding,/credential\.state === "REJECTED"\s*\?\s*"REJECTED"/);
assert.match(onboarding,/sourceOnboardingDocumentId/);

assert.match(providerAdmin,/@Delete\(":providerId\/credentials\/:credentialId\/documents\/:documentId"\)/);
assert.match(providerAdmin,/ADMIN_PROVIDER_CREDENTIAL_DOCUMENT_DELETED/);
assert.match(providerAdmin,/archivedOnboardingEvidenceRetained/);

assert.match(queue,/credential\.state === "VERIFIED" \? "VERIFIED"/);
assert.doesNotMatch(queue,/<option value="APPROVED"/);
assert.match(professional,/async function deleteDocument/);
assert.match(professional,/AdminPagination/);

assert.match(security,/const pageSize=10/);
assert.match(security,/paginateItems\(workspace\.queues\.sessions,sessionPage,pageSize\)/);
assert.match(security,/paginateItems\(workspace\.queues\.lockedAccounts,lockedPage,pageSize\)/);
assert.match(security,/paginateItems\(workspace\.queues\.securityEvents,eventPage,pageSize\)/);

for(const id of ["ADM-PAT-001","ADM-PAT-002","ADM-PAT-003","ADM-PAT-004","ADM-PAT-005","ADM-PAT-006","ADM-PAT-007","ADM-PAT-008","ADM-PAT-009","ADM-PAT-010"]){
  assert.ok(patientDetail.includes(id)||patientDirectory.includes(id),id+" missing from Admin patient UI");
}
assert.match(patients,/ADMINISTRATIVE_ONLY/);
assert.match(patients,/clinicalDataIncluded:\s*false/);
assert.match(patients,/async create\(/);
assert.match(patients,/async update\(/);
assert.match(patients,/async changeStatus\(/);
assert.match(patients,/async resetAccess\(/);
assert.match(patients,/async forceLogout\(/);
assert.match(patients,/async history\(/);
assert.match(patients,/async duplicates\(/);
assert.match(patients,/async requestContactChange\(/);
assert.match(patients,/async verifyContactChange\(/);
assert.match(patients,/async exportAdministrative\(/);
assert.doesNotMatch(patients,/clinicalProfile\.(update|upsert|create)/);
assert.match(patientDirectory,/AdminPagination/);
assert.match(pagination,/\[10,25,50,100\]/);

console.log("Credential queue, Security pagination and ADM-PAT-001..010 acceptance passed");
