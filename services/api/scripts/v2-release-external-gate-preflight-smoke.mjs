import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const apiRoot = new URL("../", import.meta.url);
const repoRoot = new URL("../../../", import.meta.url);

const [script, pkgText, docs] = await Promise.all([
  readFile(new URL("scripts/v2-release-external-gate-preflight.mjs", apiRoot), "utf8"),
  readFile(new URL("package.json", apiRoot), "utf8"),
  readFile(new URL("docs/external-gate-evidence-preflight.md", repoRoot), "utf8"),
]);

const pkg = JSON.parse(pkgText);

for (const token of [
  "ops/release-1/evidence/",
  "v2-release-phase32-evidence.mjs",
  "acceptedGateCount === 1",
  "allExternalEvidenceAccepted === false",
  'finalDecision === "BLOCKED"',
  "acceptanceRecorded: false",
  "gateClosed: false",
  "indexModified: false",
  "PREFLIGHT_PASSED_NOT_ACCEPTANCE",
  "await unlink(tempAbsolute).catch",
]) {
  assert.ok(script.includes(token), `Preflight script must include: ${token}`);
}

assert.equal(
  pkg.scripts["v2:release-external-gate-preflight"],
  "node scripts/v2-release-external-gate-preflight.mjs",
);

for (const token of [
  "External Gate Evidence Preflight",
  "does not accept a gate",
  "does not modify the real evidence index",
  "Phase 32",
  "ops/release-1/evidence/",
  "No new production environment variables",
  "No .env file",
]) {
  assert.ok(docs.includes(token), `Preflight docs must include: ${token}`);
}

console.log("External gate evidence preflight contract passed.");
