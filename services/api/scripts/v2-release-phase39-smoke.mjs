import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const api=new URL("../",import.meta.url),repo=new URL("../../../",import.meta.url);
const [t,v,p,d]=await Promise.all([
 readFile(new URL("ops/release-1/production-execution-handoff.example.json",repo),"utf8"),
 readFile(new URL("scripts/v2-release-phase39-handoff.mjs",api),"utf8"),
 readFile(new URL("package.json",api),"utf8"),
 readFile(new URL("docs/release-production-handoff-phase39.md",repo),"utf8")
]);
const j=JSON.parse(t),pkg=JSON.parse(p);
assert.equal(j.execution.status,"BLOCKED");
assert.equal(j.productionAcceptance,false);
assert.equal(j.releaseClosed,false);
for(const x of ["READY_FOR_OPERATOR_EXECUTION requires validated Phase 37 authorization plus an approved change window.","carepoint.merge-deploy-authorization-validation/v1","authorizationReady","executionReady","const ready=prerequisitesReady && executionReady","releaseCandidate:h.releaseCandidate","operatorActionRequired:true","automaticDeploymentPerformed:false","productionAcceptance:false","releaseClosed:false"]) assert.ok(v.replaceAll(" ","").includes(x.replaceAll(" ","")));
assert.equal(pkg.scripts["v2:release-phase39"],"node scripts/v2-release-phase39-smoke.mjs");
assert.equal(pkg.scripts["v2:release-phase39-handoff"],"node scripts/v2-release-phase39-handoff.mjs");
assert.ok(pkg.scripts.test.indexOf("npm run v2:release-phase38")<pkg.scripts.test.indexOf("npm run v2:release-phase39"));
for(const x of ["Release Phase 39","operator execution","validated Phase 37 authorization","remaining prerequisites","automatic deployment","post-deploy validation","No new production environment variables","No .env file"]) assert.ok(d.includes(x));
console.log("Release Phase 39 production handoff contract passed.");
