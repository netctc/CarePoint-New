import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const apiRoot = new URL("../", import.meta.url);
const repoRoot = new URL("../../../", import.meta.url);
const readApi = (path) => readFile(new URL(path, apiRoot), "utf8");
const readRepo = (path) => readFile(new URL(path, repoRoot), "utf8");

const [phase31Text, indexText, evaluator, pkgText, docs] = await Promise.all([
  readRepo("ops/release-1/final-go-live-gate-readiness-phase31.json"),
  readRepo("ops/release-1/go-live-evidence-index.example.json"),
  readApi("scripts/v2-release-phase32-evidence.mjs"),
  readApi("package.json"),
  readRepo("docs/release-external-evidence-validator-phase32.md"),
]);

const phase31 = JSON.parse(phase31Text);
const index = JSON.parse(indexText);
const pkg = JSON.parse(pkgText);

assert.equal(index.schemaVersion, 1);
assert.equal(index.schema, "carepoint.go-live-evidence-index/v1");
assert.deepEqual(index.releaseCandidate, {
  consolidatedPr: 511,
  sourceSha: "9974b72b76b45539e6513730c3b8fdbe0d1506f0",
  canonicalWorkflowCount: 25,
  canonicalMatrixConclusion: "SUCCESS",
});
assert.equal(index.productionAcceptance, false);
assert.equal(index.mainMergeAllowed, false);
assert.equal(index.humanReleaseAuthorizationRequired, true);
assert.equal(index.finalDecision, "BLOCKED");

assert.equal(index.gates.length, 8);
assert.deepEqual(
  index.gates.map((gate) => gate.id).sort(),
  phase31.gates.map((gate) => gate.id).sort(),
);
for (const gate of index.gates) {
  assert.equal(gate.status, "PENDING");
  assert.equal(gate.evidenceFile, null);
  assert.equal(gate.evidenceSha256, null);
  assert.equal(gate.acceptedByRef, null);
  assert.equal(gate.acceptedAt, null);
}

for (const text of [
  'Usage: node scripts/v2-release-phase32-evidence.mjs <sanitized-evidence-index.json>',
  'carepoint.go-live-evidence-index/v1',
  'entry.evidenceFile.endsWith(".example.json")',
  'entry.evidenceFile.startsWith("ops/release-1/evidence/")',
  'createHash("sha256").update(raw).digest("hex")',
  'evidence.schema',
  'template.schema',
  'assertTemplateStructure(evidence, template)',
  'assertSensitiveDataFlags(evidence)',
  'assertReleaseSha(evidence, index.releaseCandidate.sourceSha)',
  'assertNoPlaceholders(evidence)',
  'assertCommonApproval(evidence, entry.id)',
  'assertGateSpecific(entry.id, evidence)',
  'templateIdentityKeys',
  'Mobile profile',
  'must embed the release SHA',
  'Security Critical/High disposition is not acceptable',
  'UAT evidence must use synthetic data only.',
  'carepoint.release-resilience-evidence/v1',
  'Measured RPO exceeds 15 minutes.',
  'Measured RTO exceeds 120 minutes.',
  'UAT defect',
  'Deployment rehearsal migration set digest must be 64-hex SHA-256.',
  'Deployment rehearsal RPO exceeds 15 minutes.',
  'Deployment rehearsal RTO exceeds 120 minutes.',
  'Deployed runtime SHA must match the final release candidate.',
  '"READY_FOR_HUMAN_RELEASE_AUTHORIZATION"',
  'index.mainMergeAllowed, false',
  'index.productionAcceptance, false',
  'humanReleaseAuthorizationRequired: true',
  'process.exitCode = allAccepted ? 0 : 2',
]) {
  assert.ok(evaluator.includes(text), "Phase 32 evaluator must include: " + text);
}

for (const text of [
  "REPLACE_WITH",
  "CHANGE-ME",
  "TO-BE-SET",
  "PENDING",
  "BLOCKED",
  "DRAFT",
  "UNDECIDED",
  "privatekey",
  "accesstoken",
  "secretvalue",
]) {
  assert.ok(evaluator.toLowerCase().includes(text.toLowerCase()));
}

assert.equal(
  pkg.scripts["v2:release-phase32"],
  "node scripts/v2-release-phase32-smoke.mjs",
);
assert.equal(
  pkg.scripts["v2:release-phase32-evidence"],
  "node scripts/v2-release-phase32-evidence.mjs",
);
assert.ok(pkg.scripts.test.includes("npm run v2:release-phase31"));
assert.ok(pkg.scripts.test.includes("npm run v2:release-phase32"));
assert.equal(
  pkg.scripts.test.indexOf("npm run v2:release-phase31") <
    pkg.scripts.test.indexOf("npm run v2:release-phase32"),
  true,
);

for (const text of [
  "External Evidence Validator + Go-Live Gate Aggregator",
  "8/8",
  "SHA-256",
  "READY_FOR_HUMAN_RELEASE_AUTHORIZATION",
  "never auto-merges",
  "No new production environment variables",
  "No .env file",
]) {
  assert.ok(docs.includes(text), "Phase 32 docs must include: " + text);
}

console.log(
  "Release Phase 32 external evidence validator contract passed: 8 gates remain fail-closed until real sanitized evidence is supplied.",
);
