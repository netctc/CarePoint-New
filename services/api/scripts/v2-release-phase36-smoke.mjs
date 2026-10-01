import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const apiRoot = new URL("../", import.meta.url);
const repoRoot = new URL("../../../", import.meta.url);

const [templateText, validator, pkgText, docs] = await Promise.all([
  readFile(new URL("ops/release-1/human-release-authorization.example.json", repoRoot), "utf8"),
  readFile(new URL("scripts/v2-release-phase36-authorization.mjs", apiRoot), "utf8"),
  readFile(new URL("package.json", apiRoot), "utf8"),
  readFile(new URL("docs/release-human-authorization-phase36.md", repoRoot), "utf8"),
]);

const template = JSON.parse(templateText);
const pkg = JSON.parse(pkgText);

assert.equal(template.schema, "carepoint.human-release-authorization-record/v1");
assert.equal(template.authorization.status, "PENDING");
assert.equal(template.productionAcceptance, false);
assert.equal(template.mainMergeAllowed, false);
assert.equal(template.deploymentAuthorized, false);

for (const token of [
  "Human authorization is forbidden until all 8 external gates are ACCEPTED.",
  "SEPARATE_EXPLICIT_MERGE_AND_DEPLOY_AUTHORIZATION_REQUIRED",
  "humanAuthorizationRecorded: true",
  "deploymentAuthorized: false",
  "mainMergeAllowed: false",
  "productionAcceptance: false"
]) {
  assert.ok(validator.includes(token), "Phase 36 validator must include: " + token);
}

assert.equal(pkg.scripts["v2:release-phase36"], "node scripts/v2-release-phase36-smoke.mjs");
assert.equal(pkg.scripts["v2:release-phase36-authorization"], "node scripts/v2-release-phase36-authorization.mjs");
assert.ok(pkg.scripts.test.includes("npm run v2:release-phase35"));
assert.ok(pkg.scripts.test.includes("npm run v2:release-phase36"));
assert.ok(
  pkg.scripts.test.indexOf("npm run v2:release-phase35") <
    pkg.scripts.test.indexOf("npm run v2:release-phase36")
);

for (const token of [
  "Release Phase 36",
  "8/8 external gates",
  "human authorization",
  "does not authorize deployment",
  "does not authorize merge",
  "productionAcceptance=false",
  "No new production environment variables",
  "No .env file"
]) {
  assert.ok(docs.includes(token), "Phase 36 docs must include: " + token);
}

console.log("Release Phase 36 human-authorization contract passed.");
