import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = read("../app/break-glass/page.tsx");
const review = read("../components/BreakGlassReview.tsx");
const listProxy = read("../app/api/admin/break-glass/route.ts");
const actionProxy = read("../app/api/admin/break-glass/[grantId]/review/route.ts");
const securityPage = read("../app/security/page.tsx");

assert.match(page, /ADM-094/);
assert.match(page, /active="08"/);
assert.match(securityPage, /href="\/break-glass"/);
for (const locale of ["en","ar","fr","es"]) assert.match(review, new RegExp("\\b" + locale + ":\\{"));
assert.match(review, /PENDING/);
assert.match(review, /REVIEWED/);
assert.match(review, /APPROPRIATE/);
assert.match(review, /INAPPROPRIATE/);
assert.match(review, /NEEDS_FOLLOW_UP/);
assert.match(review, /usageCount/);
assert.match(review, /lastUsedAt/);
assert.match(listProxy, /\/admin\/emergency-access\/reviews/);
assert.match(actionProxy, /\/admin\/emergency-access\/.*\/review/);
assert.match(actionProxy, /requireSameOrigin:\s*true/);
assert.match(actionProxy, /SAFE_ID/);
assert.doesNotMatch(review, /NEXT_PUBLIC_.*API|localhost:|127\.0\.0\.1/);
assert.doesNotMatch(listProxy + actionProxy, /process\.env/);

console.log("V2 Admin break-glass review acceptance passed: ADM-094");

function read(relative) {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}
