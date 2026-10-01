import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const indexArg = process.argv[2] ?? "ops/release-1/go-live-evidence-index.example.json";

if (isAbsolute(indexArg)) throw new Error("Evidence index must be repository-relative.");
const indexPath = resolve(repoRoot, indexArg);
const rel = relative(repoRoot, indexPath);
if (rel.startsWith("..") || rel.includes("../")) throw new Error("Evidence index escapes repository root.");

const [indexText, chainText] = await Promise.all([
  readFile(indexPath, "utf8"),
  readFile(resolve(repoRoot, "ops/release-1/release-chain-integrity-phase34.json"), "utf8"),
]);

const index = JSON.parse(indexText);
const chain = JSON.parse(chainText);

assert.equal(index.schema, "carepoint.go-live-evidence-index/v1");
assert.equal(chain.schema, "carepoint.release-chain-integrity/v1");
assert.equal(index.releaseCandidate.consolidatedPr, chain.canonicalBaseline.pr);
assert.equal(index.releaseCandidate.sourceSha, chain.canonicalBaseline.headSha);
assert.equal(index.productionAcceptance, false);
assert.equal(index.mainMergeAllowed, false);
assert.equal(index.humanReleaseAuthorizationRequired, true);

const accepted = index.gates.filter((g) => g.status === "ACCEPTED");
const pending = index.gates.filter((g) => g.status === "PENDING");
assert.equal(accepted.length + pending.length, 8);

const ready = accepted.length === 8;
assert.equal(
  index.finalDecision,
  ready ? "READY_FOR_HUMAN_RELEASE_AUTHORIZATION" : "BLOCKED",
);

const packet = {
  schema: "carepoint.human-release-authorization-packet/v1",
  generatedFrom: rel.replaceAll("\\", "/"),
  releaseCandidate: index.releaseCandidate,
  releaseChain: {
    canonicalBaseline: chain.canonicalBaseline,
    controls: chain.chain,
  },
  externalGateSummary: {
    accepted: accepted.length,
    pending: pending.length,
    total: 8,
    completionPercent: Math.round((accepted.length / 8) * 100),
    finalDecision: index.finalDecision,
  },
  authorizationBoundary: {
    eligibleForHumanAuthorization: ready,
    humanAuthorizationRecorded: false,
    productionAcceptance: false,
    mainMergeAllowed: false,
    autoMergeAllowed: false,
  },
  gates: index.gates.map((g) => ({
    id: g.id,
    status: g.status,
    evidenceFile: g.evidenceFile ?? null,
    evidenceSha256: g.evidenceSha256 ?? null,
    acceptedByRef: g.acceptedByRef ?? null,
    acceptedAt: g.acceptedAt ?? null,
  })),
};

process.stdout.write(JSON.stringify(packet, null, 2) + "\n");
