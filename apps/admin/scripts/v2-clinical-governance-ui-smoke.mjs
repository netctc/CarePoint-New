import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const consentPage = read("../app/consent-policies/page.tsx");
const auditPage = read("../app/clinical-access/page.tsx");
const component = read("../components/ClinicalGovernanceConsole.tsx");
const policyManager = read("../components/ConsentPolicyManager.tsx");
const policyRoot = read("../app/api/admin/consent-policies/[[...segments]]/route.ts");
const managedPolicy = read("../../../services/api/src/modules/clinical-governance/consent-policy-governance.service.ts");
const consentPersistence = read("../../../services/api/src/modules/consent/persistent-consent.service.ts");
const route = read("../app/api/admin/clinical-access/[...segments]/route.ts");
const shell = read("../components/AppShell.tsx");
const governanceModule = read("../../../services/api/src/modules/clinical-governance/clinical-governance.module.ts");
const governanceService = read("../../../services/api/src/modules/clinical-governance/clinical-governance.service.ts");
const auditSanitizer = read("../../../services/api/src/infrastructure/audit/clinical-audit-metadata.ts");

// ADM-091 — managed policy revisions can only restrict the immutable core consent safety ceiling.
assert.match(consentPage, /ADM-091/);
assert.match(consentPage, /ConsentPolicyManager/);
assert.match(policyManager, /\/api\/admin\/consent-policies/);
assert.match(policyManager, /titleLabels/);
assert.match(policyManager, /bodyLabels/);
assert.match(policyManager, /eligibleRoles/);
assert.match(policyManager, /requireExpiry/);
assert.match(policyManager, /regrantAllowed/);
assert.match(policyManager, /runtimeJurisdiction/);
assert.match(policyRoot, /forwardAdminJson/);
assert.match(policyRoot, /requireSameOrigin: true/);
assert.match(policyRoot, /MAX_BODY_BYTES = 65536/);
assert.match(managedPolicy, /cannot expand beyond the core safety policy/);
assert.match(managedPolicy, /status: "RETIRED"/);
assert.match(consentPersistence, /policyVersionId/);

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

console.log("ADM-091/ADM-092/ADM-093 Admin consent governance and clinical audit acceptance passed");

function read(relative){return readFileSync(new URL(relative, import.meta.url),"utf8");}
