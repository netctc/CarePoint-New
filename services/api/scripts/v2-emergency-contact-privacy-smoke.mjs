import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const model = readFileSync(new URL("../prisma/v2_emergency_contacts.prisma", import.meta.url), "utf8");
const migration = readFileSync(
  new URL("../prisma/migrations/20260926054500_v2_emergency_contact_encryption/migration.sql", import.meta.url),
  "utf8",
);
const moduleSource = readFileSync(
  new URL("../src/modules/emergency-contacts/emergency-contacts.module.ts", import.meta.url),
  "utf8",
);
const backfill = readFileSync(
  new URL("../src/scripts/backfill-emergency-contact-encryption.ts", import.meta.url),
  "utf8",
);

for (const field of ["algorithm", "keyId", "wrappedKey", "iv", "ciphertext"]) {
  assert.match(model, new RegExp(`\\b${field}\\s+String\\?`));
  assert.match(migration, new RegExp(`"${field}" TEXT`));
}
assert.doesNotMatch(migration, /\bDROP\b/i);
assert.match(moduleSource, /ClinicalEnvelopeService/);
assert.match(moduleSource, /encryptRecord/);
assert.match(moduleSource, /decryptRecord/);
assert.match(moduleSource, /ENCRYPTED_SENTINEL/);
assert.match(moduleSource, /PATIENT_EMERGENCY_CONTACT_ENCRYPTED/);
assert.doesNotMatch(moduleSource, /data:\s*\{\s*patientId,\s*\.\.\.normalized\s*\}/);
assert.match(backfill, /where:\s*\{ ciphertext: null \}/);
assert.match(backfill, /updateMany/);
assert.match(backfill, /displayName:\s*SENTINEL/);
assert.doesNotMatch(backfill, /console\.log\([^)]*displayName/);

console.log("V2 emergency-contact envelope privacy validation passed");
