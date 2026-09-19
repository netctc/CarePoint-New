import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const engine = require("../dist/modules/doctor-snapshot/changes-since-last-visit.engine.js");

const since = new Date("2026-09-18T10:00:00.000Z");

test("changes since last visit returns explicit no-previous-consult state", () => {
  const result = engine.buildChangesSinceLastVisit({
    patientId: "patient-1",
    since: null,
    healthProfile: [],
    clinicalProfile: [],
    questionnaires: [],
    observations: [],
    restrictedSections: ["QUESTIONNAIRE"],
  });
  assert.equal(result.available, false);
  assert.equal(result.reason, "NO_PREVIOUS_COMPLETED_CONSULT");
  assert.deepEqual(result.changes, []);
  assert.deepEqual(result.restrictedSections, ["QUESTIONNAIRE"]);
  assert.equal(result.automatedClinicalInference, false);
});

test("every projected change links to its canonical source resource", () => {
  const result = engine.buildChangesSinceLastVisit({
    patientId: "patient-1",
    since,
    healthProfile: [{
      id: "hp-rev-2",
      profileId: "hp-1",
      version: 2,
      sourceType: "PATIENT",
      sourceActorId: "account-patient",
      changedFields: ["heightCm"],
      createdAt: new Date("2026-09-18T12:00:00.000Z"),
    }],
    clinicalProfile: [{
      id: "cp-rev-3",
      entryId: "entry-1",
      version: 3,
      changedFields: ["dose"],
      verificationStatus: "PROVIDER_VERIFIED",
      sourceType: "PROVIDER",
      sourceActorId: "account-doctor",
      createdAt: new Date("2026-09-19T08:00:00.000Z"),
      entry: { kind: "MEDICATION", status: "ACTIVE" },
    }],
    questionnaires: [{
      id: "response-2",
      sequence: 2,
      healthChanged: true,
      changedQuestionIds: ["q2"],
      sourceType: "PATIENT",
      sourceActorId: "account-patient",
      completedAt: new Date("2026-09-19T09:00:00.000Z"),
      questionnaire: { code: "INITIAL_HEALTH" },
      questionnaireVersion: { version: 4 },
    }],
    observations: [{
      id: "obs-1",
      observedAt: new Date("2026-09-19T10:00:00.000Z"),
      sourceType: "DEVICE",
      sourceId: "device-1",
      createdByActorId: "account-patient",
      observationType: { code: "HEART_RATE" },
    }],
    restrictedSections: [],
  });

  assert.equal(result.available, true);
  assert.equal(result.changes.length, 4);
  assert.deepEqual(result.changes.map((item) => item.resourceId), ["obs-1", "response-2", "cp-rev-3", "hp-rev-2"]);
  assert.equal(result.changes.every((item) => item.detailTarget.includes("patient-1")), true);
  assert.equal(result.changes[0].sourceId, "device-1");
  assert.equal(result.changes[1].resourceVersion, 2);
  assert.equal(result.summary.HEALTH_PROFILE, 1);
  assert.equal(result.summary.CLINICAL_PROFILE, 1);
  assert.equal(result.summary.QUESTIONNAIRE, 1);
  assert.equal(result.summary.OBSERVATION, 1);
  assert.equal(result.automatedClinicalInference, false);
});

test("restricted domains remain explicit and deduplicated", () => {
  const result = engine.buildChangesSinceLastVisit({
    patientId: "patient-1",
    since,
    healthProfile: [],
    clinicalProfile: [],
    questionnaires: [],
    observations: [],
    restrictedSections: ["HEALTH_PROFILE", "OBSERVATION:BLOOD_GLUCOSE", "HEALTH_PROFILE"],
  });
  assert.deepEqual(result.restrictedSections, ["HEALTH_PROFILE", "OBSERVATION:BLOOD_GLUCOSE"]);
});

test("change projection exposes structural metadata without clinical values", () => {
  const result = engine.buildChangesSinceLastVisit({
    patientId: "patient-1",
    since,
    healthProfile: [],
    clinicalProfile: [],
    questionnaires: [],
    observations: [{
      id: "obs-1",
      observedAt: new Date("2026-09-19T10:00:00.000Z"),
      sourceType: "PROVIDER",
      sourceId: "provider-1",
      createdByActorId: "account-doctor",
      observationType: { code: "BLOOD_GLUCOSE" },
    }],
    restrictedSections: [],
  });
  const observation = result.changes[0];
  assert.equal(observation.metadata.metricCode, "BLOOD_GLUCOSE");
  assert.equal(Object.prototype.hasOwnProperty.call(observation.metadata, "value"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(observation.metadata, "unitCode"), false);
});

console.log("V2 changes since last visit acceptance passed");
