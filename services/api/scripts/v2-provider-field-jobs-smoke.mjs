import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../src/modules/other-provider-workspace/provider-field-jobs.module.ts", import.meta.url),
  "utf8",
);
const schema = readFileSync(
  new URL("../prisma/v2_unified_field_jobs.prisma", import.meta.url),
  "utf8",
);
const migration = readFileSync(
  new URL("../prisma/migrations/20260922193000_v2_unified_field_jobs/migration.sql", import.meta.url),
  "utf8",
);
const appModule = readFileSync(
  new URL("../src/app.module.ts", import.meta.url),
  "utf8",
);

// Canonical BE-031 surface: one provider/jobs facade over existing source domains.
assert.match(source, /@Controller\("provider\/jobs"\)/);
assert.match(source, /@Get\(\)/);
assert.match(source, /@Get\(":jobId"\)/);
assert.match(source, /@Post\(":jobId\/events"\)/);
assert.match(source, /@Post\(":jobId\/checklist"\)/);
assert.match(source, /@Post\(":jobId\/complete"\)/);
assert.match(source, /RequirePermissions\("OTHER_PROVIDER_WORKFLOW_EXECUTE"\)/);
assert.match(source, /sourceOfTruth:[\s\S]*HOME_VISIT:\s*"Appointment"[\s\S]*MEDICAL_TRANSPORT:\s*"MedicalTransportRequest"/);
assert.match(source, /duplicatedJobState:\s*false/);
assert.doesNotMatch(schema, /model\s+FieldJob\s*\{/);

// Only the authenticated active Other Provider's assigned work can resolve.
assert.match(source, /principal\.role !== "OTHER_PROVIDER"/);
assert.match(source, /provider\.class !== "OTHER_PROVIDER"/);
assert.match(source, /provider\.status !== "ACTIVE"/);
assert.match(source, /providerId:\s*provider\.id/);
assert.match(source, /assignedProviderId:\s*providerId/);
assert.match(source, /modality:\s*"HOME_VISIT"/);

// Unified operational projection contains normalized state, SLA and bounded actions.
assert.match(source, /SCHEDULE_START_SLA_V1/);
assert.match(source, /normalizedState:/);
assert.match(source, /allowedActions:/);
assert.match(source, /ACKNOWLEDGED/);
assert.match(source, /ARRIVAL_CONFIRMED/);
assert.match(source, /CHECKLIST/);
assert.match(source, /COMPLETE/);

// Every mutation is retry-safe and serializes against the authoritative source record.
assert.match(source, /idempotencyKey/);
assert.match(source, /requestDigest/);
assert.match(source, /createHash\("sha256"\)/);
assert.match(source, /TransactionIsolationLevel\.Serializable/);
assert.match(source, /FOR UPDATE/);
assert.match(source, /sourceType_sourceId/);

// Checklists are controlled, revisioned evidence and incomplete required work blocks completion.
assert.match(source, /CHECKLIST_STATES = new Set\(\["DONE", "NOT_DONE", "NOT_APPLICABLE"\]\)/);
assert.match(source, /providerFieldJobChecklistRevision\.create/);
assert.match(source, /CHECKLIST_RECORDED/);
assert.match(source, /item\.state === "NOT_DONE"/);
assert.match(source, /latest checklist contains incomplete required items/);

// Completion transitions remain server-side in their existing authoritative domains.
assert.match(source, /appointment\.updateMany/);
assert.match(source, /data:\s*\{ status: "COMPLETED" \}/);
assert.match(source, /medicalTransportRequest\.updateMany/);
assert.match(source, /status:\s*"TRANSPORTING"/);
assert.match(source, /status:\s*"COMPLETED", completedAt/);
assert.match(source, /medicalTransportEvent\.create/);
assert.match(source, /providerFieldServiceCompletion\.create/);
assert.match(source, /SERVICE_COMPLETED/);

// Evidence is append-only and bounded to structural operational data.
assert.match(schema, /model ProviderFieldJobEvent/);
assert.match(schema, /model ProviderFieldJobChecklistRevision/);
assert.match(schema, /model ProviderFieldServiceCompletion/);
assert.match(schema, /idempotencyKey\s+String\s+@unique/);
assert.match(migration, /ProviderFieldJobEvent_immutable_trigger/);
assert.match(migration, /ProviderFieldJobChecklistRevision_immutable_trigger/);
assert.match(migration, /ProviderFieldServiceCompletion_immutable_trigger/);
assert.match(migration, /BEFORE UPDATE OR DELETE/);
assert.match(migration, /REVOKE UPDATE, DELETE ON "ProviderFieldJobEvent"/);
assert.match(migration, /REVOKE UPDATE, DELETE ON "ProviderFieldJobChecklistRevision"/);
assert.match(migration, /REVOKE UPDATE, DELETE ON "ProviderFieldServiceCompletion"/);
assert.doesNotMatch(schema, /diagnosis|symptom|clinicalNote|freeText|ciphertext/i);

// Runtime wiring is mandatory.
assert.match(appModule, /ProviderFieldJobsModule/);
assert.match(appModule, /modules\/other-provider-workspace\/provider-field-jobs\.module/);

console.log("V2 BE-031 unified field jobs acceptance passed");
