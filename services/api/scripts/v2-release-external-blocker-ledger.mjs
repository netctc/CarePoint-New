import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const repoRoot=new URL("../../../",import.meta.url);
const [ledgerText,phase31Text]=await Promise.all([
  readFile(new URL("ops/release-1/external-closure-blocker-ledger-20261001.json",repoRoot),"utf8"),
  readFile(new URL("ops/release-1/final-go-live-gate-readiness-phase31.json",repoRoot),"utf8")
]);
const ledger=JSON.parse(ledgerText);
const phase31=JSON.parse(phase31Text);

assert.equal(ledger.schema,"carepoint.external-closure-blocker-ledger/v1");
assert.equal(phase31.schema,"carepoint.final-go-live-gate-readiness/v1");
assert.equal(ledger.gates.length,8);
assert.equal(phase31.gates.length,8);

const expectedIds=phase31.gates.map(g=>g.id);
assert.deepEqual(ledger.gates.map(g=>g.id),expectedIds);

const phase31ById=new Map(phase31.gates.map(g=>[g.id,g]));
for(const gate of ledger.gates){
  const canonical=phase31ById.get(gate.id);
  assert.equal(gate.status,"EXTERNAL_PENDING",`${gate.id} must remain EXTERNAL_PENDING until real evidence is accepted.`);
  assert.equal(gate.automatedWorkflow,canonical.automatedWorkflow,`${gate.id} workflow must match Phase 31.`);
  assert.equal(gate.evidenceTemplate,canonical.evidenceTemplate,`${gate.id} evidence template must match Phase 31.`);
  assert.ok(gate.primaryIssues.length>0,`${gate.id} requires at least one primary GitHub issue reference.`);
  assert.ok(gate.ownerRoles.length>0,`${gate.id} requires owner roles.`);
  assert.ok(gate.requiredEvidence.length>0,`${gate.id} requires explicit evidence requirements.`);
  assert.ok(gate.primaryIssues.every(Number.isInteger));
  assert.ok(gate.relatedIssues.every(Number.isInteger));
}

assert.equal(ledger.invariants.productionAcceptance,false);
assert.equal(ledger.invariants.mainMergeAllowed,false);
assert.equal(ledger.invariants.projectClosureReady,false);
assert.equal(ledger.invariants.projectClosed,false);
assert.equal(ledger.invariants.externalEvidenceMayBeSynthesized,false);
assert.equal(ledger.invariants.autoCloseAllowed,false);
assert.equal(ledger.decision,"BLOCKED_ON_EXTERNAL_HUMAN_EVIDENCE");

const uniqueIssues=new Set(
  ledger.gates.flatMap(g=>[...g.primaryIssues,...g.relatedIssues])
);
assert.ok(uniqueIssues.has(79));
assert.ok(uniqueIssues.has(80));
assert.ok(uniqueIssues.has(81));
assert.ok(uniqueIssues.has(85));
assert.ok(uniqueIssues.has(87));
assert.ok(uniqueIssues.has(89));
assert.ok(uniqueIssues.has(92));
assert.ok(uniqueIssues.has(98));
assert.ok(uniqueIssues.has(124));
assert.equal(uniqueIssues.size,22,"Exactly 22 non-master open issues must be mapped to external gates in the 2026-10-01 snapshot.");
assert.equal(ledger.repositoryOpenIssueSnapshot.observedOpenIssueCount,23);
assert.equal(ledger.repositoryOpenIssueSnapshot.masterTrackerIssue,70);
assert.equal(ledger.repositoryOpenIssueSnapshot.gateMappedOpenIssueCount,22);
assert.equal(ledger.repositoryOpenIssueSnapshot.unmappedOpenIssueCount,0);
assert.deepEqual(ledger.repositoryOpenIssueSnapshot.gateMappedIssues,[...uniqueIssues].sort((a,b)=>a-b));
assert.equal(
  ledger.repositoryOpenIssueSnapshot.classification,
  "ALL_OPEN_ISSUES_ACCOUNTED_FOR_BY_MASTER_TRACKER_OR_EXTERNAL_GATE_LEDGER"
);

console.log(
  `External closure blocker ledger OK: ${ledger.gates.length} gates, ${uniqueIssues.size} linked issue references, decision=${ledger.decision}.`
);
