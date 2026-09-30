import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const page=read("../app/questionnaires/triggers/page.tsx");
const base=read("../app/api/admin/questionnaire-triggers/route.ts");
const nested=read("../app/api/admin/questionnaire-triggers/[...segments]/route.ts");
const shell=read("../components/AppShell.tsx");
assert.match(page,/ADM-076/);assert.match(page,/ONBOARDING/);assert.match(page,/PERIODIC/);assert.match(page,/POST_INTERVENTION/);assert.match(page,/PRE_VISIT/);assert.match(page,/MANUAL/);
assert.match(page,/simulate/);assert.match(page,/lastSimulatedAt/);assert.match(page,/manual-dispatch/);assert.match(page,/rule version \+ patient \+ event|deduplic/i);
assert.match(base,/requireSameOrigin: true/);assert.match(base,/MAX_BODY_BYTES = 131072/);assert.match(nested,/requireSameOrigin: true/);assert.match(nested,/SAFE_ID/);assert.match(nested,/VERSION/);
assert.match(nested,/simulate/);assert.match(nested,/activate/);assert.match(nested,/manual-dispatch/);
assert.match(shell,/\/questionnaires\/triggers/);
for(const locale of ["en","ar","fr","es"])assert.match(page,new RegExp(`${locale}:\\{`));
console.log("ADM-076 Admin questionnaire trigger UI acceptance passed");
function read(relative){return readFileSync(new URL(relative,import.meta.url),"utf8");}
