import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const apiRoot = new URL("../", import.meta.url);
const repoRoot = new URL("../../../", import.meta.url);

const [script, pkgText, docs, chainText] = await Promise.all([
  readFile(new URL("scripts/v2-release-phase35-packet.mjs", apiRoot), "utf8"),
  readFile(new URL("package.json", apiRoot), "utf8"),
  readFile(new URL("docs/release-authorization-packet-phase35.md", repoRoot), "utf8"),
  readFile(new URL("ops/release-1/release-chain-integrity-phase34.json", repoRoot), "utf8"),
]);

const pkg = JSON.parse(pkgText);
const chain = JSON.parse(chainText);

assert.equal(chain.canonicalBaseline.pr, 511);
assert.equal(chain.chain.at(-1).pr, 514);

for (const token of [
  "carepoint.human-release-authorization-packet/v1",
  "eligibleForHumanAuthorization",
  "humanAuthorizationRecorded: false",
  "productionAcceptance: false",
  "mainMergeAllowed: false",
  "autoMergeAllowed: false",
  "READY_FOR_HUMAN_RELEASE_AUTHORIZATION",
  "BLOCKED",
]) {
  assert.ok(script.includes(token), "Phase 35 packet generator must include: " + token);
}

assert.equal(pkg.scripts["v2:release-phase35"], "node scripts/v2-release-phase35-smoke.mjs");
assert.equal(pkg.scripts["v2:release-phase35-packet"], "node scripts/v2-release-phase35-packet.mjs");
assert.ok(pkg.scripts.test.includes("npm run v2:release-phase34"));
assert.ok(pkg.scripts.test.includes("npm run v2:release-phase35"));
assert.ok(
  pkg.scripts.test.indexOf("npm run v2:release-phase34") <
    pkg.scripts.test.indexOf("npm run v2:release-phase35"),
);

for (const token of [
  "Release Phase 35",
  "human release authorization packet",
  "8 external gates",
  "read-only",
  "does not authorize",
  "productionAcceptance=false",
  "mainMergeAllowed=false",
  "No new production environment variables",
  "No .env file",
]) {
  assert.ok(docs.includes(token), "Phase 35 docs must include: " + token);
}

console.log("Release Phase 35 authorization-packet contract passed.");
