import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const rich=readFileSync(new URL("../src/scripts/bootstrap-rich-test-environment.ts",import.meta.url),"utf8");
const healthUi=readFileSync(new URL("./v2-patient-clinical-history-ui-smoke.mjs",import.meta.url),"utf8");

assert.match(rich,/RESET_AND_CREATE_RICH_SYNTHETIC_DATA/);
assert.match(rich,/TRUNCATE TABLE/);
assert.match(rich,/DEFAULT_PATIENT_COUNT = 300/);
assert.match(rich,/HISTORY_DAYS = 330/);
assert.match(rich,/FUTURE_APPOINTMENT_DAYS = 30/);
assert.match(rich,/AVAILABILITY_DAYS = 42/);

for(const value of [
  "Cardiology","Dermatology","Psychiatry","Pediatrics","Neurosurgery","Palliative Medicine",
  "special-education","psychology","clinical-psychology","counseling-psychology","child-adolescent-psychology",
  "neuropsychology","nutrition","ground-medical-transport","air-medical-transport","emergency-ambulance",
]){
  assert.ok(rich.includes(value),value+" is missing from the rich reference catalog.");
}

for(const value of [
  "MeasurementUnit","UnitConversion","ObservationType","ObservationTypeVersion",
  "PatientHealthProfile","Hospitalization","Immunization","MedicalTransportRequest",
]){
  assert.ok(rich.includes(value)||rich.toLowerCase().includes(value.charAt(0).toLowerCase()+value.slice(1)),value+" coverage is missing.");
}

assert.match(rich,/pac\$\{pad3\(index\)\}/);
assert.match(rich,/dr\$\{pad3\(index\)\}\.\$\{specialty\.suffix\}/);
assert.match(rich,/pr\$\{pad3\(index\)\}\.\$\{category\.suffix\}/);
assert.match(rich,/cardiologyDoctor:"dr001\.CAR"/);
assert.match(rich,/dermatologyDoctor:"dr001\.DER"/);
assert.match(rich,/nutritionProvider:"pr001\.NUT"/);
assert.match(rich,/psychologyProvider:"pr001\.PSI"/);

assert.match(rich,/createPendingOnboardings/);
assert.match(rich,/state:idx%4===0\?"REQUEST_CHANGES":"PENDING_REVIEW"/);
assert.match(rich,/createAvailabilityRequests/);
assert.match(rich,/createTransportData/);
assert.match(rich,/mode=i%3===0\?"AIR":"GROUND"/);
assert.match(rich,/ClinicalEnvelopeService/);
assert.match(rich,/envelope\.encryptRecord/);
assert.match(rich,/clinicalData/);
assert.match(rich,/futureAvailabilitySlots/);

assert.match(healthUi,/Directionality\\\(\\s\*textDirection:/);

console.log("Rich test dataset and v2:health-profile CI contract acceptance passed");
