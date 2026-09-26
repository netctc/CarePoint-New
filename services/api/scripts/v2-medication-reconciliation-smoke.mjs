import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const schema = read("../prisma/v2_clinical_profile_entries.prisma");
const migration = read("../prisma/migrations/20260925133000_v2_signed_medication_reconciliation/migration.sql");
const moduleSource = read("../src/modules/clinical-profile/clinical-profile.module.ts");
const service = read("../src/modules/clinical-profile/medication-reconciliation.service.ts");
const orders = read("../src/modules/orders/orders.service.ts");
const api = read("../../../packages/mobile_core/lib/carepoint_api.dart");
const mobile = read("../../../packages/mobile_core/lib/medication_reconciliation.dart");
const record = read("../../../packages/mobile_core/lib/clinical_record.dart");
const patientMain = read("../../../apps/patient-mobile/lib/main.dart");

assert.match(schema,/model MedicationReconciliationItem/);
assert.match(schema,/payloadDigest\s+String\?/);
assert.match(schema,/signatureAlgorithm\s+String\?/);
assert.match(schema,/supersedesId\s+String\?/);
assert.match(schema,/resolutionStatus/);
assert.match(migration,/CONTINUE/);
assert.match(migration,/SUSPEND/);
assert.match(migration,/DUPLICATE/);
assert.match(migration,/CORRECT/);
assert.match(migration,/MATCHED/);
assert.doesNotMatch(migration,/DROP TABLE|DROP COLUMN/);

assert.match(moduleSource,/OrdersModule/);
assert.match(moduleSource,/@Get\(":patientId\/clinical-profile\/medications\/reconciliation"\)/);
assert.match(moduleSource,/@Post\(":patientId\/clinical-profile\/medications\/reconcile"\)/);
assert.match(moduleSource,/@Controller\("patient\/clinical-profile\/medications"\)/);

assert.match(service,/OrdersAttestationService/);
assert.match(service,/attestation\.attest\(material\)/);
assert.match(service,/attestation\.verify\(material/);
assert.match(service,/Every reconciliation statement must reference this patient's MEDICATION entry/);
assert.match(service,/Every prescriptionOrderId must reference this patient's PRESCRIPTION order/);
assert.match(service,/Open medication discrepancies must be explicitly carried forward or resolved/);
assert.match(service,/status = encryptedItems\.some/);
assert.match(service,/supersedesId: latest\?\.id/);
assert.match(service,/MEDICATION_RECONCILIATION_SIGNED/);
assert.match(service,/openDiscrepancyCount/);
assert.match(service,/reason: item\.reason/);
assert.match(service,/encryptRecord/);
assert.match(service,/clinicalOrder\.findMany/);
assert.doesNotMatch(service,/clinicalOrder\.update/);
assert.doesNotMatch(service,/clinicalOrder\.delete/);
assert.match(orders,/signatureAlgorithm/);

assert.match(api,/doctorMedicationReconciliation/);
assert.match(api,/reconcileDoctorMedications/);
assert.match(api,/patientMedicationReconciliation/);
assert.match(record,/doctor-medication-reconciliation-entry/);
assert.match(patientMain,/patient-medication-reconciliation-entry/);
assert.match(mobile,/class DoctorMedicationReconciliationPage/);
assert.match(mobile,/class PatientMedicationReconciliationPage/);
for(const outcome of ["CONTINUE","SUSPEND","DUPLICATE","CORRECT","MATCHED"]) assert.match(mobile,new RegExp(outcome));
for(const locale of ["CarePointLocale.en","CarePointLocale.ar","CarePointLocale.fr","CarePointLocale.es"]) assert.ok(mobile.includes(locale));

console.log("P0 signed medication reconciliation acceptance passed");

function read(relative){return readFileSync(new URL(relative,import.meta.url),"utf8");}
