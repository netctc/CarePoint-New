import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve,isAbsolute,relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot=fileURLToPath(new URL("../../../",import.meta.url));
const [handoffArg,postdeployArg]=process.argv.slice(2);
if(!handoffArg||!postdeployArg){
  process.stderr.write("Usage: node scripts/v2-release-phase40-closure-readiness.mjs <handoff.json> <postdeploy.json>\n");
  process.exit(64);
}
for(const p of [handoffArg,postdeployArg]){
  if(isAbsolute(p)) throw new Error("Inputs must be repository-relative.");
  const abs=resolve(repoRoot,p), rel=relative(repoRoot,abs);
  if(rel.startsWith("..")||rel.includes("../")) throw new Error("Input escapes repository root.");
}
const [handoffText,postText]=await Promise.all([
  readFile(resolve(repoRoot,handoffArg),"utf8"),
  readFile(resolve(repoRoot,postdeployArg),"utf8")
]);
const h=JSON.parse(handoffText), p=JSON.parse(postText);
assert.equal(h.schema,"carepoint.production-execution-handoff/v1");
assert.equal(p.schema,"carepoint.post-deploy-validation-record/v1");
assert.equal(h.releaseCandidate.consolidatedPr,p.releaseCandidate.consolidatedPr);
assert.equal(h.releaseCandidate.sourceSha,p.releaseCandidate.sourceSha);
assert.equal(h.productionAcceptance,false);
assert.equal(h.releaseClosed,false);
assert.equal(p.productionAcceptance,false);
assert.equal(p.releaseClosed,false);

const prerequisitesReady=Object.values(h.prerequisites).every(Boolean);
const handoffReady=h.execution.status==="READY_FOR_OPERATOR_EXECUTION";
const postDeployPassed=p.validation.status==="PASSED" && p.checks.every(c=>c.status==="PASS");
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
