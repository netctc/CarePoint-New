import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const moduleSource = read("../src/modules/dependents/dependents.module.ts");
const service = read("../src/modules/dependents/dependents.service.ts");
const engine = read("../src/modules/dependents/dependent-authority.engine.ts");
const page = read("../../../apps/admin/app/patients/dependents/page.tsx");
const bff = read("../../../apps/admin/app/api/admin/dependents/[...segments]/route.ts");
const shell = read("../../../apps/admin/components/AppShell.tsx");

// ADM-098 — backend authority remains server-side and fail-closed.
assert.match(moduleSource, /@Controller\("admin\/dependents"\)/);
assert.match(moduleSource, /@Get\("review"\)/);
assert.match(moduleSource, /@Post\(":relationId\/evidence\/:evidenceId\/review"\)/);
assert.match(moduleSource, /@Post\(":relationId\/review"\)/);
assert.match(moduleSource, /IAM_MANAGE_ACCOUNTS/);
assert.match(service, /status: "PENDING_REVIEW"/);
assert.match(service, /Approval requires current verified authority evidence and no rejected evidence/);
assert.match(service, /verifiedByActorId: principal\.accountId/);
assert.match(service, /DEPENDENT_EVIDENCE_/);
assert.match(service, /DEPENDENT_RELATION_/);
assert.match(engine, /relation\.status === "VERIFIED"/);
assert.match(engine, /revokedAt == null/);

// The Admin BFF is narrow, same-origin for mutations, bounded, and has no evidence-download route.
assert.match(bff, /segments\.length !== 1 \|\| segments\[0\] !== "review"/);
assert.match(bff, /MAX_BODY_BYTES = 8_192/);
assert.match(bff, /requireSameOrigin: true/);
assert.match(bff, /reasonCode is required for rejection/);
assert.match(bff, /reasonCode is required for rejected evidence/);
assert.match(bff, /"VERIFIED", "REJECTED"/);
assert.match(bff, /"APPROVE", "REJECT"/);
assert.doesNotMatch(bff, /download|binary|document-content|evidence-file/);

// Admin surface exposes queue + evidence + relation decisions, but no client-side grant override.
assert.match(page, /ADM-098/);
assert.match(page, /adminApi\("review"\)/);
assert.match(page, /reviewEvidence/);
assert.match(page, /reviewRelation/);
assert.match(page, /clinicalAccessEnabled/);
assert.match(page, /Approval remains blocked/);
assert.match(page, /status === "VERIFIED"/);
assert.match(page, /status === "REJECTED"/);
assert.match(page, /reviewRelation\(relation: Relation, decision: "APPROVE" \| "REJECT"\)/);
assert.match(page, /reviewRelation\(relation, "APPROVE"\)/);
assert.match(page, /reviewRelation\(relation, "REJECT"\)/);
assert.match(page, /\{ decision, \.\.\.\(reasonCode \? \{ reasonCode \} : \{\}\) \}/);
assert.doesNotMatch(page, /clinicalAccessEnabled\s*=\s*/);
assert.doesNotMatch(page, /clinicalAccessEnabled\s*:\s*(?:true|false)\b/);
assert.doesNotMatch(page, /PATCH|DELETE/);

// Navigation and localization.
assert.match(shell, /href="\/patients\/dependents"/);
assert.match(shell, /Dependent Reviews/);
for (const locale of ["en:", "ar:", "fr:", "es:"]) {
  assert.match(page, new RegExp(locale));
}

console.log("ADM-098 dependent legal-authority review UI acceptance passed");

function read(relative) {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}
