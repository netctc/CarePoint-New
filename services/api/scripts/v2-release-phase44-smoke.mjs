import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const api=new URL("../",import.meta.url),repo=new URL("../../../",import.meta.url);
const [t,v,p,d,a]=await Promise.all([
  readFile(new URL("ops/release-1/project-closure-readiness.example.json",repo),"utf8"),
  readFile(new URL("scripts/v2-release-phase44-project-closure-readiness.mjs",api),"utf8"),
  readFile(new URL("package.json",api),"utf8"),
  readFile(new URL("docs/project-closure-readiness-phase44.md",repo),"utf8"),
  readFile(new URL("docs/v2/traceability/functional-id-authority-v1.csv",repo),"utf8")
]);
const j=JSON.parse(t),pkg=JSON.parse(p);
assert.equal(j.schema,"carepoint.project-closure-readiness-record/v1");
assert.equal(j.projectScope.canonicalFunctionalIdCount,230);
assert.equal(j.readiness.status,"PENDING");
assert.equal(j.projectClosureReady,false);
assert.equal(a.trimEnd().split(/\r?\n/).length,231);
for(const x of [
  "All 230 canonical functional IDs must be MERGED_TO_MAIN.",
  "Project closure readiness requires all 8/8 external gates ACCEPTED in the Phase 32 evidence index.",
  "acceptedExternalGateCount",
  "externalGatesAccepted",
  "Project closure readiness requires Phase 43 lifecycle completion.",
  "automaticProjectClosurePerformed:false"
]) assert.ok(v.includes(x),"Phase 44 validator must include: "+x);
assert.equal(pkg.scripts["v2:release-phase44"],"node scripts/v2-release-phase44-smoke.mjs");
assert.equal(pkg.scripts["v2:release-phase44-project-closure"],"node scripts/v2-release-phase44-project-closure-readiness.mjs");
assert.ok(pkg.scripts.test.indexOf("npm run v2:release-phase43")<pkg.scripts.test.indexOf("npm run v2:release-phase44"));
for(const x of ["Release Phase 44","230/230","8/8 external gates","Phase 32","Phase 43","critical blockers","backlog disposition","operations owner","No new production environment variables","No .env file"]) assert.ok(d.includes(x));
console.log("Release Phase 44 project-closure readiness contract passed.");
