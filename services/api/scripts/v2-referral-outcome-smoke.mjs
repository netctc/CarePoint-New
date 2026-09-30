import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const model = readFileSync(new URL("../prisma/v2_referrals.prisma", import.meta.url), "utf8");
const migration = readFileSync(
  new URL("../prisma/migrations/20260926060000_v2_referral_completion_outcome/migration.sql", import.meta.url),
  "utf8",
);
const service = readFileSync(
  new URL("../src/modules/referrals/referrals.service.ts", import.meta.url),
  "utf8",
);

assert.match(model, /model ReferralOutcome/);
assert.match(model, /referralId\s+String\s+@unique/);
for (const field of ["algorithm", "keyId", "wrappedKey", "iv", "ciphertext"]) {
  assert.match(model, new RegExp(`\\b${field}\\s+String`));
}
assert.match(migration, /CREATE TABLE "ReferralOutcome"/);
assert.match(migration, /UNIQUE INDEX "ReferralOutcome_referralId_key"/);
assert.match(migration, /ON DELETE RESTRICT/);
assert.doesNotMatch(migration, /\bDROP\b/i);

assert.match(service, /completionEnvelope = target === "COMPLETED"/);
assert.match(service, /this\.envelope\.encrypt\(\{ schemaVersion: 1, outcome: action\.completionOutcome!/);
assert.match(service, /tx\.referralOutcome\.create/);
assert.match(service, /this\.prisma\.referralOutcome\.findUnique/);
assert.match(service, /this\.envelope\.decrypt<\{ schemaVersion: number; outcome: string \}>/);
assert.match(service, /this\.prisma\.consent\.findMany/);
assert.match(service, /purpose:\s*"TREATMENT"/);
assert.match(service, /state:\s*"GRANTED"/);
assert.match(service, /revokedAt:\s*null/);
assert.match(service, /expiresAt:\s*\{ gt: now \}/);
assert.ok((service.match(/assertPatientConsent\(/g) ?? []).length >= 4);
assert.doesNotMatch(service, /referralOutcome\.update/);
assert.doesNotMatch(service, /referralOutcome\.delete/);
assert.doesNotMatch(service, /metadata:\s*\{[^}]*completionOutcome:/s);

console.log("V2 referral completion outcome privacy validation passed");
