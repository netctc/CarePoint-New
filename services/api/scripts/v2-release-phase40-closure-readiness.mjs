import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve,isAbsolute,relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot=fileURLToPath(new URL("../../../",import.meta.url));
const [phase39ValidationArg,phase38ValidationArg]=process.argv.slice(2);
if(!phase39ValidationArg||!phase38ValidationArg){
  process.stderr.write("Usage: node scripts/v2-release-phase40-closure-readiness.mjs <phase39-validation-result.json> <phase38-validation-result.json>\n");
  process.exit(64);
}
for(const p of [phase39ValidationArg,phase38ValidationArg]){
  if(isAbsolute(p)) throw new Error("Inputs must be repository-relative.");
  const abs=resolve(repoRoot,p), rel=relative(repoRoot,abs);
  if(rel.startsWith("..")||rel.includes("../")) throw new Error("Input escapes repository root.");
}
const [phase39Text,phase38Text]=await Promise.all([
  readFile(resolve(repoRoot,phase39ValidationArg),"utf8"),
  readFile(resolve(repoRoot,phase38ValidationArg),"utf8")
]);
const h=JSON.parse(phase39Text), p=JSON.parse(phase38Text);
assert.equal(h.schema,"carepoint.production-execution-handoff-validation/v1");
assert.equal(p.schema,"carepoint.post-deploy-validation-result/v1");
assert.equal(h.releaseCandidate.consolidatedPr,p.releaseCandidate.consolidatedPr);
assert.equal(h.releaseCandidate.sourceSha,p.releaseCandidate.sourceSha);
assert.equal(h.productionAcceptance,false);
assert.equal(h.releaseClosed,false);
assert.equal(p.productionAcceptance,false);
assert.equal(p.releaseClosed,false);

const prerequisitesReady=h.authorizationReady===true;
const handoffReady=
  h.readyForOperatorExecution===true &&
  h.executionStatus==="READY_FOR_OPERATOR_EXECUTION" &&
  h.operatorActionRequired===true &&
  h.automaticDeploymentPerformed===false;
const postDeployPassed=
  p.status==="PASSED" &&
  p.passedChecks===10 &&
  p.failedChecks===0 &&
  p.rollbackAssessmentRequired===false;
const ready=prerequisitesReady && handoffReady && postDeployPassed;

process.stdout.write(JSON.stringify({
  schema:"carepoint.final-release-closure-readiness/v1",
  releaseCandidate:h.releaseCandidate,
  prerequisitesReady,
  productionExecutionHandoffReady:handoffReady,
  postDeployValidationPassed:postDeployPassed,
  readyForFinalProductionAcceptanceDecision:ready,
  finalDecision:ready ? "READY_FOR_FINAL_PRODUCTION_ACCEPTANCE_DECISION" : "BLOCKED",
  productionAcceptancePerformed:false,
  releaseClosurePerformed:false,
  explicitHumanFinalDecisionRequired:true
},null,2)+"\n");
process.exitCode=ready?0:2;
