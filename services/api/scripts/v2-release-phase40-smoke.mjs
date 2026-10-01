import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const api=new URL("../",import.meta.url),repo=new URL("../../../",import.meta.url);
const [v,p,d]=await Promise.all([
 readFile(new URL("scripts/v2-release-phase40-closure-readiness.mjs",api),"utf8"),
 readFile(new URL("package.json",api),"utf8"),
 readFile(new URL("docs/release-final-closure-readiness-phase40.md",repo),"utf8")
]);
const pkg=JSON.parse(p);
for(const x of [
 "carepoint.final-release-closure-readiness/v1",
 "carepoint.production-execution-handoff-validation/v1",
 "carepoint.post-deploy-validation-result/v1",
 "h.authorizationReady===true",
 "p.passedChecks===10",
 "READY_FOR_FINAL_PRODUCTION_ACCEPTANCE_DECISION",
 "productionAcceptancePerformed:false",
 "releaseClosurePerformed:false",
 "explicitHumanFinalDecisionRequired:true"
]) assert.ok(v.replaceAll(" ","").includes(x.replaceAll(" ","")));
assert.equal(pkg.scripts["v2:release-phase40"],"node scripts/v2-release-phase40-smoke.mjs");
assert.equal(pkg.scripts["v2:release-phase40-closure-readiness"],"node scripts/v2-release-phase40-closure-readiness.mjs");
assert.ok(pkg.scripts.test.indexOf("npm run v2:release-phase39")<pkg.scripts.test.indexOf("npm run v2:release-phase40"));
for(const x of [
 "Release Phase 40",
 "final release-closure readiness",
 "READY_FOR_FINAL_PRODUCTION_ACCEPTANCE_DECISION",
 "does not perform production acceptance",
 "does not close the release",
 "explicit human final decision",
 "No new production environment variables",
 "No .env file"
]) assert.ok(d.includes(x));
console.log("Release Phase 40 final closure-readiness contract passed.");
