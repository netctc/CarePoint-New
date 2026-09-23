import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  summarizeClinicalProfile,
  sinceLastConsultSummary,
} = require("../dist/modules/doctor-snapshot/doctor-snapshot.engine.js");

const clinical = summarizeClinicalProfile({
  items: [
    {
      id: "a1",
      kind: "ALLERGY",
      status: "ACTIVE",
      data: { substance: "Penicillin", severity: "SEVERE" },
      verificationStatus: "PROVIDER_VERIFIED",
      provenance: { updatedAt: "2026-09-18T12:00:00.000Z" },
    },
    {
      id: "c1",
      kind: "CONDITION",
      status: "ACTIVE",
      data: { display: "Synthetic condition", clinicalStatus: "ACTIVE" },
      verificationStatus: "PATIENT_DECLARED",
      provenance: { updatedAt: "2026-09-17T12:00:00.000Z" },
    },
    {
      id: "m1",
      kind: "MEDICATION",
      status: "ACTIVE",
      data: { name: "Synthetic medication", medicationStatus: "ACTIVE" },
      verificationStatus: "PROVIDER_VERIFIED",
      provenance: { updatedAt: "2026-09-19T01:00:00.000Z" },
    },
    {
      id: "m2",
      kind: "MEDICATION",
      status: "INACTIVE",
      data: { name: "Stopped medication", medicationStatus: "STOPPED" },
      verificationStatus: "PROVIDER_VERIFIED",
    },
  ],
});

assert.equal(clinical.allergies.length, 1);
assert.equal(clinical.criticalAllergies.length, 1);
assert.equal(clinical.activeConditions.length, 1);
assert.equal(clinical.activeMedications.length, 1);
assert.deepEqual(clinical.verification, {
  providerVerified: 3,
  patientDeclared: 1,
  providerRejected: 0,
});

const summary = sinceLastConsultSummary({
  previousConsultAt: new Date("2026-09-18T00:00:00.000Z"),
  healthProfile: {
    state: "AVAILABLE",
    value: { updatedAt: "2026-09-18T03:00:00.000Z" },
  },
  clinicalProfile: {
    state: "AVAILABLE",
    value: {
      items: [
        { provenance: { updatedAt: "2026-09-18T12:00:00.000Z" } },
        { provenance: { updatedAt: "2026-09-17T12:00:00.000Z" } },
      ],
    },
  },
  questionnaires: {
    state: "AVAILABLE",
    value: {
      items: [
        { latest: { completedAt: "2026-09-18T14:00:00.000Z" } },
        { latest: null },
      ],
    },
  },
  observations: [
    {
      code: "HEART_RATE",
      section: {
        state: "AVAILABLE",
        value: {
          items: [
            { observedAt: "2026-09-18T09:00:00.000Z" },
            { observedAt: "2026-09-17T09:00:00.000Z" },
          ],
        },
      },
    },
    { code: "GLUCOSE", section: { state: "RESTRICTED" } },
  ],
});

assert.equal(summary.available, true);
assert.deepEqual(summary.accessibleChanges, {
  healthProfileChanged: true,
  clinicalProfileChanged: 1,
  questionnaireChanged: 1,
  observationCount: 1,
});
assert.deepEqual(summary.restrictedSections, ["OBSERVATION:GLUCOSE"]);

assert.deepEqual(
  sinceLastConsultSummary({ previousConsultAt: null }),
  {
    available: false,
    reason: "NO_PREVIOUS_COMPLETED_CONSULT",
    since: null,
    accessibleChanges: null,
  },
);

console.log("V2 doctor patient snapshot aggregation acceptance passed");
await import("./v2-doctor-work-queue-smoke.mjs");

await import("./v2-doctor-lab-series-ui-smoke.mjs");
