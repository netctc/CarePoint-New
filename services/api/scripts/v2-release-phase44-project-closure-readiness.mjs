import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve,isAbsolute,relative } from "node:path";
import { fileURLToPath } from "node:url";

const root=fileURLToPath(new URL("../../../",import.meta.url));
const [readinessArg,hypercareArg]=process.argv.slice(2);
if(!readinessArg||!hypercareArg){
  process.stderr.write("Usage: node scripts/v2-release-phase44-project-closure-readiness.mjs <readiness-record.json> <phase43-hypercare.json>\n");
  process.exit(64);
}
for(const p of [readinessArg,hypercareArg]){
  if(isAbsolute(p)) throw new Error("Inputs must be repository-relative.");
  const abs=resolve(root,p), rel=relative(root,abs);
  if(rel.startsWith("..")||rel.includes("../")) throw new Error("Input escapes repository root.");
}

const parseCsvLine=(line)=>{
  const fields=[]; let value=""; let quoted=false;
  for(let i=0;i<line.length;i+=1){
    const ch=line[i];
    if(ch==='"'){
      if(quoted && line[i+1]==='"'){value+='"';i+=1;} else quoted=!quoted;
    } else if(ch==="," && !quoted){fields.push(value);value="";} else value+=ch;
  }
  fields.push(value);
  assert.equal(quoted,false,"Unterminated CSV field.");
  return fields;
};

const [readinessText,hypercareText,authorityText]=await Promise.all([
  readFile(resolve(root,readinessArg),"utf8"),
  readFile(resolve(root,hypercareArg),"utf8"),
  readFile(resolve(root,"docs/v2/traceability/functional-id-authority-v1.csv"),"utf8")
]);
const r=JSON.parse(readinessText), h=JSON.parse(hypercareText);
assert.equal(r.schema,"carepoint.project-closure-readiness-record/v1");
assert.equal(h.schema,"carepoint.release-hypercare-record/v1");
assert.equal(r.releaseCandidate.consolidatedPr,h.releaseCandidate.consolidatedPr);
assert.equal(r.releaseCandidate.sourceSha,h.releaseCandidate.sourceSha);

const rows=authorityText.replace(/\r\n/g,"\n").trimEnd().split("\n").map(parseCsvLine);
assert.equal(rows.length,231,"Functional authority must contain header + 230 canonical IDs.");
assert.equal(rows[0][0],"canonical_id");
assert.equal(rows[0][5],"traceability_state");
const body=rows.slice(1);
const mergedCount=body.filter(row=>row[5]==="MERGED_TO_MAIN").length;
assert.equal(mergedCount,230,"All 230 canonical functional IDs must be MERGED_TO_MAIN.");

const lifecycleComplete=h.hypercare?.status==="EXITED" &&
  h.hypercareExited===true &&
  h.operationalHandoffComplete===true;

assert.ok(["PENDING","READY"].includes(r.readiness.status));
if(r.readiness.status==="READY"){
  assert.equal(lifecycleComplete,true,"Project closure readiness requires Phase 43 lifecycle completion.");
  for(const [k,v] of Object.entries(r.checklist)) assert.equal(v,true,`Project closure checklist must be true: ${k}`);
  assert.ok(r.readiness.assessedByRef);
  assert.ok(r.readiness.assessmentRef);
  assert.ok(r.readiness.assessedAt && !Number.isNaN(Date.parse(r.readiness.assessedAt)));
  assert.equal(r.projectClosureReady,true);
}
if(r.readiness.status!=="READY") assert.equal(r.projectClosureReady,false);

process.stdout.write(JSON.stringify({
  schema:"carepoint.project-closure-readiness-validation/v1",
  canonicalFunctionalIds:body.length,
  mergedFunctionalIds:mergedCount,
  functionalTraceabilityComplete:mergedCount===230,
  releaseLifecycleComplete:lifecycleComplete,
  readinessStatus:r.readiness.status,
  projectClosureReady:r.projectClosureReady,
  automaticProjectClosurePerformed:false
},null,2)+"\n");
process.exitCode=r.projectClosureReady?0:2;
