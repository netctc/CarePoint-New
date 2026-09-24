import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const backend=read("../src/modules/patient-education/patient-education.module.ts");
const page=read("../../../apps/admin/app/patient-education/page.tsx");
const shell=read("../../../apps/admin/components/AppShell.tsx");
const rootRoute=read("../../../apps/admin/app/api/admin/education-content/route.ts");
const childRoute=read("../../../apps/admin/app/api/admin/education-content/[...segments]/route.ts");

assert.match(backend,/@Controller\("admin\/education-content"\)/);
assert.match(backend,/CATALOG_MANAGE/);
assert.match(backend,/createDefinition/);
assert.match(backend,/createVersion/);
assert.match(backend,/Only DRAFT education versions can be published/);
assert.match(backend,/status: "RETIRED"/);
assert.match(backend,/REQUIRED_LOCALES = \["en","ar","fr","es"\]/);
assert.match(backend,/sourceUrl must use HTTPS/);
assert.match(backend,/sourceVisible: true/);

assert.match(rootRoute,/forwardAdminJson/);
assert.match(rootRoute,/\/admin\/education-content/);
assert.match(rootRoute,/requireSameOrigin: true/);
assert.match(childRoute,/versions/);
assert.match(childRoute,/publish/);
assert.match(childRoute,/requireSameOrigin: true/);
assert.match(childRoute,/MAX_BODY_BYTES/);
assert.doesNotMatch(childRoute,/DELETE/);

assert.match(page,/P2 · ADM-109/);
assert.match(page,/bodyLabels/);
assert.match(page,/sourceName/);
assert.match(page,/sourceUrl/);
assert.match(page,/createVersion/);
assert.match(page,/publish\(version/);
assert.match(page,/version\.status==="DRAFT"/);
for(const locale of ["en","ar","fr","es"]) assert.match(page,new RegExp(locale+":"));
assert.doesNotMatch(page,/delete|remove content/i);

assert.match(shell,/patientEducationLabels/);
assert.match(shell,/href="\/patient-education"/);
assert.match(shell,/active === "20"/);

console.log("ADM-109 Patient Education Admin catalog acceptance passed");

function read(relative){return readFileSync(new URL(relative,import.meta.url),"utf8")}
