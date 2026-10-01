import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const apiRoot = new URL("../", import.meta.url);
const repoRoot = new URL("../../../", import.meta.url);
const readApi = (path) => readFile(new URL(path, apiRoot), "utf8");
const readRepo = (path) => readFile(new URL(path, repoRoot), "utf8");
const existsRepo = async (path) => {
  try {
    await access(new URL(path, repoRoot));
    return true;
  } catch {
    return false;
  }
};

const [contractText, securityText, docs, pkgText] = await Promise.all([
  readRepo("ops/release-1/final-go-live-gate-readiness-phase31.json"),
  readRepo("ops/release-1/independent-security-assessment-evidence.example.json"),
  readRepo("docs/release-external-go-live-readiness-phase31.md"),
  readApi("package.json"),
]);
const contract = JSON.parse(contractText);
const security = JSON.parse(securityText);
const pkg = JSON.parse(pkgText);

assert.equal(contract.schemaVersion, 1);
assert.equal(contract.schema, "carepoint.final-go-live-gate-readiness/v1");
assert.equal(contract.baselineValidation.consolidatedPr, 497);
assert.equal(
  contract.baselineValidation.validatedHead,
  "2b0d4202e9f4bc55b2101c82b99dd659d04d1c27",
);
assert.equal(contract.baselineValidation.canonicalWorkflowCount, 25);
assert.equal(contract.baselineValidation.canonicalMatrixConclusion, "SUCCESS");
assert.equal(
  contract.baselineValidation.functionalTraceability,
  "230/230_MERGED_IMPLEMENTATION_EVIDENCE",
);
assert.equal(contract.productionAcceptance, false);
assert.equal(contract.mainMergeAllowed, false);
assert.equal(contract.externalEvidenceGateCount, 8);
assert.equal(contract.gates.length, 8);

const ids = new Set();
for (const gate of contract.gates) {
  assert.equal(ids.has(gate.id), false, "duplicate external gate " + gate.id);
  ids.add(gate.id);
  assert.equal(gate.externalEvidenceRequired, true);
  assert.equal(gate.automatedContractIsSufficient, false);
  assert.equal(gate.autoClosable, false);
  assert.ok(gate.automatedWorkflow);
  assert.ok(gate.evidenceTemplate);
  assert.equal(await existsRepo(gate.evidenceTemplate), true, "missing evidence template " + gate.evidenceTemplate);
  assert.ok(Array.isArray(gate.blockingUntil) && gate.blockingUntil.length > 0);
}

for (const invariant of [
  "AUTOMATED_GREEN_DOES_NOT_EQUAL_LIVE_ACCEPTANCE",
  "NO_EXTERNAL_EVIDENCE_MAY_BE_SYNTHESIZED",
  "NO_GATE_MAY_BE_AUTO_CLOSED",
  "NO_SECRETS_OR_RESTRICTED_REPORT_CONTENT_IN_REPOSITORY",
  "MAIN_REMAINS_UNCHANGED_UNTIL_EXPLICIT_FINAL_MERGE_DECISION",
]) {
  assert.ok(contract.invariants.includes(invariant));
}

assert.equal(security.schema, "carepoint.independent-security-assessment-evidence/v1");
assert.equal(security.approved, false);
assert.equal(security.overallStatus, "DRAFT");
assert.equal(security.sensitiveDataIncluded, false);
assert.equal(security.restrictedReportContentIncluded, false);
assert.equal(security.assessment.independenceConfirmed, false);
assert.equal(security.assessment.manualTestingPerformed, false);
assert.equal(security.assessment.productionValidationAuthorized, false);
assert.equal(security.findings.countsKnown, false);
assert.equal(security.findings.critical, null);
assert.equal(security.findings.high, null);
assert.equal(security.approvals.security, false);
assert.equal(security.approvals.releaseAuthority, false);
assert.equal(security.finalDecision, "BLOCKED");
assert.equal(security.acceptedAt, null);

const existingTemplates = [
  "ops/release-1/production-infrastructure-evidence.example.json",
  "ops/release-1/external-integration-evidence.example.json",
  "ops/release-1/mobile-release-evidence.example.json",
  "ops/release-1/uat-evidence.example.json",
  "ops/release-1/resilience-exercise-plan.example.json",
  "ops/release-1/market-readiness-evidence.example.json",
  "ops/release-1/deployment-rehearsal-evidence.example.json",
];
for (const path of existingTemplates) {
  assert.equal(await existsRepo(path), true, "missing existing live-evidence template " + path);
}

assert.equal(
  pkg.scripts["v2:release-phase31"],
  "node scripts/v2-release-phase31-smoke.mjs",
);
assert.ok(pkg.scripts.test.includes("npm run v2:release-phase31"));

for (const text of [
  "External Go-Live Evidence Readiness",
  "25/25",
  "230/230",
  "automatedContractIsSufficient=false",
  "No pentest result is invented",
  "productionAcceptance remains false",
  "No new production environment variables",
  "No .env file",
]) {
  assert.ok(docs.includes(text), "Phase 31 docs must include: " + text);
}

const serialized = JSON.stringify({ contract, security });
for (const forbidden of [
  '"password"',
  '"accessToken"',
  '"privateKey"',
  '"secretValue"',
  '"patientName"',
  '"patientId"',
]) {
  assert.equal(serialized.includes(forbidden), false, "Phase 31 artifacts must not embed " + forbidden);
}

console.log(
  "Release Phase 31 external evidence readiness passed: 8 external gates remain explicit and non-auto-closable.",
);
