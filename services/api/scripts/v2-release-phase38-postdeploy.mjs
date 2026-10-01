import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve, isAbsolute, relative } from "node:path";
import { fileURLToPath } from "node:url";
const repoRoot=fileURLToPath(new URL("../../../", import.meta.url));
const p=process.argv[2];
if(!p){process.stderr.write("Usage: node scripts/v2-release-phase38-postdeploy.mjs <record.json>\n");process.exit(64);}
if(isAbsolute(p)) throw new Error("Input must be repository-relative.");
const abs=resolve(repoRoot,p); const rel=relative(repoRoot,abs);
if(rel.startsWith("..")||rel.includes("../")) throw new Error("Input escapes repository root.");
const r=JSON.parse(await readFile(abs,"utf8"));
assert.equal(r.schema,"carepoint.post-deploy-validation-record/v1");
assert.equal(r.productionAcceptance,false);
assert.equal(r.releaseClosed,false);
assert.equal(r.checks.length,10);
for(const c of r.checks) assert.ok(["PENDING","PASS","FAIL"].includes(c.status));
assert.ok(["PENDING","PASSED","FAILED"].includes(r.validation.status));
const pass=r.checks.every(c=>c.status==="PASS");
const fail=r.checks.some(c=>c.status==="FAIL");
if(r.validation.status==="PASSED"){
  assert.equal(pass,true,"PASSED requires every post-deploy check PASS.");
  assert.ok(r.deploymentRef);
  assert.ok(r.validation.ownerRef);
  assert.ok(r.validation.startedAt && !Number.isNaN(Date.parse(r.validation.startedAt)));
  assert.ok(r.validation.completedAt && !Number.isNaN(Date.parse(r.validation.completedAt)));
  for(const c of r.checks) assert.ok(c.evidenceRef, `${c.id} evidenceRef is required.`);
}
if(r.validation.status==="FAILED") assert.equal(fail,true,"FAILED requires at least one failed check.");
process.stdout.write(JSON.stringify({
 schema:"carepoint.post-deploy-validation-result/v1",
 status:r.validation.status,
 passedChecks:r.checks.filter(c=>c.status==="PASS").length,
 failedChecks:r.checks.filter(c=>c.status==="FAIL").length,
 totalChecks:10,
 rollbackAssessmentRequired:fail,
 productionAcceptance:false,
 releaseClosed:false
},null,2)+"\n");
process.exitCode=r.validation.status==="PASSED"?0:2;
