import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const apiRoot = new URL("../", import.meta.url);
const repoRoot = new URL("../../../", import.meta.url);
const [script, pkgText, docs, exampleText] = await Promise.all([
  readFile(new URL("scripts/v2-release-phase33-status.mjs", apiRoot), "utf8"),
  readFile(new URL("package.json", apiRoot), "utf8"),
  readFile(new URL("docs/release-evidence-status-phase33.md", repoRoot), "utf8"),
  readFile(new URL("ops/release-1/go-live-evidence-index.example.json", repoRoot), "utf8"),
]);

const pkg = JSON.parse(pkgText);
const example = JSON.parse(exampleText);

assert.equal(example.gates.length, 8);
assert.equal(example.finalDecision, "BLOCKED");
assert.equal(example.productionAcceptance, false);
assert.equal(example.mainMergeAllowed, false);
assert.equal(example.humanReleaseAuthorizationRequired, true);

for (const token of [
  "carepoint.go-live-evidence-status-report/v1",
  "completionPercent",
  "READY_FOR_HUMAN_RELEASE_AUTHORIZATION",
  "BLOCKED",
  "Production acceptance",
  "Main merge allowed",
  "Human release authorization required",
]) {
  assert.ok(script.includes(token), "Phase 33 status generator must include: " + token);
}

assert.equal(pkg.scripts["v2:release-phase33"], "node scripts/v2-release-phase33-smoke.mjs");
assert.equal(
  pkg.scripts["v2:release-phase33-status"],
  "node scripts/v2-release-phase33-status.mjs",
);
assert.ok(pkg.scripts.test.includes("npm run v2:release-phase32"));
assert.ok(pkg.scripts.test.includes("npm run v2:release-phase33"));
assert.ok(
  pkg.scripts.test.indexOf("npm run v2:release-phase32") <
    pkg.scripts.test.indexOf("npm run v2:release-phase33"),
);

for (const token of [
  "Release Phase 33",
  "8 external gates",
  "read-only",
  "productionAcceptance=false",
  "mainMergeAllowed=false",
  "human authorization",
  "No new production environment variables",
  "No .env file",
]) {
  assert.ok(docs.includes(token), "Phase 33 docs must include: " + token);
}

console.log("Release Phase 33 evidence-status contract passed.");
