import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const apiRoot = new URL("../", import.meta.url);
const repoRoot = new URL("../../../", import.meta.url);

const [templateText, validator, pkgText, docs] = await Promise.all([
  readFile(new URL("ops/release-1/merge-deploy-authorization.example.json", repoRoot), "utf8"),
  readFile(new URL("scripts/v2-release-phase37-merge-deploy.mjs", apiRoot), "utf8"),
  readFile(new URL("package.json", apiRoot), "utf8"),
  readFile(new URL("docs/release-merge-deploy-authorization-phase37.md", repoRoot), "utf8"),
]);

const template = JSON.parse(templateText);
const pkg = JSON.parse(pkgText);

assert.equal(template.schema, "carepoint.merge-deploy-authorization-record/v1");
assert.equal(template.mergeDecision.status, "PENDING");
assert.equal(template.deploymentDecision.status, "PENDING");
assert.equal(template.mainMergeAuthorized, false);
assert.equal(template.deploymentAuthorized, false);
assert.equal(template.productionAcceptance, false);
assert.equal(template.postDeployValidationRequired, true);

for (const token of [
  "Merge/deploy authorization is forbidden until all 8 external gates are ACCEPTED.",
  "Merge/deploy authorization is forbidden until Phase 36 human release authorization is AUTHORIZED.",
  "Deployment authorization requires merge authorization.",
  "Phase 36 acknowledgement must be true:",
  "releaseCandidate: decision.releaseCandidate",
  "EXECUTION_REQUIRES_OPERATOR_ACTION_AND_POST_DEPLOY_VALIDATION",
  "MERGE_AND_DEPLOY_REMAIN_BLOCKED",
  "productionAcceptance: false",
]) {
  assert.ok(validator.includes(token), "Phase 37 validator must include: " + token);
}

assert.equal(pkg.scripts["v2:release-phase37"], "node scripts/v2-release-phase37-smoke.mjs");
assert.equal(pkg.scripts["v2:release-phase37-merge-deploy"], "node scripts/v2-release-phase37-merge-deploy.mjs");
assert.ok(pkg.scripts.test.includes("npm run v2:release-phase36"));
assert.ok(pkg.scripts.test.includes("npm run v2:release-phase37"));
assert.ok(
  pkg.scripts.test.indexOf("npm run v2:release-phase36") <
    pkg.scripts.test.indexOf("npm run v2:release-phase37")
);

for (const token of [
  "Release Phase 37",
  "explicit merge/deploy authorization",
  "8/8 external gates",
  "Phase 36",
  "does not execute merge",
  "does not execute deployment",
  "productionAcceptance=false",
  "post-deploy validation",
  "No new production environment variables",
  "No .env file"
]) {
  assert.ok(docs.includes(token), "Phase 37 docs must include: " + token);
}

console.log("Release Phase 37 merge/deploy authorization contract passed.");
