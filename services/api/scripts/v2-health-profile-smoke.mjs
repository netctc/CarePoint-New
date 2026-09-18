import assert from "node:assert/strict";
import { HealthProfileService } from "../dist/modules/health-profile/health-profile.service.js";
import { ClinicalEnvelopeService } from "../dist/modules/clinical/clinical-envelope.service.js";

process.env.NODE_ENV = "test";
process.env.CLINICAL_KEY_PROVIDER = "local";
process.env.CLINICAL_ENVELOPE_KEY_ID = "v2-health-profile-test-kek";
process.env.CLINICAL_ENVELOPE_KEY_BASE64 = Buffer.alloc(32, 23).toString("base64");

const patient = { id: "patient-profile-1", userId: "patient-account-1" };
let current = null;
const revisions = [];
const audits = [];
let seq = 0;
const clone = (value) => value == null ? value : structuredClone(value);

function rowFromData(data, existing = {}) {
  const now = new Date();
  return {
    id: existing.id ?? data.id ?? `health-profile-${++seq}`,
    patientId: data.patientId ?? existing.patientId,
    version: data.version ?? existing.version ?? 1,
    algorithm: data.algorithm ?? existing.algorithm,
    keyId: data.keyId ?? existing.keyId,
    wrappedKey: data.wrappedKey ?? existing.wrappedKey,
    iv: data.iv ?? existing.iv,
    ciphertext: data.ciphertext ?? existing.ciphertext,
    createdAt: existing.createdAt ?? now,
    updatedAt: now,
  };
}

const tx = {
  $queryRaw: async () => [],
  patientHealthProfile: {
    findUnique: async () => clone(current),
    create: async ({ data }) => {
      current = rowFromData(data);
      return clone(current);
    },
    update: async ({ data }) => {
      current = rowFromData(data, current);
      return clone(current);
    },
  },
  profileRevision: {
    create: async ({ data }) => {
      const row = { id: `revision-${data.version}`, createdAt: new Date(), ...data };
      revisions.push(row);
      return clone(row);
    },
  },
};
const prisma = {
  patientProfile: {
    findUnique: async ({ where }) => where.userId === patient.userId ? { id: patient.id } : null,
  },
  patientHealthProfile: {
    findUnique: async ({ include } = {}) => {
      if (!current) return null;
      const row = clone(current);
      if (include?.revisions) row.revisions = revisions.length ? [clone(revisions.at(-1))] : [];
      return row;
    },
  },
  $transaction: async (work) => work(tx),
};
const audit = {
  writeClinical: async (row) => audits.push(row),
  writeClinicalInTransaction: async (_tx, row) => audits.push(row),
};
const service = new HealthProfileService(prisma, audit, new ClinicalEnvelopeService());
const principal = { accountId: patient.userId, role: "PATIENT", sessionId: "session-1" };

const empty = await service.mine(principal);
assert.equal(empty.version, 0);
assert.deepEqual(empty.basics, {});

const marker = "ENCRYPTED-RELEVANT-NEED-MARKER";
const first = await service.patchMine(principal, {
  expectedVersion: 0,
  basics: {
    dateOfBirth: "1990-04-03",
    clinicalSex: "FEMALE",
    heightCm: 168.4,
    baselineWeightKg: 64.2,
    bloodType: "O",
    rhesusFactor: "POSITIVE",
    relevantNeeds: [marker],
  },
});
assert.equal(first.version, 1);
assert.equal(first.basics.dateOfBirth, "1990-04-03");
assert.equal(first.provenance.sourceType, "PATIENT");
assert.equal(JSON.stringify(current).includes(marker), false, "Current profile row leaked PHI in cleartext.");
assert.equal(JSON.stringify(revisions).includes(marker), false, "Profile revision row leaked PHI in cleartext.");

await assert.rejects(
  service.patchMine(principal, { expectedVersion: 0, basics: { heightCm: 170 } }),
  (error) => error?.getStatus?.() === 409 && error?.getResponse?.()?.currentVersion === 1,
);

const second = await service.patchMine(principal, {
  expectedVersion: 1,
  basics: { heightCm: 170 },
});
assert.equal(second.version, 2);
assert.equal(second.basics.relevantNeeds[0], marker);
assert.equal(second.basics.heightCm, 170);
assert.equal(revisions.length, 2);
assert.ok(audits.some((row) => row.action === "HEALTH_PROFILE_UPDATED"));
assert.equal(JSON.stringify(audits).includes(marker), false, "Audit metadata leaked profile PHI.");

await assert.rejects(
  service.patchMine(principal, { expectedVersion: 2, basics: { dateOfBirth: "not-a-date" } }),
  (error) => error?.getStatus?.() === 400,
);

console.log(JSON.stringify({
  status: "passed",
  encryptedAtRest: true,
  versioned: true,
  optimisticConcurrency: true,
  provenance: true,
  auditPhiMinimized: true,
}));
