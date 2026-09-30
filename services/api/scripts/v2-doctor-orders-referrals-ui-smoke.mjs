import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const refillModule = read("../src/modules/refill/refill.module.ts");
const refillService = read("../src/modules/refill/refill.service.ts");
const refillEngine = read("../src/modules/refill/refill.engine.ts");
const imagingController = read("../src/modules/orders/imaging-orders.controller.ts");
const imagingService = read("../src/modules/orders/imaging-orders.service.ts");
const imagingEngine = read("../src/modules/orders/imaging-order.engine.ts");
const referralModule = read("../src/modules/referrals/referrals.module.ts");
const referralService = read("../src/modules/referrals/referrals.service.ts");
const referralEngine = read("../src/modules/referrals/referral.engine.ts");
const api = read("../../../packages/mobile_core/lib/carepoint_api.dart");
const record = read("../../../packages/mobile_core/lib/clinical_record.dart");
const ui = read("../../../packages/mobile_core/lib/doctor_orders_coordination.dart");

// DOC-076 — refill review remains server-authoritative and approval creates a new prescription.
assert.match(refillModule, /@Controller\("provider\/refill-requests"\)/);
assert.match(refillModule, /@Get\(\)/);
assert.match(refillModule, /@Post\(":requestId\/actions"\)/);
assert.match(refillEngine, /APPROVE/);
assert.match(refillEngine, /DECLINE/);
assert.match(refillEngine, /Approval requires explicit confirm=true/);
assert.match(refillEngine, /Decline requires a patient-visible reason/);
assert.match(refillService, /preparePrescriptionFromRefill/);
assert.match(refillService, /CLINICAL_REFILL_PRESCRIPTION_SIGNED/);
assert.match(ui, /reviewDoctorRefillRequest/);
assert.match(ui, /confirm: action == 'APPROVE'/);

// DOC-077 — imaging is capability-gated, versioned and cancel-only after creation.
assert.match(imagingController, /@Post\("patients\/:patientId\/imaging-orders"\)/);
assert.match(imagingController, /@Get\("patients\/:patientId\/imaging-orders"\)/);
assert.match(imagingController, /@Patch\("imaging-orders\/:orderId"\)/);
assert.match(imagingService, /assertClinicalOrderCapability\(principal, "IMAGING"\)/);
assert.match(imagingService, /Only the ordering provider can cancel/);
assert.match(imagingEngine, /XRAY/);
assert.match(imagingEngine, /CT/);
assert.match(imagingEngine, /MRI/);
assert.match(imagingEngine, /ULTRASOUND/);
assert.match(imagingEngine, /STAT/);
assert.match(ui, /createDoctorImagingOrder/);
assert.match(ui, /'action': 'CANCEL'/);
assert.match(ui, /'expectedVersion'/);

// DOC-078 — referral sharing is least-data, Doctor-only and state-machine governed.
assert.match(referralModule, /@Post\("patients\/:patientId\/referrals"\)/);
assert.match(referralModule, /@Get\("patients\/:patientId\/referrals"\)/);
assert.match(referralModule, /@Get\("referrals\/inbox"\)/);
assert.match(referralModule, /@Post\("referrals\/:referralId\/actions"\)/);
assert.match(referralModule, /@Get\("referrals\/destinations"\)/);
assert.match(referralService, /async destinationCatalog/);
assert.match(referralService, /class: "DOCTOR"/);
assert.match(referralService, /status: "ACTIVE"/);
assert.match(referralService, /clinicalPayloadIncluded: false/);
assert.match(referralService, /requireActiveDoctor/);
assert.match(referralService, /assertSharePolicies/);
assert.match(referralEngine, /CLINICAL_RECORD_READ/);
assert.match(referralEngine, /HEALTH_PROFILE_READ/);
assert.match(referralEngine, /QUESTIONNAIRE_READ/);
assert.match(referralEngine, /OBSERVATION_READ/);
assert.match(referralEngine, /CLINICAL_PROFILE_READ/);
assert.match(referralEngine, /REQUESTED/);
assert.match(referralEngine, /ACCEPTED/);
assert.match(referralEngine, /IN_PROGRESS/);
assert.match(referralEngine, /COMPLETED/);
assert.match(ui, /doctorReferralDestinations/);
assert.match(ui, /createDoctorReferral/);
assert.match(ui, /actDoctorReferral/);
assert.match(ui, /documentIds': const <String>\[\]/);
assert.doesNotMatch(ui, /destinationProviderId.*TextField/);

// Doctor Mobile entry and localization.
assert.match(record, /doctor-orders-coordination-entry/);
assert.match(record, /DoctorOrdersCoordinationPage/);
for (const locale of ["CarePointLocale.en", "CarePointLocale.ar", "CarePointLocale.fr", "CarePointLocale.es"]) {
  assert.ok(ui.includes(locale), `Missing coordination locale ${locale}`);
}
assert.match(record, /Directionality[\s\S]*textDirection: locale\.textDirection/);
assert.match(api, /doctorRefillRequests/);
assert.match(api, /doctorImagingOrders/);
assert.match(api, /doctorPatientReferrals/);

console.log("DOC-076..DOC-078 Doctor refill, imaging and referral acceptance passed");

function read(relative) {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}
