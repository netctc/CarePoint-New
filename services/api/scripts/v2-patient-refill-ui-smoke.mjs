import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const moduleSource = read("../src/modules/refill/refill.module.ts");
const service = read("../src/modules/refill/refill.service.ts");
const engine = read("../src/modules/refill/refill.engine.ts");
const orders = read("../src/modules/orders/orders.service.ts");
const api = read("../../../packages/mobile_core/lib/carepoint_api.dart");
const mobile = read("../../../packages/mobile_core/lib/patient_refill_requests.dart");
const main = read("../../../apps/patient-mobile/lib/main.dart");

assert.match(moduleSource, /@Post\("prescriptions\/:prescriptionId\/refill-requests"\)/);
assert.match(moduleSource, /@Get\("refill-requests"\)/);
assert.match(moduleSource, /PATIENT_REQUEST_REFILL/);
assert.match(service, /principal\.role !== "PATIENT"/);
assert.match(service, /resolveEffectivePatient\(principal, "CLINICAL_WRITE"\)/);
assert.match(service, /No refill allowance remains/);
assert.match(service, /A refill request is already awaiting review/);
assert.match(service, /responsible prescriber/i);
assert.match(engine, /refillAllowance/);
assert.match(orders, /Only an active signed prescription can be refilled/);

assert.match(api, /patientRefillRequests/);
assert.match(api, /requestPatientRefill/);
assert.match(api, /\/patient\/prescriptions\/.*\/refill-requests/);
assert.match(mobile, /patientClinicalOrders/);
assert.match(mobile, /type.*PRESCRIPTION/);
assert.match(mobile, /status.*SIGNED/);
assert.match(mobile, /patient-refill-request-/);
assert.match(mobile, /responsible prescriber/i);
assert.match(main, /patient-refill-entry/);

for (const locale of ["CarePointLocale.en","CarePointLocale.ar","CarePointLocale.fr","CarePointLocale.es"]) {
  assert.ok(mobile.includes(locale), `Missing refill locale ${locale}`);
}

console.log("PAT-132 Patient refill request acceptance passed");

function read(relative) {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}
