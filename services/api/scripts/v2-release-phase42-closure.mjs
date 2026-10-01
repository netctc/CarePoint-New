import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve,isAbsolute,relative } from "node:path";
import { fileURLToPath } from "node:url";
const root=fileURLToPath(new URL("../../../",import.meta.url));
const [recordArg,acceptanceArg]=process.argv.slice(2);
if(!recordArg||!acceptanceArg){process.stderr.write("Usage: node scripts/v2-release-phase42-closure.mjs <closure-record.json> <phase41-acceptance.json>\n");process.exit(64);}
for(const p of [recordArg,acceptanceArg]){
  if(isAbsolute(p)) throw new Error("Inputs must be repository-relative.");
  const abs=resolve(root,p), rel=relative(root,abs);
  if(rel.startsWith("..")||rel.includes("../")) throw new Error("Input escapes repository root.");
}
const [recordText,acceptanceText]=await Promise.all([
  readFile(resolve(root,recordArg),"utf8"),
  readFile(resolve(root,acceptanceArg),"utf8")
]);
const r=JSON.parse(recordText), a=JSON.parse(acceptanceText);
assert.equal(r.schema,"carepoint.release-closure-record/v1");
assert.equal(a.schema,"carepoint.final-production-acceptance-record/v1");
assert.equal(r.releaseCandidate.consolidatedPr,a.releaseCandidate.consolidatedPr);
assert.equal(r.releaseCandidate.sourceSha,a.releaseCandidate.sourceSha);
assert.ok(["PENDING","CLOSED"].includes(r.closure.status));
const acceptanceReady=a.finalDecision?.status==="ACCEPTED" && a.productionAcceptance===true && a.releaseClosureAuthorized===true;
if(r.closure.status==="CLOSED"){
  assert.equal(acceptanceReady,true,"Release closure is forbidden until Phase 41 production acceptance is ACCEPTED.");
  for(const [k,v] of Object.entries(r.confirmations)) assert.equal(v,true,`Closure confirmation must be true: ${k}`);
  assert.ok(r.productionAcceptanceRef);
  assert.ok(r.closure.closedByRef);
  assert.ok(r.closure.closureRef);
  assert.ok(r.closure.closedAt && !Number.isNaN(Date.parse(r.closure.closedAt)));
  assert.equal(r.releaseClosed,true);
}
if(r.closure.status!=="CLOSED") assert.equal(r.releaseClosed,false);
assert.equal(r.hypercareRequired,true);
process.stdout.write(JSON.stringify({
  schema:"carepoint.release-closure-validation/v1",
  closureStatus:r.closure.status,
  releaseClosed:r.releaseClosed,
  hypercareRequired:true,
  automaticClosurePerformed:false
},null,2)+"\n");
process.exitCode=r.closure.status==="CLOSED"?0:2;
