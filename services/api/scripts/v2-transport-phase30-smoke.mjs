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

const [
  closureText,
  phase27Text,
  phase28Text,
  authorityText,
  evidenceText,
  validator,
  pkgText,
  ci,
  docs,
] = await Promise.all([
  readRepo("ops/transport/transport-final-closure-phase30.json"),
  readRepo("ops/transport/transport-phases8-26-integration-contract.json"),
  readRepo("ops/transport/transport-e2e-acceptance-phase28.json"),
  readRepo("docs/v2/traceability/functional-id-authority-v1.csv"),
  readRepo("docs/v2/traceability/pr-reconciliation-evidence-20261001.csv"),
  readRepo(".ci/validate-v2-functional-id-authority.mjs"),
  readApi("package.json"),
  readRepo(".github/workflows/ci.yml"),
  readRepo("docs/transport-final-integration-closure-phase30.md"),
]);

const closure = JSON.parse(closureText);
const phase27 = JSON.parse(phase27Text);
const phase28 = JSON.parse(phase28Text);
const pkg = JSON.parse(pkgText);

assert.equal(closure.schemaVersion, 1);
assert.equal(closure.scope, "carepoint-transport-v2-final-integration-closure");
assert.deepEqual(closure.transportPhaseRange, { from: 8, to: 30 });
assert.equal(closure.canonicalFunctionalIdTarget, 230);
assert.equal(closure.canonicalMergeTarget, "main");
assert.equal(closure.consolidatedValidationPr, 497);
assert.equal(closure.productionAcceptance, false);
assert.equal(closure.mainMergeAllowed, false);
assert.equal(closure.mergeReadiness, "PENDING_FULL_CONSOLIDATED_MATRIX");

for (const principle of [
  "NO_GATE_WAIVED_FOR_SPEED",
  "STACKED_PR_FAST_LANE_DOES_NOT_REPLACE_CANONICAL_MATRIX",
  "TRACEABILITY_COMPLETE_DOES_NOT_EQUAL_PRODUCTION_ACCEPTANCE",
  "MAIN_REMAINS_UNCHANGED_UNTIL_EXPLICIT_FINAL_MERGE_DECISION",
]) {
  assert.ok(closure.closurePrinciples.includes(principle));
}

assert.equal(phase27.productionAcceptance, false);
assert.equal(phase27.validation.fullMatrixRequiredBeforeMerge, true);
assert.equal(phase27.validation.mainMergeAllowed, false);
assert.deepEqual(
  phase27.phases.map((item) => item.phase),
  Array.from({ length: 19 }, (_, index) => index + 8),
);

assert.equal(phase28.productionAcceptance, false);
assert.equal(phase28.fullMatrixStillRequired, true);
assert.equal(phase28.liveUatEvidenceStillRequired, true);
assert.equal(phase28.scenarios.length, 12);

const authorityLines = authorityText.trim().split("\n");
assert.equal(
  authorityLines[0],
  "canonical_id,domain,authority_version,claimed_by_prs,legacy_aliases,traceability_state",
);
const authorityRows = authorityLines.slice(1).map((line) => line.split(","));
assert.equal(authorityRows.length, 230);
assert.equal(
  new Set(authorityRows.map((row) => row[0])).size,
  230,
  "canonical IDs must remain unique",
);
for (const row of authorityRows) {
  assert.equal(row[5], "MERGED_TO_MAIN", `${row[0]} must have merged implementation evidence`);
  assert.ok(row[3], `${row[0]} must retain one or more merged PR references`);
}

const evidenceLines = evidenceText.trim().split("\n");
assert.equal(
  evidenceLines[0],
  "pr_number,github_state,merged,merged_at,authority_row_references,superseded_by_pr",
);
const prEvidence = new Map(
  evidenceLines.slice(1).map((line) => {
    const row = line.split(",");
    return [row[0], row];
  }),
);
for (const row of authorityRows) {
  for (const prRef of row[3].split(";").filter(Boolean)) {
    const evidence = prEvidence.get(prRef);
    assert.ok(evidence, `missing PR evidence row for ${prRef}`);
    assert.equal(evidence[1], "closed");
    assert.equal(evidence[2], "true", `${prRef} must have merged evidence`);
    assert.ok(evidence[3], `${prRef} must have merged_at evidence`);
  }
}
assert.ok(
  validator.includes("V2 PR reconciliation evidence OK"),
  "authority validator must enforce PR evidence consistency",
);

for (let phase = 8; phase <= 30; phase += 1) {
  const scriptName = `v2:transport-phase${phase}`;
  assert.equal(typeof pkg.scripts[scriptName], "string", `missing ${scriptName}`);
  assert.ok(pkg.scripts.test.includes(`npm run ${scriptName}`), `npm test must include ${scriptName}`);
}
assert.equal(
  pkg.scripts["v2:transport-phase29-postgres"],
  "node --test scripts/v2-transport-phase29-postgres.mjs",
);

const deployIndex = ci.indexOf("- run: npm run db:deploy");
const pgIndex = ci.indexOf("Transport Phase 29 PostgreSQL transactional acceptance");
const bootstrapIndex = ci.indexOf("- run: npm run db:bootstrap");
assert.ok(deployIndex >= 0 && pgIndex > deployIndex && bootstrapIndex > pgIndex);

for (const path of Object.values(closure.requiredEvidence)) {
  assert.equal(await existsRepo(path), true, `missing closure evidence file: ${path}`);
}
for (const path of closure.requiredCanonicalWorkflowFiles) {
  assert.equal(await existsRepo(path), true, `missing canonical workflow: ${path}`);
}

assert.equal(closure.requiredCanonicalWorkflowFiles.length, 25);
assert.equal(closure.remainingExternalGoLiveGates.length, 8);
for (const gate of [
  "PRODUCTION_INFRASTRUCTURE_LIVE_EVIDENCE",
  "SIGNED_ANDROID_IOS_RELEASE_EVIDENCE",
  "INDEPENDENT_SECURITY_PENTEST",
  "HUMAN_UAT_SIGNOFF",
  "KSA_COMPLIANCE_LICENSING_CLINICAL_APPROVAL",
]) {
  assert.ok(closure.remainingExternalGoLiveGates.includes(gate));
}

const serialized = JSON.stringify(closure);
for (const forbidden of [".env", "secretValue", "privateKey", "accessToken", "password"]) {
  assert.equal(serialized.includes(forbidden), false, `closure contract must not embed: ${forbidden}`);
}

for (const text of [
  "Final Integration Closure Gate",
  "230/230",
  "does not equal Go-Live",
  "PENDING_FULL_CONSOLIDATED_MATRIX",
  "No new production environment variables",
  "No .env file",
]) {
  assert.ok(docs.includes(text), `Phase 30 docs must include: ${text}`);
}

console.log(
  "Transport Phase 30 final integration closure gate passed: 230/230 merged traceability IDs, phases 8-30 registered, production acceptance still false.",
);
