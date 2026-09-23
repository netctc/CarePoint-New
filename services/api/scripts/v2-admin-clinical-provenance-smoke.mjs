import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const moduleSource=read("../src/modules/clinical-governance/clinical-governance.module.ts");
const service=read("../src/modules/clinical-governance/clinical-governance.service.ts");
const bff=read("../../../apps/admin/app/api/admin/clinical-access/[...segments]/route.ts");
const page=read("../../../apps/admin/app/clinical-provenance/page.tsx");
const shell=read("../../../apps/admin/components/AppShell.tsx");

// ADM-086 is a read-only, permission-bound structural provenance projection.
assert.match(moduleSource, /@Get\("provenance"\)/);
assert.match(moduleSource, /DATA_GOVERNANCE_MANAGE/);
assert.match(moduleSource, /Cache-Control/);
assert.match(service, /async provenanceExplorer/);
assert.match(service, /patientId.*requiredId/);
assert.match(service, /clinicalProfileEntry\.findMany/);
assert.match(service, /observation\.findMany/);
assert.match(service, /questionnaireResponse\.findMany/);
assert.match(service, /sourceType/);
assert.match(service, /sourceActorId/);
assert.match(service, /verificationStatus/);
assert.match(service, /verifiedByActorId/);
assert.match(service, /verifiedAt/);
assert.match(service, /contentIncluded: false/);
assert.match(service, /immutableReadOnly: true/);
assert.match(service, /ADMIN_CLINICAL_PROVENANCE_READ/);
assert.match(service, /purpose: "ACCESS_GOVERNANCE"/);
assert.match(service, /domain: "CLINICAL_PROVENANCE"/);

// Cleartext clinical payload fields are never selected or projected by the provenance method.
const method=service.match(/async provenanceExplorer[\s\S]*?\n  async auditExplorer/)?.[0]??"";
assert.ok(method);
for(const forbidden of ["ciphertext","wrappedKey","clinicalNote","answers:","canonicalValue","displayValue","valueJson","data:"]) {
  assert.equal(method.includes(forbidden),false,`Provenance projection leaked payload selector: ${forbidden}`);
}

// BFF is GET-only, requires an explicit bounded patient ID and whitelists query fields.
assert.match(bff, /"provenance"/);
assert.match(bff, /PROVENANCE_FILTERS/);
assert.match(bff, /patientId is required and invalid/);
assert.match(bff, /Invalid provenance domain/);
assert.match(bff, /Invalid provenance limit/);
assert.doesNotMatch(bff, /export async function POST/);

// Admin UI requires explicit patient query and has no mutation controls.
assert.match(page, /ADM-086/);
assert.match(page, /clinical-access\/provenance/);
assert.match(page, /SAFE_ID/);
assert.match(page, /contentIncluded/);
assert.match(page, /Read-only|Sólo lectura/);
assert.doesNotMatch(page, /method:\s*"POST"|method:\s*"PATCH"|method:\s*"DELETE"/);
assert.match(shell, /href="\/clinical-provenance"/);

for(const locale of ["en:","ar:","fr:","es:"]) assert.match(page,new RegExp(locale));

console.log("ADM-086 clinical provenance explorer acceptance passed");

function read(relative){return readFileSync(new URL(relative,import.meta.url),"utf8");}
