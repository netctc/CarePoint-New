import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const decisionArg = process.argv[2];
const humanAuthArg = process.argv[3];
const evidenceIndexArg = process.argv[4];

if (!decisionArg || !humanAuthArg || !evidenceIndexArg) {
  process.stderr.write(
    "Usage: node scripts/v2-release-phase37-merge-deploy.mjs <merge-deploy-record.json> <human-authorization-record.json> <evidence-index.json>\n",
  );
  process.exit(64);
}

for (const arg of [decisionArg, humanAuthArg, evidenceIndexArg]) {
  if (isAbsolute(arg)) throw new Error("Inputs must be repository-relative.");
  const abs = resolve(repoRoot, arg);
  const rel = relative(repoRoot, abs);
  if (rel.startsWith("..") || rel.includes("../")) throw new Error("Input escapes repository root.");
}

const [decisionText, humanText, indexText] = await Promise.all([
  readFile(resolve(repoRoot, decisionArg), "utf8"),
  readFile(resolve(repoRoot, humanAuthArg), "utf8"),
  readFile(resolve(repoRoot, evidenceIndexArg), "utf8"),
]);

const decision = JSON.parse(decisionText);
const human = JSON.parse(humanText);
const index = JSON.parse(indexText);

assert.equal(decision.schema, "carepoint.merge-deploy-authorization-record/v1");
assert.equal(human.schema, "carepoint.human-release-authorization-record/v1");
assert.equal(index.schema, "carepoint.go-live-evidence-index/v1");

for (const source of [human, index]) {
  assert.equal(source.releaseCandidate.consolidatedPr, decision.releaseCandidate.consolidatedPr);
  assert.equal(source.releaseCandidate.sourceSha, decision.releaseCandidate.sourceSha);
}

const acceptedCount = index.gates.filter((g) => g.status === "ACCEPTED").length;
const allEvidenceAccepted = acceptedCount === 8;
const humanAuthorized = human.authorization?.status === "AUTHORIZED";

assert.equal(index.finalDecision, allEvidenceAccepted ? "READY_FOR_HUMAN_RELEASE_AUTHORIZATION" : "BLOCKED");
assert.ok(["PENDING", "AUTHORIZED"].includes(decision.mergeDecision.status));
assert.ok(["PENDING", "AUTHORIZED"].includes(decision.deploymentDecision.status));
assert.equal(decision.productionAcceptance, false);
assert.equal(decision.postDeployValidationRequired, true);

function assertDecisionFields(section, label) {
  assert.ok(section.authorizedByRef, `${label}.authorizedByRef is required.`);
  assert.ok(section.authorizedAt, `${label}.authorizedAt is required.`);
  assert.ok(!Number.isNaN(Date.parse(section.authorizedAt)), `${label}.authorizedAt must be ISO-8601.`);
  assert.ok(section.decisionRef, `${label}.decisionRef is required.`);
}

const mergeAuthorized = decision.mergeDecision.status === "AUTHORIZED";
const deployAuthorized = decision.deploymentDecision.status === "AUTHORIZED";

if (mergeAuthorized || deployAuthorized) {
  assert.equal(allEvidenceAccepted, true, "Merge/deploy authorization is forbidden until all 8 external gates are ACCEPTED.");
  assert.equal(humanAuthorized, true, "Merge/deploy authorization is forbidden until Phase 36 human release authorization is AUTHORIZED.");
}

if (mergeAuthorized) assertDecisionFields(decision.mergeDecision, "mergeDecision");
if (deployAuthorized) {
  assertDecisionFields(decision.deploymentDecision, "deploymentDecision");
  assert.ok(decision.deploymentDecision.changeWindowRef, "deploymentDecision.changeWindowRef is required.");
  assert.equal(mergeAuthorized, true, "Deployment authorization requires merge authorization.");
}

assert.equal(decision.mainMergeAuthorized, mergeAuthorized);
assert.equal(decision.deploymentAuthorized, deployAuthorized);

const result = {
  schema: "carepoint.merge-deploy-authorization-validation/v1",
  acceptedGateCount: acceptedCount,
  humanReleaseAuthorizationRecorded: humanAuthorized,
  mainMergeAuthorized: mergeAuthorized,
  deploymentAuthorized: deployAuthorized,
  productionAcceptance: false,
  postDeployValidationRequired: true,
  nextDecision: deployAuthorized
    ? "EXECUTION_REQUIRES_OPERATOR_ACTION_AND_POST_DEPLOY_VALIDATION"
    : mergeAuthorized
      ? "DEPLOYMENT_STILL_REQUIRES_EXPLICIT_AUTHORIZATION"
      : "MERGE_AND_DEPLOY_REMAIN_BLOCKED",
};

process.stdout.write(JSON.stringify(result, null, 2) + "\n");
process.exitCode = mergeAuthorized || deployAuthorized ? 0 : 2;
