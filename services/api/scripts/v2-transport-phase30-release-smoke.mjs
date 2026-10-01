import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const apiRoot = new URL("../", import.meta.url);
const repoRoot = new URL("../../../", import.meta.url);
const readApi = (path) => readFile(new URL(path, apiRoot), "utf8");
const readRepo = (path) => readFile(new URL(path, repoRoot), "utf8");

const contract = JSON.parse(
  await readRepo("ops/transport/transport-release-closure-phase30.json"),
);
const [pkgText, phase27Text, phase28Text, phase29Text, docs] = await Promise.all([
  readApi("package.json"),
  readRepo("ops/transport/transport-phases8-26-integration-contract.json"),
  readRepo("ops/transport/transport-e2e-acceptance-phase28.json"),
  readApi("scripts/v2-transport-phase29-postgres.mjs"),
  readRepo("docs/transport-release-closure-phase30.md"),
]);
const pkg = JSON.parse(pkgText);
const phase27 = JSON.parse(phase27Text);
const phase28 = JSON.parse(phase28Text);

assert.equal(contract.schemaVersion, 1);
assert.equal(contract.scope, "transport-release-closure-phases-8-30");
assert.equal(contract.canonicalBase, "main");
assert.equal(contract.productionAcceptance, false);
assert.equal(contract.mainMergeAuthorized, false);
assert.equal(contract.finalValidation.upstreamValidatedCandidatePr, 497);
assert.equal(
  contract.finalValidation.finalCandidateBranch,
  "integration/transport-final-unified-validation-20261001",
);
assert.equal(contract.finalValidation.finalCandidateExactHeadMustBeRecorded, true);
assert.equal(contract.finalValidation.fullCanonicalMatrixRequired, true);
assert.equal(contract.finalValidation.exactHeadGreenRequired, true);
assert.equal(contract.finalValidation.phase29PostgresAcceptanceRequired, true);
assert.equal(contract.finalValidation.postMergeMainValidationRequired, true);

assert.equal(phase27.productionAcceptance, false);
assert.equal(phase27.validation.fullMatrixRequiredBeforeMerge, true);
assert.equal(phase27.validation.mainMergeAllowed, false);
assert.equal(phase28.productionAcceptance, false);
assert.equal(phase28.fullMatrixStillRequired, true);
assert.equal(phase28.liveUatEvidenceStillRequired, true);

assert.ok(
  phase29Text.includes('CAREPOINT_TRANSPORT_POSTGRES_ACCEPTANCE !== "true"'),
);
assert.ok(phase29Text.includes('process.env.NODE_ENV === "production"'));

assert.equal(
  contract.migrationPolicy.rollbackMode,
  "APPLICATION_REVERT_PLUS_FORWARD_DB_REMEDIATION",
);
assert.equal(
  contract.migrationPolicy.automaticDestructiveDownMigrationAllowed,
  false,
);
assert.deepEqual(contract.migrationPolicy.permittedRelaxations, ["DROP NOT NULL"]);
assert.equal(contract.migrationPolicy.migrations.length, 23);
assert.equal(
  new Set(contract.migrationPolicy.migrations).size,
  contract.migrationPolicy.migrations.length,
  "Transport migration list must not contain duplicates",
);

const migrationTimestamps = [];
for (const migration of contract.migrationPolicy.migrations) {
  const match = /^(\d{14})_/.exec(migration);
  assert.ok(match, `Transport migration must start with a 14-digit timestamp: ${migration}`);
  migrationTimestamps.push(match[1]);

  const sql = await readRepo(
    "services/api/prisma/migrations/" + migration + "/migration.sql",
  );
  const normalized = sql
    .replace(/DROP\s+NOT\s+NULL/gi, "PERMITTED_DROP_NOT_NULL")
    .replace(/--[^\n]*/g, " ");

  const destructivePatterns = new Map([
    ["DROP TABLE", /\\bDROP\\s+TABLE\\b/i],
    ["DROP COLUMN", /\\bDROP\\s+COLUMN\\b/i],
    ["DROP TYPE", /\\bDROP\\s+TYPE\\b/i],
    ["TRUNCATE", /\\bTRUNCATE(?:\\s+TABLE)?\\b/i],
    ["DELETE FROM", /\\bDELETE\\s+FROM\\b/i],
  ]);
  for (const forbidden of contract.migrationPolicy.forbiddenSqlPatterns) {
    const pattern = destructivePatterns.get(forbidden);
    assert.ok(pattern, `unknown destructive SQL policy token: ${forbidden}`);
    assert.equal(
      pattern.test(normalized),
      false,
      `Transport migration ${migration} contains forbidden destructive SQL: ${forbidden}`,
    );
  }
}

assert.deepEqual(
  migrationTimestamps,
  [...migrationTimestamps].sort(),
  "Transport migrations must remain chronologically ordered",
);

for (const requiredStep of [
  "Freeze the exact consolidated candidate head after the full canonical matrix is green.",
  "Require explicit human authorization before any merge to main.",
  "Merge the single consolidated Transport candidate rather than replaying stacked PRs individually.",
  "Run canonical post-merge validation on the resulting main SHA.",
  "Use a forward corrective migration for any database remediation; do not execute destructive ad-hoc down SQL.",
]) {
  assert.ok(
    contract.finalMergeProtocol.includes(requiredStep),
    `missing final merge/rollback protocol step: ${requiredStep}`,
  );
}

for (const evidence of [
  "pre-deploy database backup/recovery evidence",
  "exact release/main SHA",
  "migration deployment log",
  "post-deploy health/readiness evidence",
  "post-merge canonical CI evidence",
]) {
  assert.ok(
    contract.rollbackEvidenceRequired.includes(evidence),
    `missing rollback evidence requirement: ${evidence}`,
  );
}

assert.equal(
  pkg.scripts["v2:transport-phase30-release"],
  "node scripts/v2-transport-phase30-release-smoke.mjs",
);
assert.ok(pkg.scripts.test.includes("npm run v2:transport-phase30-release"));

for (const text of [
  "Final Integration & Rollback Readiness",
  "mainMergeAuthorized: false",
  "APPLICATION_REVERT_PLUS_FORWARD_DB_REMEDIATION",
  "DROP NOT NULL",
  "23 Transport migrations",
  "No new production environment variables",
  "No .env file",
]) {
  assert.ok(docs.includes(text), `Phase 30 docs must include: ${text}`);
}

console.log(
  "Transport Phase 30 release/rollback readiness supplement passed",
);
