import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const backend=read("../src/modules/retention/retention.service.ts");
const moduleSource=read("../src/modules/retention/retention.module.ts");
const ui=read("../../../apps/admin/components/RetentionGovernance.tsx");
const dryRun=read("../../../apps/admin/app/api/admin/privacy/retention/policies/[policyId]/dry-run/route.ts");
const jobs=read("../../../apps/admin/app/api/admin/privacy/retention/jobs/route.ts");
const execute=read("../../../apps/admin/app/api/admin/privacy/retention/jobs/[jobId]/execute/route.ts");

assert.match(backend,/async dryRun\(/);
assert.match(backend,/planDigest/);
assert.match(backend,/createHash\("sha256"\)/);
assert.match(backend,/activeHolds\(job\.domain, job\.jurisdiction, now\)/);
assert.match(backend,/Retention policy changed after preview/);
assert.match(backend,/Retention job plan digest mismatch/);
assert.match(backend,/action === "PROTECT_ONLY"/);
assert.doesNotMatch(backend,/auditEvent\.delete/);
assert.match(moduleSource,/@Post\("policies\/:policyId\/dry-run"\)/);
assert.match(moduleSource,/@Get\("jobs"\)/);
assert.match(moduleSource,/@Post\("jobs\/:jobId\/execute"\)/);

assert.match(dryRun,/requireSameOrigin: true/);
assert.match(dryRun,/\/dry-run/);
assert.match(jobs,/forwardAdminJson/);
assert.match(jobs,/\/admin\/retention\/jobs/);
assert.match(execute,/requireSameOrigin: true/);
assert.match(execute,/planDigest|body/);

assert.match(ui,/type DeletionJob/);
assert.match(ui,/dryRun\(policy/);
assert.match(ui,/expectedVersion:policy\.currentVersion/);
assert.match(ui,/job\.status === "PREVIEWED"/);
assert.match(ui,/planDigest:job\.planDigest/);
assert.match(ui,/window\.confirm/);
assert.match(ui,/latest\.action==="PROTECT_ONLY"/);
assert.match(ui,/auditProtected/);
for(const locale of ["en","ar","fr","es"]) assert.match(ui,new RegExp(locale+":"));

console.log("ADM-097 staged deletion-job Admin workflow acceptance passed");

function read(relative){return readFileSync(new URL(relative,import.meta.url),"utf8")}
