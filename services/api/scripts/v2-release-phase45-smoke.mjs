import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const api=new URL("../",import.meta.url),repo=new URL("../../../",import.meta.url);
const [t,v,p,d]=await Promise.all([
  readFile(new URL("ops/release-1/project-final-closure.example.json",repo),"utf8"),
  readFile(new URL("scripts/v2-release-phase45-project-final-closure.mjs",api),"utf8"),
  readFile(new URL("package.json",api),"utf8"),
  readFile(new URL("docs/project-final-closure-phase45.md",repo),"utf8")
]);
const j=JSON.parse(t),pkg=JSON.parse(p);
assert.equal(j.schema,"carepoint.project-final-closure-record/v1");
assert.equal(j.closure.status,"PENDING");
assert.equal(j.projectClosed,false);
assert.equal(j.automaticClosurePerformed,false);
for(const x of [
  "Final project closure is forbidden until a Phase 44 validation result proves 230/230 traceability, 8/8 external gates and lifecycle completion.",
  "phase44ValidationResultAccepted",
  "acceptedExternalGateCount===8",
  "automaticClosurePerformed:false",
  "finalHumanDecisionRequired"
]) assert.ok(v.includes(x),"Phase 45 validator must include: "+x);
assert.equal(pkg.scripts["v2:release-phase45"],"node scripts/v2-release-phase45-smoke.mjs");
assert.equal(pkg.scripts["v2:release-phase45-project-final-closure"],"node scripts/v2-release-phase45-project-final-closure.mjs");
assert.ok(pkg.scripts.test.indexOf("npm run v2:release-phase44")<pkg.scripts.test.indexOf("npm run v2:release-phase45"));
for(const x of ["Release Phase 45","Final Project Closure Record","Phase 44","residual backlog","operations ownership","support transition","human closure decision","No new production environment variables","No .env file"]) assert.ok(d.includes(x),"Phase 45 docs must include: "+x);
console.log("Release Phase 45 final project closure contract passed.");
