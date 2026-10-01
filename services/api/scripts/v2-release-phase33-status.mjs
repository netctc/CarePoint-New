import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const indexArg = process.argv[2] ?? "ops/release-1/go-live-evidence-index.example.json";
const formatArg = process.argv.includes("--json") ? "json" : "markdown";

if (isAbsolute(indexArg)) throw new Error("Evidence index must be repository-relative.");
const indexPath = resolve(repoRoot, indexArg);
const rel = relative(repoRoot, indexPath);
if (rel.startsWith("..") || rel.includes("../")) throw new Error("Evidence index escapes repository root.");

const index = JSON.parse(await readFile(indexPath, "utf8"));
assert.equal(index.schema, "carepoint.go-live-evidence-index/v1");
assert.equal(index.productionAcceptance, false);
assert.equal(index.mainMergeAllowed, false);
assert.equal(index.humanReleaseAuthorizationRequired, true);
assert.ok(Array.isArray(index.gates) && index.gates.length === 8);

const accepted = index.gates.filter((g) => g.status === "ACCEPTED");
const pending = index.gates.filter((g) => g.status === "PENDING");
assert.equal(accepted.length + pending.length, 8, "Only ACCEPTED/PENDING gate states are permitted.");

const expectedDecision = accepted.length === 8
  ? "READY_FOR_HUMAN_RELEASE_AUTHORIZATION"
  : "BLOCKED";
assert.equal(index.finalDecision, expectedDecision);

const report = {
  schema: "carepoint.go-live-evidence-status-report/v1",
  generatedFrom: rel.replaceAll("\\", "/"),
  releaseCandidate: index.releaseCandidate,
  gateSummary: {
    accepted: accepted.length,
    pending: pending.length,
    total: 8,
    completionPercent: Math.round((accepted.length / 8) * 100),
  },
  finalDecision: index.finalDecision,
  productionAcceptance: false,
  mainMergeAllowed: false,
  humanReleaseAuthorizationRequired: true,
  gates: index.gates.map((g) => ({
    id: g.id,
    status: g.status,
    evidenceFile: g.evidenceFile ?? null,
    acceptedByRef: g.acceptedByRef ?? null,
    acceptedAt: g.acceptedAt ?? null,
  })),
};

if (formatArg === "json") {
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
} else {
  const lines = [
    "# CarePoint Release Evidence Status",
    "",
    `- Release PR: #${report.releaseCandidate.consolidatedPr}`,
    `- Source SHA: \`${report.releaseCandidate.sourceSha}\``,
    `- External gates: ${report.gateSummary.accepted}/8 accepted (${report.gateSummary.completionPercent}%)`,
    `- Final decision: **${report.finalDecision}**`,
    "- Production acceptance: **false**",
    "- Main merge allowed: **false**",
    "- Human release authorization required: **true**",
    "",
    "| Gate | Status | Evidence |",
    "| --- | --- | --- |",
    ...report.gates.map((g) => `| ${g.id} | ${g.status} | ${g.evidenceFile ?? "—"} |`),
    "",
  ];
  process.stdout.write(lines.join("\n"));
}
