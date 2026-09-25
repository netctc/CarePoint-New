import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const service=read("../src/modules/questionnaire-triggers/questionnaire-trigger.service.ts");
const moduleSource=read("../src/modules/questionnaire/questionnaire.module.ts");
const bff=read("../../../apps/admin/app/api/admin/questionnaires/metrics/route.ts");
const page=read("../../../apps/admin/app/questionnaires/monitoring/page.tsx");
const builder=read("../../../apps/admin/app/questionnaires/page.tsx");

const method=service.match(/async adminComplianceMetrics[\s\S]*?\n  async createRule/)?.[0]??"";
assert.ok(method);
assert.match(moduleSource, /@Get\("metrics"\)/);
assert.match(moduleSource, /CATALOG_MANAGE/);
assert.match(moduleSource, /Cache-Control/);
assert.match(moduleSource, /adminComplianceMetrics/);

assert.match(method, /Questionnaire monitoring period cannot exceed 365 days/);
assert.match(method, /source must be ALL, TRIGGER, or DOCTOR_REQUEST/);
assert.match(method, /take: 50001/);
assert.match(method, /MIN_BREAKDOWN_GROUP_SIZE = 3/);
assert.match(method, /"PENDING" \| "COMPLETED" \| "EXPIRED" \| "ABANDONED"/);
assert.match(method, /ADMIN_QUESTIONNAIRE_METRICS_READ/);
assert.match(method, /OPERATIONAL_ANALYTICS/);
assert.match(method, /patientIdentifiersIncluded: false/);
assert.match(method, /answerPayloadsIncluded: false/);
assert.doesNotMatch(method, /select:[\s\S]{0,200}patientId/);
assert.doesNotMatch(method, /questionnaireResponse\.find/);
assert.doesNotMatch(method, /decrypt|ciphertext|wrappedKey/);

assert.match(bff, /export async function GET/);
assert.match(bff, /ALL/);
assert.match(bff, /TRIGGER/);
assert.match(bff, /DOCTOR_REQUEST/);
assert.match(bff, /questionnaireCode/);
assert.match(bff, /abandonAfterHours/);
assert.doesNotMatch(bff, /export async function POST|export async function PATCH|export async function DELETE/);

assert.match(page, /P1 · ADM-077/);
for(const locale of ["en:","ar:","fr:","es:"])assert.match(page,new RegExp(locale));
for(const label of ["Assigned","Completed","Pending","Expired","Abandoned","Completion"])assert.match(page,new RegExp(label));
assert.match(page, /patientIdentifiersIncluded/);
assert.match(page, /answerPayloadsIncluded/);
assert.doesNotMatch(page, /answers|ciphertext|wrappedKey/);
assert.match(builder, /questionnaires\/monitoring/);

console.log("ADM-077 questionnaire compliance monitoring acceptance passed");

function read(relative){return readFileSync(new URL(relative,import.meta.url),"utf8");}
