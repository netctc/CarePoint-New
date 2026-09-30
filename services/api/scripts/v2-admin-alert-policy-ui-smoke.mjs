import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const schema=read("../prisma/v2_rpm_alerts.prisma");
const engine=read("../src/modules/rpm/rpm-alert.engine.ts");
const service=read("../src/modules/rpm/rpm-alert.service.ts");
const moduleSource=read("../src/modules/rpm/rpm-alert.module.ts");
const page=read("../../../apps/admin/app/clinical-config/alert-policies/page.tsx");
const manager=read("../../../apps/admin/components/AlertPolicyManager.tsx");
const shell=read("../../../apps/admin/components/AppShell.tsx");
const route=read("../../../apps/admin/app/api/admin/rpm/policies/route.ts");
const version=read("../../../apps/admin/app/api/admin/rpm/policies/[policyId]/versions/route.ts");
const activate=read("../../../apps/admin/app/api/admin/rpm/policies/[policyId]/versions/[version]/activate/route.ts");

assert.match(schema,/model AlertPolicy/);
assert.match(schema,/model AlertPolicyVersion/);
assert.match(engine,/metricCodes/);
assert.match(engine,/severities/);
assert.match(engine,/patientActionKeys/);
assert.match(engine,/thresholdBounds/);
assert.match(engine,/Alert threshold is outside the configured policy bounds/);
assert.match(service,/createPolicyVersion/);
assert.match(service,/Active ObservationType required/);
assert.match(service,/Only a DRAFT alert policy version can be activated/);
assert.match(service,/status: "RETIRED"/);
assert.match(service,/ALERT_POLICY_ACTIVATED/);
assert.match(moduleSource,/@Controller\("admin\/rpm"\)/);
assert.match(moduleSource,/@Get\("policies"\)/);
assert.match(moduleSource,/@Post\("policies"\)/);
assert.match(moduleSource,/CATALOG_MANAGE/);

assert.match(page,/AlertPolicyManager/);
assert.match(shell,/\/clinical-config\/alert-policies/);
assert.match(manager,/\/api\/admin\/rpm\/policies/);
assert.match(manager,/\/api\/admin\/clinical-metrics/);
assert.match(manager,/thresholdBounds/);
assert.match(manager,/severityOptions/);
assert.match(manager,/patientActionKeys/);
assert.match(manager,/does not diagnose|No diagnostican|ne diagnostiquent|لا تشخّص/i);
for(const source of [route,version,activate]) {
  assert.match(source,/forwardAdminJson/);
  assert.match(source,/requireSameOrigin:true/);
}
for(const locale of ["en:","ar:","fr:","es:"]) assert.match(manager,new RegExp(locale));

console.log("ADM-080 alert policy Admin UI acceptance passed");

function read(relative){return readFileSync(new URL(relative,import.meta.url),"utf8");}
