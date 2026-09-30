import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const workflowPath = path.join(repoRoot, ".github", "workflows", "postgres-recovery.yml");
const drillPath = path.join(repoRoot, ".ci", "postgres-recovery-drill.sh");
const fixturePath = path.join(repoRoot, ".ci", "postgres-recovery-fixture.mjs");

const [workflow, drill, fixture] = await Promise.all([
  readFile(workflowPath, "utf8"),
  readFile(drillPath, "utf8"),
  readFile(fixturePath, "utf8"),
]);

const shellCheck = spawnSync("bash", ["-n", drillPath], { cwd: repoRoot, encoding: "utf8" });
assert.equal(shellCheck.status, 0, `C11 drill shell syntax failed: ${shellCheck.stderr ?? ""}`);

assert.match(workflow, /^name: PostgreSQL Recovery$/m);
assert.match(workflow, /^\s*pull_request:\s*$/m);
assert.match(workflow, /^\s*branches: \[main\]\s*$/m);
assert.match(workflow, /^\s*schedule:\s*$/m);
assert.match(workflow, /source-postgres:/);
assert.match(workflow, /restore-postgres:/);
assert.match(workflow, /55432:5432/);
assert.match(workflow, /55433:5432/);
assert.match(workflow, /POSTGRES_DB: carepoint_restore/);
assert.match(workflow, /name: Phase C11 PostgreSQL disaster recovery drill/);
assert.match(workflow, /bash \.ci\/postgres-recovery-drill\.sh/);
assert.match(workflow, /Verify recovery artifacts were not retained/);
assert.match(workflow, /permissions:\n\s+contents: read/);
assert.doesNotMatch(workflow, /upload-artifact/);
assert.doesNotMatch(workflow, /actions\/(?:checkout|setup-node)@v\d/);

assert.match(drill, /set -euo pipefail/);
assert.match(drill, /trap cleanup EXIT/);
assert.match(drill, /pg_dump/);
assert.match(drill, /--format=custom/);
assert.match(drill, /--no-owner/);
assert.match(drill, /--no-privileges/);
assert.match(drill, /pg_restore --list/);
assert.match(drill, /--exit-on-error/);
assert.match(drill, /--single-transaction/);
assert.match(drill, /node \.ci\/postgres-recovery-fixture\.mjs seed/);
assert.match(drill, /node \.ci\/postgres-recovery-fixture\.mjs verify/);
assert.match(drill, /npx prisma migrate status --schema services\/api\/prisma/);
assert.match(drill, /export DATABASE_URL="\$C11_RESTORE_DATABASE_URL"/);
assert.ok(
  drill.indexOf('export DATABASE_URL="$C11_RESTORE_DATABASE_URL"') < drill.indexOf("npm --workspace @carepoint/api run start"),
  "C11 API must start only after DATABASE_URL switches to the restored cluster.",
);
assert.match(drill, /\/api\/v1\/health/);
assert.match(drill, /Phase C11 PostgreSQL disaster recovery acceptance passed/);
assert.match(drill, /rm -f "\$DUMP_FILE" "\$LIST_FILE" "\$API_LOG"/);
assert.doesNotMatch(drill, /upload-artifact/);

assert.match(fixture, /C11_SYNTHETIC_RECOVERY/);
assert.match(fixture, /repositoryMigrationCount\(\)/);
assert.match(fixture, /_prisma_migrations/);
assert.match(fixture, /P2002/);
assert.match(fixture, /P2003/);
assert.match(fixture, /siemAuditDelivery/);
assert.match(fixture, /include: \{ siemDelivery: true \}/);
assert.doesNotMatch(fixture, /patient|clinicalNote|messageBody/i,
  "C11 backup fixture must remain synthetic and PHI-free.");

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
assert.match(packageJson.scripts.test, /c11:postgres-recovery/);
assert.equal(packageJson.scripts["c11:postgres-recovery"], "node scripts/c11-postgres-recovery-gate-smoke.mjs");

console.log("Phase C11 PostgreSQL recovery gate acceptance passed");
