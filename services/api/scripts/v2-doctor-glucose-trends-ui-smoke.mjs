import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const api=read("../../../packages/mobile_core/lib/carepoint_api.dart");
const record=read("../../../packages/mobile_core/lib/clinical_record.dart");
const ui=read("../../../packages/mobile_core/lib/doctor_glucose_trends.dart");
assert.match(api,/doctorGlucoseTrends/);
assert.match(api,/glucose-trends/);
assert.match(record,/doctor-glucose-trends-entry/);
assert.match(record,/DoctorGlucoseTrendsPage/);
for(const key of ["FASTING","PREPRANDIAL","POSTPRANDIAL","RANDOM","MANUAL","DEVICE","PROVIDER"]) assert.match(ui,new RegExp(key));
for(const locale of ["CarePointLocale.en","CarePointLocale.ar","CarePointLocale.fr","CarePointLocale.es"]) assert.ok(ui.includes(locale));
assert.match(ui,/descriptiveOnly/);
assert.match(ui,/restrictedHint/);
assert.match(ui,/sourceId/);
assert.doesNotMatch(ui,/automatedDiagnosis\s*:\s*true|causalInference\s*:\s*true/);
console.log("DOC-010 Doctor Mobile glucose trends acceptance passed");
function read(relative){return readFileSync(new URL(relative,import.meta.url),"utf8");}
