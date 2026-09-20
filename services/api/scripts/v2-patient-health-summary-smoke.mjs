import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const engine = require("../dist/modules/patient-health-summary/patient-health-summary.engine.js");

const observation = (id, code, at, value = 1, unitCode = "UNIT", sourceType = "MANUAL") => ({
  id,
  code,
  labels: { en: code },
  category: "VITAL",
  value,
  unitCode,
  observedAt: new Date(at),
  sourceType,
  sourceId: sourceType === "DEVICE" ? "device-1" : null,
  verificationStatus: "PATIENT_DECLARED",
});

test("health summary keeps only the latest observation per metric with provenance", () => {
  const items = engine.latestObservationPerCode([
    observation("older", "HEART_RATE", "2026-09-18T10:00:00.000Z", 70, "BPM"),
    observation("latest", "HEART_RATE", "2026-09-19T10:00:00.000Z", 72, "BPM", "DEVICE"),
    observation("temp", "BODY_TEMPERATURE", "2026-09-19T09:00:00.000Z", 36.8, "CEL"),
  ]);
  assert.equal(items.length, 2);
  assert.equal(items[0].id, "latest");
  assert.equal(items[0].unitCode, "BPM");
  assert.equal(items[0].sourceType, "DEVICE");
  assert.equal(items[0].sourceId, "device-1");
  assert.equal(items[0].verificationStatus, "PATIENT_DECLARED");
});

test("health summary exposes explicit empty states instead of inferred normality", () => {
  assert.deepEqual(engine.observationSection([]), {
    state: "EMPTY",
    detailTarget: "/patient/observations/history",
    items: [],
  });
  assert.equal(engine.glucoseSection([]).state, "EMPTY");
  assert.equal(engine.questionnaireSection(null).state, "EMPTY");
  assert.equal(engine.carePlanSection(null).state, "EMPTY");
  assert.equal(engine.alertSection([]).state, "EMPTY");
});

test("blood glucose card is sourced only from an explicit BLOOD_GLUCOSE observation", () => {
  const glucose = observation("glucose", "BLOOD_GLUCOSE", "2026-09-19T08:00:00.000Z", 103, "MG_DL");
  const section = engine.glucoseSection([observation("pulse", "HEART_RATE", "2026-09-19T09:00:00.000Z"), glucose]);
  assert.equal(section.state, "READY");
  assert.equal(section.item.id, "glucose");
  assert.equal(section.item.value, 103);
  assert.equal(section.item.unitCode, "MG_DL");
});

test("due questionnaire and unresolved alerts are action-required without diagnosis inference", () => {
  const questionnaire = engine.questionnaireSection({
    questionnaireId: "q-1",
    code: "INITIAL_HEALTH",
    labels: { en: "Initial health" },
    questionnaireVersion: 2,
    latestSequence: 1,
    lastCompletedAt: new Date("2026-01-01T00:00:00.000Z"),
    due: true,
    dueReason: "PERIODIC_REVIEW",
  });
  assert.equal(questionnaire.state, "ACTION_REQUIRED");

  const alerts = engine.alertSection([{
    id: "alert-1",
    carePlanId: "plan-1",
    metricCode: "HEART_RATE",
    severity: "HIGH",
    status: "OPEN",
    patientActionKey: "CONTACT_CARE_TEAM",
    sourceObservationId: "obs-1",
    createdAt: new Date("2026-09-19T10:00:00.000Z"),
    viewed: false,
  }]);
  assert.equal(alerts.state, "ACTION_REQUIRED");
  assert.equal(alerts.items[0].patientActionKey, "CONTACT_CARE_TEAM");
  assert.equal(Object.prototype.hasOwnProperty.call(alerts.items[0], "diagnosis"), false);
});

test("medication section distinguishes active entries from pending refill workflow", () => {
  const section = engine.medicationSection([{ id: "med-1", name: "Example" }], 2);
  assert.equal(section.state, "READY");
  assert.equal(section.items.length, 1);
  assert.equal(section.openRefillCount, 2);
  assert.equal(section.refillDetailTarget, "/patient/refill-requests");
});

console.log("V2 patient health summary acceptance passed");
