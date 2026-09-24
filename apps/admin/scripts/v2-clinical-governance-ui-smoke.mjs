import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const consentPage = read("../app/consent-policies/page.tsx");
const auditPage = read("../app/clinical-access/page.tsx");
const component = read("../components/ClinicalGovernanceConsole.tsx");
const route = read("../app/api/admin/clinical-access/[...segments]/route.ts");
const shell = read("../components/AppShell.tsx");
const governanceModule = read("../../../services/api/src/modules/clinical-governance/clinical-governance.module.ts");
const governanceService = read("../../../services/api/src/modules/clinical-governance/clinical-governance.service.ts");
const auditSanitizer = read("../../../services/api/src/infrastructure/audit/clinical-audit-metadata.ts");

// ADM-092 — the UI renders the effective backend role/scope/category matrix, not a client-owned copy.
assert.match(consentPage, /ADM-092/);
assert.match(consentPage, /ConsentAccessMatrix/);
assert.match(component, /\/api\/admin\/clinical-access\/policies/);
assert.match(component, /\/api\/admin\/clinical-access\/matrix/);
assert.match(component, /clinicalConsentPolicies/);
assert.match(component, /otherProviderCategories/);
assert.match(component, /invariants/);
assert.match(governanceModule, /@Get\("matrix"\)/);
assert.match(governanceModule, /DATA_GOVERNANCE_MANAGE/);
assert.match(governanceService, /roleHasPermission/);
assert.match(governanceService, /parseProviderCategoryCapabilities/);
assert.match(governanceService, /consentDoesNotBypassRole:\s*true/);
assert.match(governanceService, /consentDoesNotBypassCategoryCapability:\s*true/);
assert.match(governanceService, /adminHasNoImplicitPatientClinicalRead:\s*true/);

// ADM-093 — audit search remains server-authorized/sanitized and client export is only from returned rows.
assert.match(auditPage, /ADM-093/);
assert.match(auditPage, /ClinicalAccessAuditExplorer/);
assert.match(component, /\/api\/admin\/clinical-access\/audit\?/);
assert.match(component, /actorId/);
assert.match(component, /patientId/);
assert.match(component, /providerId/);
assert.match(component, /purpose/);
assert.match(component, /result/);
assert.match(component, /Export authorized CSV|Exportar CSV autorizado/);
assert.match(component, /data\.items\.map/);
assert.doesNotMatch(component, /dangerouslySetInnerHTML/);
assert.match(governanceModule, /@Get\("audit"\)/);
assert.match(governanceModule, /IAM_READ_AUDIT/);
assert.match(governanceService, /sanitizeClinicalAuditMetadata/);
assert.match(auditSanitizer, /ALLOWED_KEYS|patientId|providerId/);

// BFF is bounded to explicit read routes; ADM-086 adds provenance without enabling arbitrary backend paths.
assert.match(route, /ALLOWED_READS = new Set\(\["policies", "matrix", "audit", "provenance"\]\)/);
assert.match(route, /PROVENANCE_FILTERS/);
assert.match(route, /AUDIT_FILTERS/);
assert.match(route, /MAX_QUERY_VALUE = 180/);
assert.match(route, /forwardAdminJson/);
assert.doesNotMatch(route, /export async function POST/);
assert.doesNotMatch(route, /export async function PATCH/);
assert.match(shell, /\/consent-policies/);
assert.match(shell, /\/clinical-access/);

for (const locale of ["en:", "ar:", "fr:", "es:"]) {
  assert.ok(component.includes(locale), `Missing governance locale ${locale}`);
}

console.log("ADM-092/ADM-093 Admin consent matrix and clinical audit explorer acceptance passed");

function read(relative){return readFileSync(new URL(relative, import.meta.url),"utf8");}
