import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve,isAbsolute,relative } from "node:path";
import { fileURLToPath } from "node:url";
const repoRoot=fileURLToPath(new URL("../../../",import.meta.url));
const [handoffArg,phase37ValidationArg]=process.argv.slice(2);
if(!handoffArg||!phase37ValidationArg){
  process.stderr.write("Usage: node scripts/v2-release-phase39-handoff.mjs <handoff.json> <phase37-validation-result.json>\n");
  process.exit(64);
}
for(const p of [handoffArg,phase37ValidationArg]){
  if(isAbsolute(p)) throw new Error("Input must be repository-relative.");
  const abs=resolve(repoRoot,p), rel=relative(repoRoot,abs);
  if(rel.startsWith("..")||rel.includes("../")) throw new Error("Input escapes repository root.");
}
const [handoffText,phase37Text]=await Promise.all([
  readFile(resolve(repoRoot,handoffArg),"utf8"),
  readFile(resolve(repoRoot,phase37ValidationArg),"utf8")
]);
const h=JSON.parse(handoffText), authorization=JSON.parse(phase37Text);
assert.equal(h.schema,"carepoint.production-execution-handoff/v1");
assert.equal(authorization.schema,"carepoint.merge-deploy-authorization-validation/v1");
assert.equal(h.releaseCandidate.consolidatedPr,authorization.releaseCandidate.consolidatedPr);
assert.equal(h.releaseCandidate.sourceSha,authorization.releaseCandidate.sourceSha);
assert.equal(h.productionAcceptance,false);
assert.equal(h.releaseClosed,false);
assert.ok(["BLOCKED","READY_FOR_OPERATOR_EXECUTION"].includes(h.execution.status));
const evidenceAccepted=authorization.acceptedGateCount===8;
assert.equal(h.prerequisites.externalEvidenceEightOfEight,evidenceAccepted);
assert.equal(h.prerequisites.humanReleaseAuthorization,authorization.humanReleaseAuthorizationRecorded);
assert.equal(h.prerequisites.mergeAuthorization,authorization.mainMergeAuthorized);
assert.equal(h.prerequisites.deploymentAuthorization,authorization.deploymentAuthorized);

const authorizationReady=
  evidenceAccepted &&
  authorization.humanReleaseAuthorizationRecorded===true &&
  authorization.mainMergeAuthorized===true &&
  authorization.deploymentAuthorized===true &&
  authorization.productionAcceptance===false &&
  authorization.postDeployValidationRequired===true;
const prerequisitesReady=authorizationReady && h.prerequisites.changeWindowApproved===true;
const executionReady=h.execution.status==="READY_FOR_OPERATOR_EXECUTION";
if(executionReady){
  assert.equal(prerequisitesReady,true,"READY_FOR_OPERATOR_EXECUTION requires validated Phase 37 authorization plus an approved change window.");
  for(const k of ["operatorRef","changeWindowRef","deploymentRunbookRef","rollbackRunbookRef","postDeployValidationRecord"]){
    assert.ok(h.execution[k], `execution.${k} is required.`);
  }
}
if(!executionReady) assert.equal(h.execution.status,"BLOCKED");
const ready=prerequisitesReady && executionReady;
process.stdout.write(JSON.stringify({
 schema:"carepoint.production-execution-handoff-validation/v1",
 releaseCandidate:h.releaseCandidate,
 authorizationReady,
 readyForOperatorExecution:ready,
 executionStatus:h.execution.status,
 operatorActionRequired:true,
 automaticDeploymentPerformed:false,
 productionAcceptance:false,
 releaseClosed:false
},null,2)+"\n");
process.exitCode=ready?0:2;
