import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const evidenceDir = resolve(repoRoot, "ops/release-1/evidence");
const markdown = process.argv.includes("--markdown");

const phase31 = JSON.parse(
  await readFile(
    resolve(repoRoot, "ops/release-1/final-go-live-gate-readiness-phase31.json"),
    "utf8",
  ),
);

const gateTemplates = [];
for (const gate of phase31.gates) {
  const template = JSON.parse(
    await readFile(resolve(repoRoot, gate.evidenceTemplate), "utf8"),
  );
  gateTemplates.push({
    gateId: gate.id,
    schema: template.schema,
    template: gate.evidenceTemplate,
  });
}

const schemas = new Map();
for (const row of gateTemplates) {
  assert.ok(row.schema, `Gate ${row.gateId} template schema is required.`);
  assert.equal(
    schemas.has(row.schema),
    false,
    `Duplicate evidence schema across gates: ${row.schema}`,
  );
  schemas.set(row.schema, row);
}

let dirEntries = [];
try {
  dirEntries = await readdir(evidenceDir, { withFileTypes: true });
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const jsonFiles = dirEntries
  .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
  .map((entry) => entry.name)
  .sort();

const resultsByGate = new Map(
  phase31.gates.map((gate) => [
    gate.id,
    {
      gateId: gate.id,
      status: "MISSING",
      evidenceFile: null,
      detail: "No evidence file detected.",
    },
  ]),
);

const seenGateFiles = new Map();
const failures = [];

for (const filename of jsonFiles) {
  const relativeEvidence = `ops/release-1/evidence/${filename}`;
  const absoluteEvidence = resolve(repoRoot, relativeEvidence);
  const relativeCheck = relative(repoRoot, absoluteEvidence);
  assert.equal(relativeCheck.startsWith(".."), false);

  let evidence;
  try {
    evidence = JSON.parse(await readFile(absoluteEvidence, "utf8"));
  } catch {
    failures.push({
      gateId: null,
      status: "INVALID_JSON",
      evidenceFile: relativeEvidence,
      detail: "Evidence file is not valid JSON.",
    });
    continue;
  }

  const match = schemas.get(evidence.schema);
  if (!match) {
    failures.push({
      gateId: null,
      status: "UNKNOWN_SCHEMA",
      evidenceFile: relativeEvidence,
      detail: "Evidence schema does not match any governed Phase 31 gate template.",
    });
    continue;
  }

  if (seenGateFiles.has(match.gateId)) {
    failures.push({
      gateId: match.gateId,
      status: "DUPLICATE_GATE_EVIDENCE",
      evidenceFile: relativeEvidence,
      detail: `Multiple evidence JSON files map to ${match.gateId}.`,
    });
    continue;
  }
  seenGateFiles.set(match.gateId, relativeEvidence);

  const child = spawnSync(
    process.execPath,
    [
      resolve(
        repoRoot,
        "services/api/scripts/v2-release-external-gate-preflight.mjs",
      ),
      match.gateId,
      relativeEvidence,
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: process.env,
    },
  );

  if (child.status === 0) {
    let payload = null;
    try {
      payload = JSON.parse(child.stdout || "{}");
    } catch {
      // Fail closed below.
    }

    const passed =
      payload?.schema === "carepoint.external-gate-preflight-result/v1" &&
      payload?.gateId === match.gateId &&
      payload?.phase32RulesPassed === true &&
      payload?.acceptanceRecorded === false &&
      payload?.gateClosed === false &&
      payload?.indexModified === false &&
      payload?.finalDecision === "PREFLIGHT_PASSED_NOT_ACCEPTANCE";

    if (passed) {
      resultsByGate.set(match.gateId, {
        gateId: match.gateId,
        status: "PREFLIGHT_PASSED",
        evidenceFile: relativeEvidence,
        evidenceSha256: payload.evidenceSha256,
        detail: "Phase 32 single-gate rules passed; no acceptance recorded.",
      });
      continue;
    }
  }

  failures.push({
    gateId: match.gateId,
    status: "PREFLIGHT_FAILED",
    evidenceFile: relativeEvidence,
    detail:
      "Phase 32 preflight failed. Run the single-gate preflight locally for detailed diagnostics.",
  });
  resultsByGate.set(match.gateId, {
    gateId: match.gateId,
    status: "PREFLIGHT_FAILED",
    evidenceFile: relativeEvidence,
    detail: "Evidence is present but did not pass governed preflight.",
  });
}

const gates = phase31.gates.map((gate) => resultsByGate.get(gate.id));
const passedCount = gates.filter((row) => row.status === "PREFLIGHT_PASSED").length;
const missingCount = gates.filter((row) => row.status === "MISSING").length;
const failedCount =
  gates.filter((row) => row.status === "PREFLIGHT_FAILED").length +
  failures.filter((row) => row.status !== "PREFLIGHT_FAILED").length;

const summary = {
  schema: "carepoint.external-evidence-intake-scan/v1",
  totalGateCount: phase31.gates.length,
  preflightPassedCount: passedCount,
  missingGateCount: missingCount,
  failedEvidenceCount: failedCount,
  acceptanceRecorded: false,
  realEvidenceIndexModified: false,
  productionAcceptancePerformed: false,
  mainMergeAllowed: false,
  finalDecision:
    failedCount > 0 ? "INTAKE_ERRORS" : "INTAKE_READY_FOR_CONTINUED_COLLECTION",
  gates,
  intakeErrors: failures,
};

if (markdown) {
  const lines = [
    "# External Evidence Intake Preflight",
    "",
    `- Gates preflight-passed: **${passedCount}/${phase31.gates.length}**`,
    `- Gates still missing: **${missingCount}**`,
    `- Intake errors: **${failedCount}**`,
    "- Acceptance recorded: **no**",
    "- Real evidence index modified: **no**",
    "",
    "| Gate | Status | Evidence |",
    "| --- | --- | --- |",
    ...gates.map(
      (row) =>
        `| ${row.gateId} | ${row.status} | ${row.evidenceFile ?? "—"} |`,
    ),
  ];

  if (failures.length) {
    lines.push("", "## Intake errors", "");
    for (const failure of failures) {
      lines.push(
        `- ${failure.gateId ?? "UNMAPPED"} — ${failure.status} — ${failure.evidenceFile}: ${failure.detail}`,
      );
    }
  }

  lines.push(
    "",
    "> A preflight pass is not gate acceptance and does not authorize merge, deployment or production.",
    "",
  );
  process.stdout.write(lines.join("\n"));
} else {
  process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
}

process.exitCode = failedCount > 0 ? 1 : 0;
