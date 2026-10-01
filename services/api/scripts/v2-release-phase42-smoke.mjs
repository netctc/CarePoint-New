import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const api=new URL("../",import.meta.url),repo=new URL("../../../",import.meta.url);
const [t,v,p,d]=await Promise.all([
  readFile(new URL("ops/release-1/release-closure.example.json",repo),"utf8"),
  readFile(new URL("scripts/v2-release-phase42-closure.mjs",api),"utf8"),
  readFile(new URL("package.json",api),"utf8"),
  readFile(new URL("docs/release-closure-phase42.md",repo),"utf8")
]);
const j=JSON.parse(t),pkg=JSON.parse(p);
assert.equal(j.schema,"carepoint.release-closure-record/v1");
assert.equal(j.closure.status,"PENDING");
assert.equal(j.releaseClosed,false);
assert.equal(j.hypercareRequired,true);
assert.ok(v.includes("Release closure is forbidden until Phase 41 production acceptance is ACCEPTED."));
assert.ok(v.includes("automaticClosurePerformed:false"));
assert.equal(pkg.scripts["v2:release-phase42"],"node scripts/v2-release-phase42-smoke.mjs");
assert.equal(pkg.scripts["v2:release-phase42-closure"],"node scripts/v2-release-phase42-closure.mjs");
assert.ok(pkg.scripts.test.indexOf("npm run v2:release-phase41")<pkg.scripts.test.indexOf("npm run v2:release-phase42"));
for(const x of ["Release Phase 42","release closure","Phase 41","critical incidents","operations ownership","hypercare","No new production environment variables","No .env file"]) assert.ok(d.includes(x));
console.log("Release Phase 42 closure contract passed.");
