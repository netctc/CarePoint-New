import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const [gateId, evidencePathArg] = process.argv.slice(2);

if (!gateId || !evidencePathArg) {
  process.stderr.write(
    "Usage: node scripts/v2-release-external-gate-preflight.mjs <gate-id> <ops/release-1/evidence/evidence.json>\n",
  );
  process.exit(64);
}

if (isAbsolute(evidencePathArg)) {
  throw new Error("Evidence path must be repository-relative.");
}
const absoluteEvidence = resolve(repoRoot, evidencePathArg);
const relativeEvidence = relative(repoRoot, absoluteEvidence);
if (relativeEvidence.startsWith("..") || relativeEvidence.includes("../")) {
  throw new Error("Evidence path escapes repository root.");
}
assert.ok(
  evidencePathArg.startsWith("ops/release-1/evidence/"),
  "Preflight evidence must live under ops/release-1/evidence/.",
);
assert.equal(
  evidencePathArg.endsWith(".example.json"),
  false,
  "Example evidence files cannot be preflighted as accepted evidence.",
);

const [phase31Text, exampleIndexText, evidenceRaw] = await Promise.all([
  readFile(resolve(repoRoot, "ops/release-1/final-go-live-gate-readiness-phase31.json"), "utf8"),
  readFile(resolve(repoRoot, "ops/release-1/go-live-evidence-index.example.json"), "utf8"),
  readFile(absoluteEvidence),
]);

const phase31 = JSON.parse(phase31Text);
const exampleIndex = JSON.parse(exampleIndexText);
const gate = phase31.gates.find((row) => row.id === gateId);
assert.ok(gate, `Unknown external gate: ${gateId}`);

const evidenceSha256 = createHash("sha256").update(evidenceRaw).digest("hex");
const index = structuredClone(exampleIndex);
index.gates = index.gates.map((row) =>
  row.id === gateId
    ? {
        ...row,
        status: "ACCEPTED",
        evidenceFile: evidencePathArg,
        evidenceSha256,
        acceptedByRef: "PREFLIGHT_VALIDATOR_SCAFFOLD_NOT_ACCEPTANCE",
        acceptedAt: new Date().toISOString(),
      }
    : row,
);
index.finalDecision = "BLOCKED";
index.productionAcceptance = false;
index.mainMergeAllowed = false;
index.humanReleaseAuthorizationRequired = true;

const tempRelative = `.carepoint-phase32-preflight-${process.pid}.json`;
const tempAbsolute = resolve(repoRoot, tempRelative);
let child;

try {
  await writeFile(tempAbsolute, JSON.stringify(index, null, 2) + "\n", {
    encoding: "utf8",
    flag: "wx",
  });

  child = spawnSync(
    process.execPath,
    [
      resolve(repoRoot, "services/api/scripts/v2-release-phase32-evidence.mjs"),
      tempRelative,
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: process.env,
    },
  );
} finally {
  await unlink(tempAbsolute).catch(() => {});
}

if (!child) throw new Error("Phase 32 validator did not execute.");

let summary = null;
try {
  summary = JSON.parse(child.stdout || "{}");
} catch {
  // Preserve the original validator error below.
}

const gateResult = summary?.gates?.find((row) => row.id === gateId);
const validSingleGatePreflight =
  child.status === 2 &&
  summary?.schema === "carepoint.go-live-evidence-validation-result/v1" &&
  summary?.acceptedGateCount === 1 &&
  summary?.totalGateCount === 8 &&
  summary?.allExternalEvidenceAccepted === false &&
  summary?.finalDecision === "BLOCKED" &&
  summary?.mainMergeAllowed === false &&
  summary?.productionAcceptancePerformed === false &&
  gateResult?.status === "ACCEPTED" &&
  gateResult?.evidenceSha256 === evidenceSha256;

if (!validSingleGatePreflight) {
  if (child.stdout) process.stderr.write(child.stdout);
  if (child.stderr) process.stderr.write(child.stderr);
  process.exit(child.status && child.status !== 0 ? child.status : 1);
}

process.stdout.write(
  JSON.stringify(
    {
      schema: "carepoint.external-gate-preflight-result/v1",
      gateId,
      evidenceFile: evidencePathArg,
      evidenceSha256,
      phase32RulesPassed: true,
      acceptanceRecorded: false,
      gateClosed: false,
      indexModified: false,
      externalEvidenceAcceptedCount: 0,
      finalDecision: "PREFLIGHT_PASSED_NOT_ACCEPTANCE",
      nextStep:
        "Submit sanitized evidence reference and real acceptance metadata through the governed Phase 32 evidence index.",
    },
    null,
    2,
  ) + "\n",
);
