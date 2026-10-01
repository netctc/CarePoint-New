import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve,isAbsolute,relative } from "node:path";
import { fileURLToPath } from "node:url";
const root=fileURLToPath(new URL("../../../",import.meta.url));
const [recordArg,closureArg,phase42ValidationArg]=process.argv.slice(2);
if(!recordArg||!closureArg||!phase42ValidationArg){
  process.stderr.write("Usage: node scripts/v2-release-phase43-hypercare.mjs <hypercare-record.json> <phase42-closure.json> <phase42-validation-result.json>\n");
  process.exit(64);
}
for(const p of [recordArg,closureArg,phase42ValidationArg]){
  if(isAbsolute(p)) throw new Error("Inputs must be repository-relative.");
  const abs=resolve(root,p), rel=relative(root,abs);
  if(rel.startsWith("..")||rel.includes("../")) throw new Error("Input escapes repository root.");
}
const [recordText,closureText,phase42ValidationText]=await Promise.all([
  readFile(resolve(root,recordArg),"utf8"),
  readFile(resolve(root,closureArg),"utf8"),
  readFile(resolve(root,phase42ValidationArg),"utf8")
]);
const r=JSON.parse(recordText), c=JSON.parse(closureText), v=JSON.parse(phase42ValidationText);
assert.equal(r.schema,"carepoint.release-hypercare-record/v1");
assert.equal(c.schema,"carepoint.release-closure-record/v1");
assert.equal(v.schema,"carepoint.release-closure-validation/v1");
assert.equal(r.releaseCandidate.consolidatedPr,c.releaseCandidate.consolidatedPr);
assert.equal(r.releaseCandidate.sourceSha,c.releaseCandidate.sourceSha);
assert.equal(r.releaseCandidate.consolidatedPr,v.releaseCandidate.consolidatedPr);
assert.equal(r.releaseCandidate.sourceSha,v.releaseCandidate.sourceSha);
assert.ok(["PENDING","ACTIVE","EXITED"].includes(r.hypercare.status));
const closureReady=
  c.closure?.status==="CLOSED" &&
  c.releaseClosed===true &&
  c.hypercareRequired===true &&
  v.closureStatus==="CLOSED" &&
  v.releaseClosed===true &&
  v.hypercareRequired===true &&
  v.automaticClosurePerformed===false;
if(r.hypercare.status!=="PENDING") assert.equal(closureReady,true,"Hypercare cannot start before Phase 42 release closure.");
if(r.hypercare.status==="EXITED"){
  assert.equal(r.exitCriteria.length,6);
  for(const item of r.exitCriteria){
    assert.equal(item.status,"PASS",`Hypercare exit criterion must PASS: ${item.id}`);
    assert.ok(item.evidenceRef,`${item.id} evidenceRef is required.`);
  }
  assert.ok(r.hypercare.startedAt && !Number.isNaN(Date.parse(r.hypercare.startedAt)));
  assert.ok(r.hypercare.endedAt && !Number.isNaN(Date.parse(r.hypercare.endedAt)));
  assert.ok(r.hypercare.ownerRef);
  assert.ok(r.hypercare.incidentReviewRef);
  assert.equal(r.hypercareExited,true);
  assert.equal(r.operationalHandoffComplete,true);
}
if(r.hypercare.status!=="EXITED"){
  assert.equal(r.hypercareExited,false);
  assert.equal(r.operationalHandoffComplete,false);
}
process.stdout.write(JSON.stringify({
 schema:"carepoint.release-hypercare-validation/v1",
 releaseCandidate:r.releaseCandidate,
 hypercareStatus:r.hypercare.status,
 hypercareExited:r.hypercareExited,
 operationalHandoffComplete:r.operationalHandoffComplete,
 releaseLifecycleComplete:r.hypercareExited && r.operationalHandoffComplete
},null,2)+"\n");
process.exitCode=r.hypercare.status==="EXITED"?0:2;
