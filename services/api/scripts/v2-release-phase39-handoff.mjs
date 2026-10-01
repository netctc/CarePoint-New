import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve,isAbsolute,relative } from "node:path";
import { fileURLToPath } from "node:url";
const repoRoot=fileURLToPath(new URL("../../../",import.meta.url));
const p=process.argv[2];
if(!p){process.stderr.write("Usage: node scripts/v2-release-phase39-handoff.mjs <handoff.json>\n");process.exit(64);}
if(isAbsolute(p)) throw new Error("Input must be repository-relative.");
const abs=resolve(repoRoot,p), rel=relative(repoRoot,abs);
if(rel.startsWith("..")||rel.includes("../")) throw new Error("Input escapes repository root.");
const h=JSON.parse(await readFile(abs,"utf8"));
assert.equal(h.schema,"carepoint.production-execution-handoff/v1");
assert.equal(h.productionAcceptance,false);
assert.equal(h.releaseClosed,false);
assert.ok(["BLOCKED","READY_FOR_OPERATOR_EXECUTION"].includes(h.execution.status));
const ready=Object.values(h.prerequisites).every(Boolean);
if(h.execution.status==="READY_FOR_OPERATOR_EXECUTION"){
  assert.equal(ready,true,"READY_FOR_OPERATOR_EXECUTION requires every prerequisite true.");
  for(const k of ["operatorRef","changeWindowRef","deploymentRunbookRef","rollbackRunbookRef","postDeployValidationRecord"]){
    assert.ok(h.execution[k], `execution.${k} is required.`);
  }
}
if(!ready) assert.equal(h.execution.status,"BLOCKED");
process.stdout.write(JSON.stringify({
 schema:"carepoint.production-execution-handoff-validation/v1",
 readyForOperatorExecution:ready,
 executionStatus:h.execution.status,
 operatorActionRequired:true,
 automaticDeploymentPerformed:false,
 productionAcceptance:false,
 releaseClosed:false
},null,2)+"\n");
process.exitCode=ready?0:2;
