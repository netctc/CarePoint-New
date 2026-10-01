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
  const delegate=value.charAt(0).toLowerCase()+value.slice(1);
  assert.ok(rich.includes(value)||rich.includes("prisma."+delegate),value+" coverage is missing.");
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
assert.match(rich,/TRANSPORT_REQUEST_COUNT = 180/);
assert.match(rich,/EMERGENCY_TRANSPORT_REQUEST_COUNT = 90/);
assert.match(rich,/historicalCount=Math\.floor\(requestCount\*0\.75\)/);
assert.match(rich,/mode=i%4===0\?"AIR":"GROUND"/);
assert.match(rich,/\(i\*19\)%\(HISTORY_DAYS-14\)/);
assert.match(rich,/\(i\*23\)%\(HISTORY_DAYS-6\)/);
assert.match(rich,/ClinicalEnvelopeService/);
assert.match(rich,/envelope\.encryptRecord/);
assert.match(rich,/createClinicalData/);
assert.match(rich,/futureAvailabilitySlots/);

assert.match(healthUi,/Directionality\\\(\\s\*textDirection:/);

console.log("Rich test dataset and v2:health-profile CI contract acceptance passed");
