import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const schema=read("../prisma/v2_questionnaire_triggers.prisma");
const migration=read("../prisma/migrations/20260924160000_v2_questionnaire_triggers/migration.sql");
const service=read("../src/modules/questionnaire-triggers/questionnaire-trigger.service.ts");
const moduleSource=read("../src/modules/questionnaire-triggers/questionnaire-triggers.module.ts");
const questionnaire=read("../src/modules/questionnaire/questionnaire.service.ts");
const scheduling=read("../src/modules/scheduling/release1-contextual-booking.service.ts");
const clinicalProfile=read("../src/modules/clinical-profile/clinical-profile.service.ts");
assert.match(schema,/model QuestionnaireTriggerRule/);assert.match(schema,/model QuestionnaireTriggerRuleVersion/);assert.match(schema,/model QuestionnaireTriggerDispatch/);assert.match(schema,/@@unique\(\[ruleVersionId, patientId, eventId\]\)/);
for(const type of ["ONBOARDING","PERIODIC","POST_INTERVENTION","PRE_VISIT","MANUAL"])assert.match(migration,new RegExp(type));
assert.doesNotMatch(migration,/\bDROP\b/i);assert.match(moduleSource,/@Controller\("admin\/questionnaire-triggers"\)/);assert.match(moduleSource,/CATALOG_MANAGE/);assert.match(moduleSource,/simulate/);assert.match(moduleSource,/activate/);
assert.match(service,/Simulate the trigger version before activation/);assert.match(service,/Trigger activation requires an ACTIVE questionnaire version/);assert.match(service,/simulationOnly: true/);assert.match(service,/writesAssignment: false/);assert.match(service,/DUPLICATE_EVENT/);assert.match(service,/ruleVersionId_patientId_eventId/);
assert.match(questionnaire,/safeReconcilePatient/);assert.match(questionnaire,/pendingForPatient/);assert.match(questionnaire,/questionnaireTriggerDispatch\.updateMany/);assert.match(scheduling,/safeDispatchAppointmentConfirmed/);assert.match(clinicalProfile,/safeDispatchProcedureRecorded/);
assert.doesNotMatch(service,/ciphertext|wrappedKey/);
console.log("ADM-076 deterministic questionnaire trigger orchestration acceptance passed");
function read(relative){return readFileSync(new URL(relative,import.meta.url),"utf8");}
