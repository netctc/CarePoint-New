import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const controller = read("../src/modules/orders/lab-series.controller.ts");
const service = read("../src/modules/orders/lab-series.service.ts");
const engine = read("../src/modules/orders/lab-series.engine.ts");
const api = read("../../../packages/mobile_core/lib/carepoint_api.dart");
const ui = read("../../../packages/mobile_core/lib/doctor_lab_series.dart");
const record = read("../../../packages/mobile_core/lib/clinical_record.dart");

assert.match(controller, /@Get\(":patientId\/lab-series"\)/);
assert.match(controller, /CLINICAL_ORDER_READ/);
assert.match(controller, /Cache-Control/);
assert.match(service, /providerPatientOrders/);
assert.match(service, /LAB_SERIES_READ/);

assert.match(engine, /status: "VALIDATED" \| "RELEASED"/);
assert.match(engine, /value: string \| number/);
assert.match(engine, /unit: string \| null/);
assert.match(engine, /referenceRange: string \| null/);
assert.match(engine, /flag: string \| null/);
assert.match(engine, /laboratoryResultId/);
assert.match(engine, /orderId/);
assert.match(engine, /automatedClinicalInference: false/);
assert.match(engine, /left\.observedAt\.getTime\(\) - right\.observedAt\.getTime\(\)/);

assert.match(api, /doctorLabSeries/);
assert.match(api, /\/provider\/patients\/\$patientId\/lab-series/);
assert.match(record, /doctor-lab-series-entry/);
assert.match(record, /DoctorLabSeriesPage/);

assert.match(ui, /CustomPaint/);
assert.match(ui, /numeric\.length >= 2/);
assert.match(ui, /referenceRange/);
assert.match(ui, /laboratoryResultId/);
assert.match(ui, /orderId/);
assert.match(ui, /Validated\/released results only/);
assert.match(ui, /performs no clinical inference/);
assert.doesNotMatch(ui, /NORMAL|ABNORMAL|HIGH|LOW/);
for (const locale of ["CarePointLocale.en","CarePointLocale.ar","CarePointLocale.fr","CarePointLocale.es"]) {
  assert.ok(ui.includes(locale), `Missing lab-series locale ${locale}`);
}

console.log("DOC-061 Doctor laboratory series mobile acceptance passed");

function read(relative) {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}
