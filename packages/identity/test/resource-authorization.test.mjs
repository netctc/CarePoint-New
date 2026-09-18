import test from "node:test";
import assert from "node:assert/strict";
import { decideClinicalResourceAccess } from "../dist/index.js";

const patient = { accountId: "patient-1", role: "PATIENT", sessionId: "s-p" };
const doctor = { accountId: "doctor-1", role: "DOCTOR", sessionId: "s-d" };
const provider = { accountId: "provider-1", role: "OTHER_PROVIDER", sessionId: "s-o" };
const admin = { accountId: "admin-1", role: "ADMIN", sessionId: "s-a" };

test("patient can read only their own patient-scoped clinical resource", () => {
  assert.deepEqual(
    decideClinicalResourceAccess({ principal: patient, action: "READ", patientOwnsTarget: true }),
    { allowed: true, basis: "PATIENT_SELF" },
  );
  assert.deepEqual(
    decideClinicalResourceAccess({ principal: patient, action: "READ", patientOwnsTarget: false }),
    { allowed: false, reason: "PATIENT_SCOPE_MISMATCH" },
  );
});

test("patient cannot use provider clinical write policy", () => {
  assert.deepEqual(
    decideClinicalResourceAccess({ principal: patient, action: "WRITE", patientOwnsTarget: true }),
    { allowed: false, reason: "PATIENT_WRITE_NOT_ALLOWED" },
  );
});

test("provider access is denied when provider is inactive or capability is absent", () => {
  assert.deepEqual(
    decideClinicalResourceAccess({ principal: doctor, action: "READ", providerActive: false, hasPatientConsent: true }),
    { allowed: false, reason: "PROVIDER_INACTIVE" },
  );
  assert.deepEqual(
    decideClinicalResourceAccess({ principal: provider, action: "READ", providerActive: true, capabilityAllowed: false, hasTreatmentRelationship: true }),
    { allowed: false, reason: "CAPABILITY_NOT_GRANTED" },
  );
});

test("provider read policy accepts assignment, treatment relationship or current consent", () => {
  assert.deepEqual(
    decideClinicalResourceAccess({ principal: doctor, action: "READ", providerActive: true, isAssignedProvider: true }),
    { allowed: true, basis: "OWN_AUTHORSHIP" },
  );
  assert.deepEqual(
    decideClinicalResourceAccess({ principal: doctor, action: "READ", providerActive: true, hasTreatmentRelationship: true }),
    { allowed: true, basis: "TREATMENT_RELATIONSHIP" },
  );
  assert.deepEqual(
    decideClinicalResourceAccess({ principal: provider, action: "READ", providerActive: true, hasPatientConsent: true }),
    { allowed: true, basis: "PATIENT_CONSENT" },
  );
});

test("provider write requires assignment or authorship, not consent alone", () => {
  assert.deepEqual(
    decideClinicalResourceAccess({ principal: doctor, action: "WRITE", providerActive: true, hasPatientConsent: true }),
    { allowed: false, reason: "WRITE_REQUIRES_ASSIGNMENT" },
  );
  assert.deepEqual(
    decideClinicalResourceAccess({ principal: doctor, action: "WRITE", providerActive: true, isAssignedProvider: true }),
    { allowed: true, basis: "OWN_AUTHORSHIP" },
  );
});

test("admin is not implicitly granted patient clinical access", () => {
  assert.deepEqual(
    decideClinicalResourceAccess({ principal: admin, action: "READ", patientOwnsTarget: true, providerActive: true, hasPatientConsent: true }),
    { allowed: false, reason: "ROLE_NOT_ALLOWED" },
  );
});

test("ABAC purpose, time window and sensitivity gates are fail-closed when explicitly denied", () => {
  assert.deepEqual(
    decideClinicalResourceAccess({
      principal: doctor,
      action: "READ",
      providerActive: true,
      purpose: "RESEARCH",
      allowedPurposes: ["TREATMENT"],
      hasTreatmentRelationship: true,
    }),
    { allowed: false, reason: "PURPOSE_NOT_ALLOWED" },
  );
  assert.deepEqual(
    decideClinicalResourceAccess({
      principal: doctor,
      action: "READ",
      providerActive: true,
      purpose: "TREATMENT",
      allowedPurposes: ["TREATMENT"],
      withinAccessWindow: false,
      hasTreatmentRelationship: true,
    }),
    { allowed: false, reason: "OUTSIDE_ACCESS_WINDOW" },
  );
  assert.deepEqual(
    decideClinicalResourceAccess({
      principal: doctor,
      action: "READ",
      providerActive: true,
      purpose: "TREATMENT",
      allowedPurposes: ["TREATMENT"],
      sensitivityAllowed: false,
      hasPatientConsent: true,
    }),
    { allowed: false, reason: "SENSITIVITY_NOT_ALLOWED" },
  );
});
