import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const apiRoot = new URL("../", import.meta.url);
const repoRoot = new URL("../../../", import.meta.url);

const [scanner, workflow, pkgText, readme] = await Promise.all([
  readFile(new URL("scripts/v2-release-external-evidence-intake-scan.mjs", apiRoot), "utf8"),
  readFile(new URL(".github/workflows/external-evidence-intake-preflight.yml", repoRoot), "utf8"),
  readFile(new URL("package.json", apiRoot), "utf8"),
  readFile(new URL("ops/release-1/evidence/README.md", repoRoot), "utf8"),
]);

const pkg = JSON.parse(pkgText);

for (const token of [
  "carepoint.external-evidence-intake-scan/v1",
  "PREFLIGHT_PASSED",
  "UNKNOWN_SCHEMA",
  "DUPLICATE_GATE_EVIDENCE",
  "PREFLIGHT_FAILED",
  "acceptanceRecorded: false",
  "realEvidenceIndexModified: false",
  "productionAcceptancePerformed: false",
  "mainMergeAllowed: false",
  "INTAKE_READY_FOR_CONTINUED_COLLECTION",
]) {
  assert.ok(scanner.includes(token), `Scanner must include: ${token}`);
}

for (const token of [
  "External Evidence Intake Preflight",
  "ops/release-1/evidence/**",
  "external-evidence-intake-",
  "github.event.pull_request.head.sha",
  "v2-release-external-evidence-intake-scan.mjs --markdown",
  "GITHUB_STEP_SUMMARY",
]) {
  assert.ok(workflow.includes(token), `Workflow must include: ${token}`);
}

assert.equal(
  pkg.scripts["v2:release-external-evidence-intake-scan"],
  "node scripts/v2-release-external-evidence-intake-scan.mjs",
);
assert.equal(
  pkg.scripts["v2:release-external-evidence-intake-contract"],
  "node scripts/v2-release-external-evidence-intake-smoke.mjs",
);

for (const token of [
  "CarePoint External Evidence Intake",
  "single-gate preflight",
  "preflight PASS is **not** gate acceptance",
  "No .env file",
]) {
  assert.ok(readme.includes(token), `Evidence intake README must include: ${token}`);
}

console.log("External evidence intake automation contract passed.");
