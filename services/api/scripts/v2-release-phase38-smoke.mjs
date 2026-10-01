import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const api=new URL("../",import.meta.url), repo=new URL("../../../",import.meta.url);
const [t,v,p,d]=await Promise.all([
 readFile(new URL("ops/release-1/post-deploy-validation.example.json",repo),"utf8"),
 readFile(new URL("scripts/v2-release-phase38-postdeploy.mjs",api),"utf8"),
 readFile(new URL("package.json",api),"utf8"),
 readFile(new URL("docs/release-postdeploy-validation-phase38.md",repo),"utf8")
]);
const j=JSON.parse(t), pkg=JSON.parse(p);
assert.equal(j.checks.length,10);
assert.equal(j.productionAcceptance,false);
assert.equal(j.releaseClosed,false);
assert.ok(j.checks.some((check)=>check.id==="ROLLBACK-TRIGGER-ASSESSMENT"));
for(const x of [
 "PASSED requires every post-deploy check PASS.",
 "rollbackAssessmentRequired",
 "releaseCandidate:r.releaseCandidate",
 "productionAcceptance:false",
 "releaseClosed:false"
]) assert.ok(v.includes(x), "Phase 38 validator must include: "+x);
assert.equal(pkg.scripts["v2:release-phase38"],"node scripts/v2-release-phase38-smoke.mjs");
assert.equal(pkg.scripts["v2:release-phase38-postdeploy"],"node scripts/v2-release-phase38-postdeploy.mjs");
assert.ok(pkg.scripts.test.indexOf("npm run v2:release-phase37")<pkg.scripts.test.indexOf("npm run v2:release-phase38"));
for(const x of ["Release Phase 38","10 post-deploy checks","rollback","does not close the release","No new production environment variables","No .env file"]) assert.ok(d.includes(x));
console.log("Release Phase 38 post-deploy validation contract passed.");
