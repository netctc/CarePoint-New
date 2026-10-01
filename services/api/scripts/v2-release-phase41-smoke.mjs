import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const api=new URL("../",import.meta.url),repo=new URL("../../../",import.meta.url);
const [t,v,p,d]=await Promise.all([
 readFile(new URL("ops/release-1/final-production-acceptance.example.json",repo),"utf8"),
 readFile(new URL("scripts/v2-release-phase41-final-acceptance.mjs",api),"utf8"),
 readFile(new URL("package.json",api),"utf8"),
 readFile(new URL("docs/release-final-production-acceptance-phase41.md",repo),"utf8")
]);
const j=JSON.parse(t),pkg=JSON.parse(p);
assert.equal(j.schema,"carepoint.final-production-acceptance-record/v1");
assert.equal(j.finalDecision.status,"PENDING");
assert.equal(j.productionAcceptance,false);
assert.equal(j.releaseClosureAuthorized,false);
assert.ok(v.includes("Production acceptance is forbidden until Phase 40 is READY."));
assert.ok(v.includes("automaticClosurePerformed:false"));
assert.equal(pkg.scripts["v2:release-phase41"],"node scripts/v2-release-phase41-smoke.mjs");
assert.equal(pkg.scripts["v2:release-phase41-final-acceptance"],"node scripts/v2-release-phase41-final-acceptance.mjs");
assert.ok(pkg.scripts.test.indexOf("npm run v2:release-phase40")<pkg.scripts.test.indexOf("npm run v2:release-phase41"));
for(const x of ["Release Phase 41","final production acceptance","Phase 40","human decision","does not close the release","No new production environment variables","No .env file"]) assert.ok(d.includes(x));
console.log("Release Phase 41 final production acceptance contract passed.");
