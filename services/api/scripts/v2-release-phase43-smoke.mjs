import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const api=new URL("../",import.meta.url),repo=new URL("../../../",import.meta.url);
const [t,v,p,d]=await Promise.all([
 readFile(new URL("ops/release-1/release-hypercare.example.json",repo),"utf8"),
 readFile(new URL("scripts/v2-release-phase43-hypercare.mjs",api),"utf8"),
 readFile(new URL("package.json",api),"utf8"),
 readFile(new URL("docs/release-hypercare-phase43.md",repo),"utf8")
]);
const j=JSON.parse(t),pkg=JSON.parse(p);
assert.equal(j.schema,"carepoint.release-hypercare-record/v1");
assert.equal(j.exitCriteria.length,6);
assert.equal(j.hypercareExited,false);
assert.equal(j.operationalHandoffComplete,false);
assert.ok(v.includes("Hypercare cannot start before Phase 42 release closure."));
assert.ok(v.includes("releaseLifecycleComplete"));
assert.equal(pkg.scripts["v2:release-phase43"],"node scripts/v2-release-phase43-smoke.mjs");
assert.equal(pkg.scripts["v2:release-phase43-hypercare"],"node scripts/v2-release-phase43-hypercare.mjs");
assert.ok(pkg.scripts.test.indexOf("npm run v2:release-phase42")<pkg.scripts.test.indexOf("npm run v2:release-phase43"));
for(const x of ["Release Phase 43","hypercare","6 exit criteria","Phase 42","operational handoff","No new production environment variables","No .env file"]) assert.ok(d.includes(x));
console.log("Release Phase 43 hypercare contract passed.");
