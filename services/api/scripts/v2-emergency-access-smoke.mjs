import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decideClinicalResourceAccess } from "@carepoint/identity";

const prisma = readFileSync(new URL("../prisma/v2_emergency_access.prisma", import.meta.url), "utf8");
const migration = readFileSync(
  new URL("../prisma/migrations/20260922070000_v2_emergency_access/migration.sql", import.meta.url),
  "utf8",
);
const service = readFileSync(
  new URL("../src/modules/emergency-access/emergency-access.service.ts", import.meta.url),
  "utf8",
);
const moduleSource = readFileSync(
  new URL("../src/modules/emergency-access/emergency-access.module.ts", import.meta.url),
  "utf8",
);
const appModule = readFileSync(new URL("../src/app.module.ts", import.meta.url), "utf8");

// Canonical BE-022 persistence: actor, scope, reason, bounded TTL and post-review evidence.
assert.match(prisma, /model EmergencyAccessGrant\s*\{/);
assert.match(prisma, /actorId\s+String/);
assert.match(prisma, /scope\s+String/);
assert.match(prisma, /reasonCode\s+String/);
assert.match(prisma, /requestedTtlMinutes\s+Int/);
assert.match(prisma, /expiresAt\s+DateTime/);
assert.match(prisma, /reviewStatus\s+String\s+@default\("PENDING"\)/);
assert.match(prisma, /@@unique\(\[actorId, idempotencyKey\]\)/);
assert.match(prisma, /model EmergencyAccessReview\s*\{/);

// DB also enforces short-lived grants and immutable review evidence.
assert.match(migration, /requestedTtlMinutes" BETWEEN 5 AND 60/);
assert.match(migration, /expiresAt" > "grantedAt"/);
assert.match(migration, /purpose" = 'EMERGENCY_TREATMENT'/);
assert.match(migration, /EmergencyAccessReview_append_only/);
assert.match(migration, /BEFORE UPDATE OR DELETE ON "EmergencyAccessReview"/);
assert.match(migration, /EmergencyAccessGrant_no_hard_delete/);

// Grant creation is doctor-only, MFA-assured, capability-preserving and patient-scoped.
assert.match(service, /principal\.role !== "DOCTOR"/);
assert.match(service, /isMfaAssuredSessionId\(principal\.sessionId\)/);
assert.match(service, /provider\.status !== "ACTIVE"/);
assert.match(service, /principalHasAnyPermission\(principal, \[scope\]\)/);
assert.match(service, /patientProfile\.findUnique/);
assert.match(service, /purpose: "EMERGENCY_TREATMENT"/);
assert.match(service, /expiresAt: \{ gt: new Date\(\) \}/);
assert.match(service, /EMERGENCY_ACCESS_GRANTED/);
assert.match(service, /EMERGENCY_ACCESS_USED/);
assert.match(service, /EMERGENCY_ACCESS_DENIED/);
assert.match(service, /EMERGENCY_ACCESS_REVIEWED/);
assert.match(service, /reviewRequired: true/);

// Explicit API: request/list/revoke, one audited clinical read, and Admin post-review queue.
assert.match(moduleSource, /@Controller\("provider\/emergency-access"\)/);
assert.match(moduleSource, /@Post\(\)/);
assert.match(moduleSource, /@Get\(\)/);
assert.match(moduleSource, /@Get\(":grantId\/clinical-profile"\)/);
assert.match(moduleSource, /@Post\(":grantId\/revoke"\)/);
assert.match(moduleSource, /@Controller\("admin\/emergency-access"\)/);
assert.match(moduleSource, /@Get\("reviews"\)/);
assert.match(moduleSource, /@Post\(":grantId\/review"\)/);
assert.match(moduleSource, /imports: \[ClinicalModule\]/);
assert.match(appModule, /EmergencyAccessModule/);

// Central authorization contract permits emergency basis for READ only; WRITE still needs assignment/authorship.
const principal = { accountId: "doctor-1", role: "DOCTOR", sessionId: "sesmfa_1" };
const emergencyRead = decideClinicalResourceAccess({
  principal,
  action: "READ",
  providerActive: true,
  capabilityAllowed: true,
  purpose: "EMERGENCY_TREATMENT",
  allowedPurposes: ["TREATMENT", "EMERGENCY_TREATMENT"],
  withinAccessWindow: true,
  sensitivityAllowed: true,
  hasEmergencyAccess: true,
});
assert.deepEqual(emergencyRead, { allowed: true, basis: "BREAK_GLASS" });

const emergencyWrite = decideClinicalResourceAccess({
  principal,
  action: "WRITE",
  providerActive: true,
  capabilityAllowed: true,
  purpose: "EMERGENCY_TREATMENT",
  allowedPurposes: ["TREATMENT", "EMERGENCY_TREATMENT"],
  withinAccessWindow: true,
  sensitivityAllowed: true,
  hasEmergencyAccess: true,
});
assert.deepEqual(emergencyWrite, { allowed: false, reason: "WRITE_REQUIRES_ASSIGNMENT" });

console.log("BE-022 governed emergency break-glass acceptance passed");
