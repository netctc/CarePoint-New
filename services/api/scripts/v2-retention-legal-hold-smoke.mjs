import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

const schema = read("prisma/v2_retention.prisma");
const migration = read("prisma/migrations/20260922134500_v2_retention_legal_hold/migration.sql");
const service = read("src/modules/retention/retention.service.ts");
const module = read("src/modules/retention/retention.module.ts");
const app = read("src/app.module.ts");

for (const model of [
  "model RetentionPolicy",
  "model RetentionPolicyVersion",
  "model LegalHold",
  "model DeletionJob",
  "model DeletionJobItem",
]) assert.ok(schema.includes(model), `missing ${model}`);

for (const domain of [
  "CLINICAL_DOCUMENT",
  "CLINICAL_MEDIA",
  "CLINICAL_DOCUMENT_ACCESS_GRANT",
  "CLINICAL_MEDIA_ACCESS_GRANT",
  "AUDIT_EVENT",
]) assert.ok(migration.includes(domain), `missing governed retention domain ${domain}`);

assert.match(migration, /RetentionPolicyVersion_append_only/);
assert.match(migration, /LegalHold_identity_immutable/);
assert.match(migration, /LegalHold_no_delete/);
assert.match(migration, /REVOKE UPDATE, DELETE ON "RetentionPolicyVersion" FROM PUBLIC/);
assert.match(migration, /REVOKE DELETE ON "DeletionJob" FROM PUBLIC/);

assert.match(service, /async dryRun\(/);
assert.match(service, /planDigest/);
assert.match(service, /createHash\("sha256"\)/);
assert.match(service, /Retention policy changed after preview; create a new dry-run/);
assert.match(service, /Retention job plan digest mismatch; create a new dry-run/);
assert.match(service, /activeHolds\(job\.domain, job\.jurisdiction, now\)/);
assert.match(service, /LEGAL_HOLD:/);
assert.match(service, /BATCH_SIZE = 500/);
assert.match(service, /action === "PROTECT_ONLY"/);

assert.match(service, /clinicalDocument\.updateMany/);
assert.match(service, /clinicalMedia\.updateMany/);
assert.match(service, /status: "REMOVED"/);
assert.equal(service.includes("clinicalDocument.delete"), false, "clinical documents must not be hard-deleted by BE-046");
assert.equal(service.includes("clinicalMedia.delete"), false, "clinical media must not be hard-deleted by BE-046");
assert.equal(service.includes("auditEvent.delete"), false, "audit evidence must never be deleted by BE-046");
assert.match(service, /clinicalDocumentDownloadGrant\.deleteMany/);
assert.match(service, /clinicalMediaAccessGrant\.deleteMany/);
assert.match(service, /expiresAt: \{ lt: now \}/);

for (const action of [
  "RETENTION_POLICY_CREATED",
  "RETENTION_POLICY_VERSION_PUBLISHED",
  "LEGAL_HOLD_CREATED",
  "LEGAL_HOLD_RELEASED",
  "RETENTION_DRY_RUN_CREATED",
  "RETENTION_JOB_EXECUTED",
]) assert.ok(service.includes(action), `missing retention audit action ${action}`);

assert.match(module, /@Controller\("admin\/retention"\)/);
assert.match(module, /@RequirePermissions\("DATA_GOVERNANCE_MANAGE"\)/);
for (const route of [
  '@Get("policies")',
  '@Post("policies")',
  '@Post("policies/:policyId/versions")',
  '@Post("policies/:policyId/dry-run")',
  '@Get("legal-holds")',
  '@Post("legal-holds")',
  '@Post("legal-holds/:holdId/release")',
  '@Get("jobs")',
  '@Post("jobs/:jobId/execute")',
]) assert.ok(module.includes(route), `missing retention route ${route}`);

assert.match(app, /RetentionModule/);
console.log("V2 BE-046 retention and legal-hold acceptance passed");
await import("./v2-admin-deletion-jobs-ui-smoke.mjs");
