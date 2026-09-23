import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const engine = require("../dist/modules/rpm/rpm-alert.engine.js");

const policy = engine.normalizeAlertPolicyConfig({
  metricCodes: ["BLOOD_GLUCOSE"],
  severities: ["WARNING", "CRITICAL"],
  patientActionKeys: ["REVIEW_CARE_PLAN", "CONTACT_CARE_TEAM"],
  thresholdBounds: [{ metricCode: "BLOOD_GLUCOSE", min: 20, max: 600 }],
});

test("RPM policy constrains metric, severity, action and threshold bounds", () => {
  const config = engine.normalizeAlertRuleConfig({ comparator: "GT", thresholdValue: 250 });
  assert.doesNotThrow(() => engine.assertRuleAllowedByPolicy(policy, {
    metricCode: "BLOOD_GLUCOSE",
    severity: "WARNING",
    patientActionKey: "REVIEW_CARE_PLAN",
    config,
  }));
  assert.throws(() => engine.assertRuleAllowedByPolicy(policy, {
    metricCode: "BLOOD_GLUCOSE",
    severity: "WARNING",
    patientActionKey: "REVIEW_CARE_PLAN",
    config: engine.normalizeAlertRuleConfig({ comparator: "GT", thresholdValue: 700 }),
  }), /outside/);
});

test("rule evaluation is deterministic and has no diagnostic output", () => {
  assert.equal(engine.evaluateAlertRule(251, { comparator: "GT", thresholdValue: 250 }), true);
  assert.equal(engine.evaluateAlertRule(249, { comparator: "GT", thresholdValue: 250 }), false);
  assert.equal(engine.evaluateAlertRule(70, { comparator: "OUTSIDE", thresholdValue: 80, thresholdUpperValue: 180 }), true);
});

test("alert lifecycle requires structured reasons for caller-enforced escalation/resolution", () => {
  assert.equal(engine.nextAlertStatus("OPEN", "ACKNOWLEDGE"), "ACKNOWLEDGED");
  assert.equal(engine.nextAlertStatus("ACKNOWLEDGED", "ESCALATE"), "ESCALATED");
  assert.equal(engine.nextAlertStatus("ESCALATED", "RESOLVE"), "RESOLVED");
  assert.throws(() => engine.nextAlertStatus("RESOLVED", "ACKNOWLEDGE"), /immutable/);
  assert.equal(engine.normalizeReasonCode("review_completed", true), "REVIEW_COMPLETED");
});

console.log("V2 deterministic RPM alerts acceptance passed");

await import("./v2-patient-clinical-alerts-ui-smoke.mjs");
