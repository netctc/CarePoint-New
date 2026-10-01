import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const repoRoot = new URL("../../../", import.meta.url);
const apiRoot = new URL("../", import.meta.url);

const [manifestText, pkgText, docs] = await Promise.all([
  readFile(new URL("ops/release-1/release-chain-integrity-phase34.json", repoRoot), "utf8"),
  readFile(new URL("package.json", apiRoot), "utf8"),
  readFile(new URL("docs/release-chain-integrity-phase34.md", repoRoot), "utf8"),
]);

const manifest = JSON.parse(manifestText);
const pkg = JSON.parse(pkgText);

assert.equal(manifest.schema, "carepoint.release-chain-integrity/v1");
assert.equal(manifest.schemaVersion, 1);
assert.equal(manifest.canonicalBaseline.pr, 511);
assert.equal(manifest.canonicalBaseline.headSha, "9974b72b76b45539e6513730c3b8fdbe0d1506f0");
assert.equal(manifest.canonicalBaseline.canonicalWorkflowCount, 25);
assert.equal(manifest.canonicalBaseline.canonicalMatrixConclusion, "SUCCESS");

assert.deepEqual(
  manifest.chain.map(({pr, basePr}) => ({pr, basePr})),
  [
    {pr: 512, basePr: 511},
    {pr: 513, basePr: 512},
    {pr: 514, basePr: 513},
  ],
);

assert.deepEqual(
  manifest.chain.map((item) => item.headSha),
  [
    "b261ca60b90686286dc1836ae11f1673cd293855",
    "84b27c46cf1a32e4c9efe1d7598bfbd114a13189",
    "6655099927962d2f3f7c7ff0f22978d0a1f5a266",
  ],
);

assert.equal(manifest.invariants.productionAcceptance, false);
assert.equal(manifest.invariants.mainMergeAllowed, false);
assert.equal(manifest.invariants.humanReleaseAuthorizationRequired, true);
assert.equal(manifest.invariants.autoMergeAllowed, false);
assert.equal(manifest.invariants.externalEvidenceMustNotBeSynthesized, true);
assert.equal(manifest.finalDecisionBoundary.fewerThanEightAccepted, "BLOCKED");
assert.equal(
  manifest.finalDecisionBoundary.eightOfEightAccepted,
  "READY_FOR_HUMAN_RELEASE_AUTHORIZATION",
);

assert.equal(pkg.scripts["v2:release-phase34"], "node scripts/v2-release-phase34-smoke.mjs");
assert.ok(pkg.scripts.test.includes("npm run v2:release-phase33"));
assert.ok(pkg.scripts.test.includes("npm run v2:release-phase34"));
assert.ok(
  pkg.scripts.test.indexOf("npm run v2:release-phase33") <
    pkg.scripts.test.indexOf("npm run v2:release-phase34"),
);

for (const token of [
  "Release Phase 34",
  "#511",
  "#512",
  "#513",
  "#514",
  "release-chain integrity",
  "productionAcceptance=false",
  "mainMergeAllowed=false",
  "human authorization",
  "No new production environment variables",
  "No .env file",
]) {
  assert.ok(docs.includes(token), "Phase 34 docs must include: " + token);
}

console.log("Release Phase 34 chain-integrity contract passed.");
