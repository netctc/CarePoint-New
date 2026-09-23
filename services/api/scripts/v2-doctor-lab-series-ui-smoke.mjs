import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const controller = read("../src/modules/orders/lab-series.controller.ts");
const engine = read("../src/modules/orders/lab-series.engine.ts");
const mobileApi = read("../../../packages/mobile_core/lib/carepoint_api.dart");
const mobileRecord = read("../../../packages/mobile_core/lib/clinical_record.dart");
const mobileSeries = read("../../../packages/mobile_core/lib/doctor_lab_series.dart");

assert.match(controller, /@Get\(":patientId\/lab-series"\)/);
assert.match(controller, /CLINICAL_ORDER_READ/);
assert.match(controller, /Cache-Control/);

assert.match(engine, /status: "VALIDATED" \| "RELEASED"/);
assert.match(engine, /referenceRange/);
assert.match(engine, /laboratoryResultId/);
assert.match(engine, /orderId/);
assert.match(engine, /automatedClinicalInference: false/);

assert.match(mobileApi, /doctorPatientLabSeries/);
assert.match(mobileApi, /\/provider\/patients\/\$patientId\/lab-series/);
assert.match(mobileRecord, /doctor-lab-series-entry/);
assert.match(mobileRecord, /DoctorLabSeriesPage/);

assert.match(mobileSeries, /next\['automatedClinicalInference'\] != false/);
assert.match(mobileSeries, /Laboratory result ID/);
assert.match(mobileSeries, /Source reference range/);
assert.match(mobileSeries, /point\['unit'\]/);
assert.match(mobileSeries, /point\['status'\]/);
assert.match(mobileSeries, /point\['orderId'\]/);
assert.match(mobileSeries, /point\['laboratoryResultId'\]/);
assert.match(mobileSeries, /numericValues\.length >= 2/);
assert.match(mobileSeries, /CustomPainter/);
assert.match(mobileSeries, /Charts are descriptive only/);
assert.doesNotMatch(mobileSeries, /flag\s*==|referenceRange.*(?:>|<)|value.*referenceRange/);
for (const locale of ["CarePointLocale.en", "CarePointLocale.ar", "CarePointLocale.fr", "CarePointLocale.es"]) {
  assert.ok(mobileSeries.includes(locale), `Missing DOC-061 locale ${locale}`);
}

console.log("DOC-061 Doctor laboratory-series mobile acceptance passed");

function read(relative) {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}
