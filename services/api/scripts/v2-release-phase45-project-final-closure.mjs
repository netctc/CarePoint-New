import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve,isAbsolute,relative } from "node:path";
import { fileURLToPath } from "node:url";

const root=fileURLToPath(new URL("../../../",import.meta.url));
const [closureArg,readinessArg,phase44ValidationArg]=process.argv.slice(2);
if(!closureArg||!readinessArg||!phase44ValidationArg){
  process.stderr.write("Usage: node scripts/v2-release-phase45-project-final-closure.mjs <closure-record.json> <phase44-readiness-record.json> <phase44-validation-result.json>\n");
  process.exit(64);
}
for(const p of [closureArg,readinessArg,phase44ValidationArg]){
  if(isAbsolute(p)) throw new Error("Inputs must be repository-relative.");
  const abs=resolve(root,p), rel=relative(root,abs);
  if(rel.startsWith("..")||rel.includes("../")) throw new Error("Input escapes repository root.");
}
const [closureText,readinessText,phase44ValidationText]=await Promise.all([
  readFile(resolve(root,closureArg),"utf8"),
  readFile(resolve(root,readinessArg),"utf8"),
  readFile(resolve(root,phase44ValidationArg),"utf8")
]);
const c=JSON.parse(closureText), r=JSON.parse(readinessText), v=JSON.parse(phase44ValidationText);
assert.equal(c.schema,"carepoint.project-final-closure-record/v1");
assert.equal(r.schema,"carepoint.project-closure-readiness-record/v1");
assert.equal(v.schema,"carepoint.project-closure-readiness-validation/v1");
assert.equal(c.releaseCandidate.consolidatedPr,r.releaseCandidate.consolidatedPr);
assert.equal(c.releaseCandidate.sourceSha,r.releaseCandidate.sourceSha);
assert.equal(c.releaseCandidate.consolidatedPr,v.releaseCandidate.consolidatedPr);
assert.equal(c.releaseCandidate.sourceSha,v.releaseCandidate.sourceSha);
assert.ok(["PENDING","CLOSED"].includes(c.closure.status));
assert.equal(c.automaticClosurePerformed,false);

const validatedReadiness=
  v.projectClosureReady===true &&
  v.functionalTraceabilityComplete===true &&
  v.externalGatesAccepted===true &&
  v.acceptedExternalGateCount===8 &&
  v.releaseLifecycleComplete===true;
const readinessApproved=
  r.readiness?.status==="READY" &&
  r.projectClosureReady===true &&
  validatedReadiness;
if(c.closure.status==="CLOSED"){
  assert.equal(
    readinessApproved,
    true,
    "Final project closure is forbidden until a Phase 44 validation result proves 230/230 traceability, 8/8 external gates and lifecycle completion."
  );
  for(const [k,v] of Object.entries(c.confirmations)) assert.equal(v,true,`Final closure confirmation must be true: ${k}`);
  assert.ok(c.readinessRef);
  assert.ok(c.closure.closedByRef);
  assert.ok(c.closure.closureDecisionRef);
  assert.ok(c.closure.closedAt && !Number.isNaN(Date.parse(c.closure.closedAt)));
  assert.equal(c.projectClosed,true);
}
if(c.closure.status!=="CLOSED") assert.equal(c.projectClosed,false);

process.stdout.write(JSON.stringify({
  schema:"carepoint.project-final-closure-validation/v1",
  phase44ReadinessApproved:readinessApproved,
  phase44ValidationResultAccepted:validatedReadiness,
  closureStatus:c.closure.status,
  projectClosed:c.projectClosed,
  automaticClosurePerformed:false,
  finalHumanDecisionRequired:!c.projectClosed
},null,2)+"\n");
process.exitCode=c.projectClosed?0:2;
