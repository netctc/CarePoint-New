import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page=read("../app/questionnaires/page.tsx");
const baseRoute=read("../app/api/admin/questionnaires/route.ts");
const childRoute=read("../app/api/admin/questionnaires/[...segments]/route.ts");
const shell=read("../components/AppShell.tsx");
const moduleSource=read("../../../services/api/src/modules/questionnaire/questionnaire.module.ts");
const service=read("../../../services/api/src/modules/questionnaire/questionnaire.service.ts");
const engine=read("../../../services/api/src/modules/questionnaire/questionnaire.engine.ts");

assert.match(page,/ADM-074 \/ ADM-075/);
assert.match(page,/Questionnaire Builder/);
assert.match(page,/schemaVersion:1/);
assert.match(page,/Create DRAFT version|Crear versión DRAFT/);
assert.match(page,/Preview|Vista previa/);
for(const type of ["BOOLEAN","SINGLE_CHOICE","MULTI_CHOICE","NUMBER","TEXT","DATE"]) assert.match(page,new RegExp(type));
assert.match(page,/dueIfNoResponse/);
assert.match(page,/repeatDays/);
assert.match(page,/askHealthChanged/);
assert.doesNotMatch(page,/dangerouslySetInnerHTML/);

assert.match(baseRoute,/forwardAdminJson/);
assert.match(baseRoute,/\/admin\/questionnaires/);
assert.match(baseRoute,/requireSameOrigin: true/);
assert.match(baseRoute,/MAX_BODY_BYTES = 131072/);
assert.match(childRoute,/\/versions/);
assert.match(childRoute,/\/activate/);
assert.match(childRoute,/requireSameOrigin: true/);
assert.match(childRoute,/SAFE_ID/);

assert.match(moduleSource,/@Controller\("admin\/questionnaires"\)/);
assert.match(moduleSource,/CATALOG_MANAGE/);
assert.match(moduleSource,/@Post\(":questionnaireId\/versions"\)/);
assert.match(moduleSource,/@Post\(":questionnaireId\/versions\/:version\/activate"\)/);
assert.match(service,/status: "DRAFT"/);
assert.match(service,/Only a DRAFT questionnaire version can be activated/);
assert.match(service,/status: "RETIRED"/);
assert.match(service,/QUESTIONNAIRE_VERSION_ACTIVATED/);
assert.match(service,/questionnaireVersionId: item\.id/);
assert.match(engine,/normalizeQuestionnaireSchema/);
assert.match(shell,/href="\/questionnaires"/);

console.log("ADM-074/ADM-075 Admin Questionnaire Builder and immutable versioning acceptance passed");

function read(relative){return readFileSync(new URL(relative,import.meta.url),"utf8");}
