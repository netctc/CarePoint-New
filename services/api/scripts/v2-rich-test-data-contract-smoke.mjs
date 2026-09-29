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

const specialtySection=rich.match(/const SPECIALTIES:[\s\S]*?= \[([\s\S]*?)\n\];\n\nconst PROVIDER_CATEGORIES/)?.[1]??"";
const providerSection=rich.match(/const PROVIDER_CATEGORIES:[\s\S]*?= \[([\s\S]*?)\n\];\n\nconst UNITS/)?.[1]??"";
const unitSection=rich.match(/const UNITS = \[([\s\S]*?)\n\] as const;/)?.[1]??"";
const metricSection=rich.match(/const METRICS = \[([\s\S]*?)\n\] as const;/)?.[1]??"";
assert.ok((specialtySection.match(/suffix:/g)??[]).length>=70,"Rich fixtures must keep at least 70 medical specialties.");
assert.ok((providerSection.match(/slug:/g)??[]).length>=65,"Rich fixtures must keep at least 65 provider categories.");
assert.ok((unitSection.match(/code:/g)??[]).length>=20,"Rich fixtures must keep at least 20 measurement units.");
assert.ok((metricSection.match(/code:/g)??[]).length>=25,"Rich fixtures must keep at least 25 clinical observation types.");

for(const value of [
  "Cardiology","Dermatology","Psychiatry","Pediatrics","Neurosurgery","Palliative Medicine",
  "special-education","psychology","clinical-psychology","counseling-psychology","child-adolescent-psychology",
  "neuropsychology","school-psychology","rehabilitation-psychology","nutrition","clinical-nutrition","special-education-teacher",
  "non-emergency-medical-transport","wheelchair-medical-transport","ground-medical-transport","air-medical-transport","emergency-ambulance",
]){
  assert.ok(rich.includes(value),value+" is missing from the rich reference catalog.");
}

for(const value of ["Neonatology","Pediatric Cardiology","Maternal-Fetal Medicine","Critical Care Medicine","Interventional Cardiology","Clinical Genetics"]){
  assert.ok(rich.includes(value),value+" is missing from the expanded medical specialty catalog.");
}

for(const value of ["MEAN_ARTERIAL_PRESSURE","HBA1C","PEAK_EXPIRATORY_FLOW","FEV1","SLEEP_DURATION","PHQ9_SCORE","GAD7_SCORE"]){
  assert.ok(rich.includes(value),value+" is missing from the expanded clinical metric catalog.");
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
assert.match(rich,/mode=i%3===0\?"AIR":"GROUND"/);
assert.match(rich,/ClinicalEnvelopeService/);
assert.match(rich,/envelope\.encryptRecord/);
assert.match(rich,/createClinicalData/);
assert.match(rich,/futureAvailabilitySlots/);
assert.match(rich,/const encounterDays=\[300,210,120,35\]/);
assert.match(rich,/wantsCompleted&&!assignedProviderId&&pool\.length/);
assert.match(rich,/const availableSlots=\[\.\.\.uniqueSlots\]/);
assert.match(rich,/const providerIntervals=new Map/);
assert.match(rich,/if\(overlaps\(start,end,patientIntervals\)\) return false/);
assert.match(rich,/return !overlaps\(start,end,providerIntervals\.get\(slot\.providerId\)\?\?\[\]\)/);
assert.match(rich,/createTransportData\(patients,other\.transportProviders,config,admin\.id\)/);
assert.doesNotMatch(rich,/actorAccountId:SYSTEM_ACTOR/);

assert.match(healthUi,/Directionality\\\(\\s\*textDirection:/);

console.log("Rich test dataset and v2:health-profile CI contract acceptance passed");
