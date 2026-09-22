import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { sanitizeClinicalAuditMetadata } = require("../dist/infrastructure/audit/clinical-audit-metadata.js");

const marker = "RAW-PHI-MUST-NOT-ENTER-AUDIT";
const safe = sanitizeClinicalAuditMetadata({
  domain: "CLINICAL_PROFILE",
  accessBasis: "PATIENT_CONSENT",
  consentVersion: "clinical-record-v1",
  decision: "ALLOW",
  appointmentId: "appointment-123",
  patientId: "patient-123",
  providerId: "provider-123",
  revision: 3,
  itemCount: 7,
  changedFields: ["allergies", "conditions"],
  clinicalNote: marker,
  email: "patient@example.test",
  phone: "+96100000000",
  address: "Sensitive address",
  nested: { marker },
  freeText: marker,
});

assert.equal(safe.domain, "CLINICAL_PROFILE");
assert.equal(safe.accessBasis, "PATIENT_CONSENT");
assert.equal(safe.consentVersion, "clinical-record-v1");
assert.equal(safe.decision, "ALLOW");
assert.equal(safe.appointmentId, "appointment-123");
assert.equal(safe.patientId, "patient-123");
assert.equal(safe.providerId, "provider-123");
assert.equal(safe.revision, 3);
assert.equal(safe.itemCount, 7);
assert.deepEqual(safe.changedFields, ["allergies", "conditions"]);

const serialized = JSON.stringify(safe);
for (const forbidden of [
  marker,
  "patient@example.test",
  "+96100000000",
  "Sensitive address",
  "clinicalNote",
  "email",
  "phone",
  "address",
  "nested",
  "freeText",
]) {
  assert.equal(serialized.includes(forbidden), false, `Clinical audit metadata leaked: ${forbidden}`);
}

assert.deepEqual(
  sanitizeClinicalAuditMetadata({
    domain: "not free text",
    changedFields: ["valid", "bad field with spaces"],
    sourceId: "source id with spaces",
  }),
  {},
);

console.log("V2 clinical audit metadata minimization acceptance passed");
await import("./v2-realtime-events-smoke.mjs");
