import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const prisma = readFileSync(new URL("../prisma/v2_clinical_history.prisma", import.meta.url), "utf8");
const migration = readFileSync(
  new URL("../prisma/migrations/20260922043000_v2_clinical_history/migration.sql", import.meta.url),
  "utf8",
);
const service = readFileSync(
  new URL("../src/modules/clinical-history/clinical-history.service.ts", import.meta.url),
  "utf8",
);
const moduleSource = readFileSync(
  new URL("../src/modules/clinical-history/clinical-history.module.ts", import.meta.url),
  "utf8",
);
const appModule = readFileSync(new URL("../src/app.module.ts", import.meta.url), "utf8");

const hospitalizationModel = prisma.match(/model Hospitalization\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
const immunizationModel = prisma.match(/model Immunization\s*\{[\s\S]*?\n\}/)?.[0] ?? "";

// BE-005/006 use governed dedicated records with immutable encrypted revision history.
assert.match(prisma, /model Hospitalization\s*\{/);
assert.match(prisma, /model HospitalizationRevision\s*\{/);
assert.match(prisma, /model Immunization\s*\{/);
assert.match(prisma, /model ImmunizationRevision\s*\{/);
assert.match(prisma, /idempotencyKey\s+String\s+@unique/);

// Hospitalizations are idempotent, but not logically deduplicated: two legitimate admissions may share date/facility.
assert.match(hospitalizationModel, /@@index\(\[patientId, logicalKey\]\)/);
assert.doesNotMatch(hospitalizationModel, /@@unique\(\[patientId, logicalKey\]\)/);
assert.match(migration, /CREATE INDEX "Hospitalization_patientId_logicalKey_idx"/);
assert.doesNotMatch(migration, /CREATE UNIQUE INDEX "Hospitalization_patientId_logicalKey/);

// Immunization keeps deterministic logical deduplication as required.
assert.match(immunizationModel, /@@unique\(\[patientId, logicalKey\]\)/);
assert.match(migration, /CREATE UNIQUE INDEX "Immunization_patientId_logicalKey_key"/);
assert.match(migration, /Hospitalization_date_interval_check/);
assert.match(migration, /"dischargedOn" IS NULL OR "dischargedOn" >= "admittedOn"/);
assert.match(migration, /HospitalizationRevision_append_only/);
assert.match(migration, /ImmunizationRevision_append_only/);
assert.match(migration, /Hospitalization_no_hard_delete/);
assert.match(migration, /Immunization_no_hard_delete/);
assert.match(migration, /REVOKE UPDATE, DELETE ON "HospitalizationRevision" FROM PUBLIC/);
assert.match(migration, /REVOKE UPDATE, DELETE ON "ImmunizationRevision" FROM PUBLIC/);

// PHI stays envelope-encrypted; source/provenance is retained without being collapsed into a medical order.
assert.match(service, /ClinicalEnvelopeService/);
assert.match(service, /this\.envelope\.encryptRecord\(payload\)/);
assert.match(service, /PATIENT_REPORTED/);
assert.match(service, /PROVIDER_RECORDED/);
assert.match(service, /IMPORTED/);
assert.match(service, /sourceType:/);
assert.match(service, /source:\s*payload\.source/);

// Updates are optimistic-concurrency protected and append a new immutable revision.
assert.match(service, /expectedVersion/);
assert.match(service, /SELECT id FROM "Hospitalization" WHERE id = \$\{id\} FOR UPDATE/);
assert.match(service, /SELECT id FROM "Immunization" WHERE id = \$\{id\} FOR UPDATE/);
assert.match(service, /Prisma\.TransactionIsolationLevel\.Serializable/);
assert.match(service, /hospitalizationRevision\.create/);
assert.match(service, /immunizationRevision\.create/);

// Hospitalization intervals are validated in service and database.
assert.match(service, /dischargedOn && dischargedOn < admittedOn/);
assert.match(service, /dischargedOn cannot precede admittedOn/);

// Immunization exact duplicates are prevented by a deterministic logical key plus idempotency handling.
assert.match(service, /immunizationLogicalKey/);
assert.match(service, /payload\.occurredOn/);
assert.match(service, /payload\.doseNumber/);
assert.match(service, /payload\.lotNumber/);
assert.match(service, /P2002/);
assert.match(service, /idempotencyKey has already been used for a different immunization request/);

// Doctor reads/writes are constrained to consent + current treatment relationship and audited.
assert.match(service, /CLINICAL_PROFILE_READ/);
assert.match(service, /CLINICAL_PROFILE_WRITE/);
assert.match(service, /clinical-profile-v1/);
assert.match(service, /status:\s*\{ in: \["CONFIRMED", "COMPLETED"\] \}/);
assert.match(service, /decideClinicalResourceAccess/);
assert.match(service, /CLINICAL_HISTORY_\$\{action\}_DENIED/);
assert.match(service, /HOSPITALIZATION_CREATED/);
assert.match(service, /IMMUNIZATION_CREATED/);

// Public API is bounded, no-store, self-scoped for patients and patient-scoped for doctors.
assert.match(moduleSource, /@Controller\("patient\/clinical-history"\)/);
assert.match(moduleSource, /@Controller\("doctor\/patients\/:patientId\/clinical-history"\)/);
assert.match(moduleSource, /@Get\("hospitalizations"\)/);
assert.match(moduleSource, /@Post\("hospitalizations"\)/);
assert.match(moduleSource, /@Patch\("hospitalizations\/:id"\)/);
assert.match(moduleSource, /@Get\("immunizations"\)/);
assert.match(moduleSource, /@Post\("immunizations"\)/);
assert.match(moduleSource, /@Patch\("immunizations\/:id"\)/);
assert.match(moduleSource, /Header\("Cache-Control", "no-store"\)/);
assert.match(moduleSource, /RequirePermissions\("PATIENT_MANAGE_CLINICAL_PROFILE"\)/);
assert.match(moduleSource, /RequirePermissions\("CLINICAL_PROFILE_READ"\)/);
assert.match(moduleSource, /RequirePermissions\("CLINICAL_PROFILE_WRITE"\)/);
assert.match(appModule, /ClinicalHistoryModule/);
assert.doesNotMatch(moduleSource, /@Delete\(/);

console.log("BE-005/BE-006 governed hospitalization + immunization acceptance passed");
