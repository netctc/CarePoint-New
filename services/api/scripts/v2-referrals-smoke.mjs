import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const engine = require("../dist/modules/referrals/referral.engine.js");

const now = new Date("2026-09-19T09:00:00.000Z");

test("referral normalization requires an explicit destination and least-data scopes", () => {
  const result = engine.normalizeReferralInput({
    idempotencyKey: "referral-acceptance-0001",
    destinationProviderId: "doctor-destination-1",
    reason: "Specialist evaluation requested.",
    scopes: ["health_profile_read", "observation_read:blood_pressure"],
    documentIds: ["document-1"],
  }, now);
  assert.equal(result.priority, "ROUTINE");
  assert.equal(result.destinationProviderId, "doctor-destination-1");
  assert.deepEqual(result.scopes, ["HEALTH_PROFILE_READ", "OBSERVATION_READ:BLOOD_PRESSURE"]);
  assert.deepEqual(result.documentIds, ["document-1"]);
});

test("referral sharing rejects write scopes, duplicates and excessive expiry", () => {
  assert.throws(() => engine.normalizeReferralShareScopes(["CLINICAL_PROFILE_WRITE"]), /not referral-share eligible/);
  assert.throws(() => engine.normalizeReferralShareScopes(["HEALTH_PROFILE_READ", "health_profile_read"]), /duplicates/);
  assert.throws(() => engine.normalizeReferralInput({
    idempotencyKey: "referral-acceptance-0002",
    destinationProviderId: "doctor-destination-2",
    reason: "Specialist evaluation requested.",
    scopes: ["HEALTH_PROFILE_READ"],
    expiresAt: "2027-01-01T00:00:00.000Z",
  }, now), /90 days/);
});

test("referral state machine allows only explicit forward transitions", () => {
  assert.equal(engine.referralTargetStatus("REQUESTED", "ACCEPT"), "ACCEPTED");
  assert.equal(engine.referralTargetStatus("ACCEPTED", "START"), "IN_PROGRESS");
  assert.equal(engine.referralTargetStatus("IN_PROGRESS", "COMPLETE"), "COMPLETED");
  assert.throws(() => engine.referralTargetStatus("COMPLETED", "START"), /not allowed/);
  assert.throws(() => engine.referralTargetStatus("REQUESTED", "COMPLETE"), /not allowed/);
});

test("referral actions require optimistic concurrency and reason codes for decline or cancellation", () => {
  assert.throws(() => engine.normalizeReferralAction({ action: "ACCEPT" }), /expectedVersion/);
  assert.throws(() => engine.normalizeReferralAction({ action: "DECLINE", expectedVersion: 1 }), /reasonCode/);
  assert.deepEqual(engine.normalizeReferralAction({
    action: "DECLINE",
    expectedVersion: 2,
    reasonCode: "OUT_OF_SCOPE",
  }), {
    action: "DECLINE",
    expectedVersion: 2,
    reasonCode: "OUT_OF_SCOPE",
  });
});

test("referral input rejects missing reason and duplicated document references", () => {
  assert.throws(() => engine.normalizeReferralInput({
    idempotencyKey: "referral-acceptance-0003",
    destinationProviderId: "doctor-destination-3",
    scopes: ["HEALTH_PROFILE_READ"],
  }, now), /reason/);
  assert.throws(() => engine.normalizeReferralInput({
    idempotencyKey: "referral-acceptance-0004",
    destinationProviderId: "doctor-destination-4",
    reason: "Specialist evaluation requested.",
    scopes: ["HEALTH_PROFILE_READ"],
    documentIds: ["document-1", "document-1"],
  }, now), /duplicates/);
});

console.log("V2 referral workflow acceptance passed");
