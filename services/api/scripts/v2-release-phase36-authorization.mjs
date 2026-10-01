import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const recordArg = process.argv[2];
const evidenceIndexArg = process.argv[3];

if (!recordArg || !evidenceIndexArg) {
  process.stderr.write("Usage: node scripts/v2-release-phase36-authorization.mjs <authorization-record.json> <evidence-index.json>\n");
  process.exit(64);
}

for (const arg of [recordArg, evidenceIndexArg]) {
  if (isAbsolute(arg)) throw new Error("Inputs must be repository-relative.");
  const abs = resolve(repoRoot, arg);
  const rel = relative(repoRoot, abs);
  if (rel.startsWith("..") || rel.includes("../")) throw new Error("Input escapes repository root.");
}

const [recordText, indexText] = await Promise.all([
  readFile(resolve(repoRoot, recordArg), "utf8"),
  readFile(resolve(repoRoot, evidenceIndexArg), "utf8"),
]);

const record = JSON.parse(recordText);
const index = JSON.parse(indexText);

assert.equal(record.schema, "carepoint.human-release-authorization-record/v1");
assert.equal(index.schema, "carepoint.go-live-evidence-index/v1");
assert.equal(record.releaseCandidate.consolidatedPr, index.releaseCandidate.consolidatedPr);
assert.equal(record.releaseCandidate.sourceSha, index.releaseCandidate.sourceSha);
assert.equal(index.gates.length, 8);
assert.equal(index.productionAcceptance, false);
assert.equal(index.mainMergeAllowed, false);
for (const gate of index.gates) assert.ok(["PENDING", "ACCEPTED"].includes(gate.status));

const acceptedCount = index.gates.filter((g) => g.status === "ACCEPTED").length;
const allAccepted = acceptedCount === 8;
assert.equal(
  index.finalDecision,
  allAccepted ? "READY_FOR_HUMAN_RELEASE_AUTHORIZATION" : "BLOCKED",
);

assert.ok(["PENDING", "AUTHORIZED"].includes(record.authorization.status));
assert.equal(record.productionAcceptance, false);
assert.equal(record.mainMergeAllowed, false);
assert.equal(record.deploymentAuthorized, false);

if (record.authorization.status === "PENDING") {
  assert.equal(record.authorization.authorizedByRef, null);
  assert.equal(record.authorization.authorizedAt, null);
  assert.equal(record.authorization.decisionRef, null);
  process.stdout.write(JSON.stringify({
    schema: "carepoint.human-release-authorization-validation/v1",
    status: "PENDING",
    acceptedGateCount: acceptedCount,
    humanAuthorizationRecorded: false,
    deploymentAuthorized: false,
    mainMergeAllowed: false,
    productionAcceptance: false
  }, null, 2) + "\n");
  process.exit(2);
}

assert.equal(allAccepted, true, "Human authorization is forbidden until all 8 external gates are ACCEPTED.");
assert.ok(record.authorization.authorizedByRef, "authorizedByRef is required.");
assert.ok(record.authorization.decisionRef, "decisionRef is required.");
assert.ok(record.authorization.authorizedAt, "authorizedAt is required.");
assert.ok(!Number.isNaN(Date.parse(record.authorization.authorizedAt)), "authorizedAt must be ISO-8601.");

const requiredAcknowledgements = [
  "externalEvidenceEightOfEightAccepted",
  "rollbackPlanReviewed",
  "productionChangeWindowApproved",
  "postDeployValidationOwnerAssigned",
];
for (const name of requiredAcknowledgements) {
  assert.equal(record.acknowledgements?.[name], true, `Acknowledgement must be true: ${name}`);
}

process.stdout.write(JSON.stringify({
  schema: "carepoint.human-release-authorization-validation/v1",
  releaseCandidate: record.releaseCandidate,
  status: "AUTHORIZED",
  acceptedGateCount: acceptedCount,
  humanAuthorizationRecorded: true,
  authorizedByRef: record.authorization.authorizedByRef,
  authorizedAt: record.authorization.authorizedAt,
  decisionRef: record.authorization.decisionRef,
  deploymentAuthorized: false,
  mainMergeAllowed: false,
  productionAcceptance: false,
  nextDecision: "SEPARATE_EXPLICIT_MERGE_AND_DEPLOY_AUTHORIZATION_REQUIRED"
}, null, 2) + "\n");
