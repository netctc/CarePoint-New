import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve,isAbsolute,relative } from "node:path";
import { fileURLToPath } from "node:url";
const root=fileURLToPath(new URL("../../../",import.meta.url));
const [recordArg,readinessArg]=process.argv.slice(2);
if(!recordArg||!readinessArg){process.stderr.write("Usage: node scripts/v2-release-phase41-final-acceptance.mjs <record.json> <phase40-readiness.json>\n");process.exit(64);}
for(const p of [recordArg,readinessArg]){
  if(isAbsolute(p)) throw new Error("Inputs must be repository-relative.");
  const abs=resolve(root,p), rel=relative(root,abs);
  if(rel.startsWith("..")||rel.includes("../")) throw new Error("Input escapes repository root.");
}
const [recordText,readinessText]=await Promise.all([readFile(resolve(root,recordArg),"utf8"),readFile(resolve(root,readinessArg),"utf8")]);
const r=JSON.parse(recordText), q=JSON.parse(readinessText);
assert.equal(r.schema,"carepoint.final-production-acceptance-record/v1");
assert.equal(q.schema,"carepoint.final-release-closure-readiness/v1");
assert.equal(r.releaseCandidate.consolidatedPr,q.releaseCandidate.consolidatedPr);
assert.equal(r.releaseCandidate.sourceSha,q.releaseCandidate.sourceSha);
assert.ok(["PENDING","ACCEPTED","REJECTED"].includes(r.finalDecision.status));
const ready=
  q.finalDecision==="READY_FOR_FINAL_PRODUCTION_ACCEPTANCE_DECISION" &&
  q.readyForFinalProductionAcceptanceDecision===true &&
  q.prerequisitesReady===true &&
  q.productionExecutionHandoffReady===true &&
  q.postDeployValidationPassed===true &&
  q.productionAcceptancePerformed===false &&
  q.releaseClosurePerformed===false &&
  q.explicitHumanFinalDecisionRequired===true;
if(r.finalDecision.status==="ACCEPTED"){
  assert.equal(ready,true,"Production acceptance is forbidden until Phase 40 is READY.");
  for(const [k,v] of Object.entries(r.acknowledgements)) assert.equal(v,true,`Acknowledgement must be true: ${k}`);
  assert.ok(r.finalDecision.decidedByRef);
  assert.ok(r.finalDecision.decisionRef);
  assert.ok(r.finalDecision.decidedAt && !Number.isNaN(Date.parse(r.finalDecision.decidedAt)));
  assert.equal(r.productionAcceptance,true);
  assert.equal(r.releaseClosureAuthorized,true);
}
if(r.finalDecision.status!=="ACCEPTED"){
  assert.equal(r.productionAcceptance,false);
  assert.equal(r.releaseClosureAuthorized,false);
}
process.stdout.write(JSON.stringify({
  schema:"carepoint.final-production-acceptance-validation/v1",
  releaseCandidate:r.releaseCandidate,
  finalDecision:r.finalDecision.status,
  productionAcceptance:r.productionAcceptance,
  releaseClosureAuthorized:r.releaseClosureAuthorized,
  automaticClosurePerformed:false
},null,2)+"\n");
process.exitCode=r.finalDecision.status==="ACCEPTED"?0:2;
