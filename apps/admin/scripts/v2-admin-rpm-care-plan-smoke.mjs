import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const component=read("../components/AdminRpmCarePlanCenter.tsx");
const proxy=read("../app/api/admin/b6/[...segments]/route.ts");
const hub=read("../app/governance/page.tsx");
const rpmPage=read("../app/rpm/page.tsx");
const alertsPage=read("../app/rpm/alerts/page.tsx");
const templatesPage=read("../app/care-plan-templates/page.tsx");
const rpmBackend=read("../../../services/api/src/modules/rpm/rpm-alert.service.ts");
const templateBackend=read("../../../services/api/src/modules/care-plan/care-plan-template.service.ts");

for(const [id,page,section,href] of [
  ["ADM-081",rpmPage,"rpm-dashboard","/rpm"],
  ["ADM-082",alertsPage,"rpm-alerts","/rpm/alerts"],
  ["ADM-083",templatesPage,"care-plan-templates","/care-plan-templates"],
]){
  assert.match(page,new RegExp(id));
  assert.match(page,/active="12"/);
  assert.match(page,new RegExp('section="'+section+'"'));
  assert.ok(hub.includes(id),id+" must be linked in Governance Center");
  assert.ok(hub.includes(href),href+" must be linked in Governance Center");
}

for(const locale of ["en","ar","fr","es"]) assert.match(component,new RegExp("\\b"+locale+":\\{"));

assert.match(proxy,/rpm\/workspace/);
assert.match(proxy,/admin\/rpm\/workspace/);
assert.match(proxy,/rpm\/alerts/);
assert.match(proxy,/admin\/rpm\/alerts/);
assert.match(proxy,/care-plan-templates/);
assert.match(proxy,/admin\/care-plan-templates/);
assert.match(proxy,/requireSameOrigin:\s*true/);
assert.match(proxy,/\^\[1-9\]\\d\{0,8\}\$/);

assert.match(rpmBackend,/aggregateOnly:\s*true/);
assert.match(rpmBackend,/patientIdentityIncluded:\s*false/);
assert.match(rpmBackend,/status:\s*\{\s*not:\s*"RESOLVED"\s*\}/);
assert.match(component,/aggregateOnly=/);
assert.match(component,/patientIdentityIncluded===true/);
assert.doesNotMatch(component,/patientId|patientName|displayName/);

assert.match(templateBackend,/status:\s*"DRAFT"/);
assert.match(templateBackend,/status:\s*"ACTIVE"/);
assert.match(templateBackend,/status:\s*"RETIRED"/);
assert.match(templateBackend,/Only a DRAFT Care Plan template version can be activated/);
assert.match(templateBackend,/requiresClinicianReviewBeforeUse:\s*true/);
assert.match(component,/clinicianReview/);
assert.match(component,/starterBlueprint/);
assert.match(component,/DRAFT/);
assert.match(component,/activate/);
assert.doesNotMatch(component,/NEXT_PUBLIC_.*API|localhost:|127\.0\.0\.1/);

console.log("V2 Admin RPM/Care Plan acceptance passed: ADM-081/082/083");

function read(relative){return readFileSync(new URL(relative,import.meta.url),"utf8");}
