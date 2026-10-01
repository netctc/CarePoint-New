import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const indexPathArg = process.argv[2];

if (!indexPathArg) {
  process.stderr.write(
    "Usage: node scripts/v2-release-phase32-evidence.mjs <sanitized-evidence-index.json>\n",
  );
  process.exit(64);
}

const indexPath = resolve(repoRoot, indexPathArg);
const relativeIndex = relative(repoRoot, indexPath);
if (
  isAbsolute(indexPathArg) ||
  relativeIndex.startsWith("..") ||
  relativeIndex.includes("../")
) {
  throw new Error("Evidence index must be a repository-relative path.");
}

const readJson = async (absolutePath) =>
  JSON.parse(await readFile(absolutePath, "utf8"));

const phase31 = await readJson(
  resolve(repoRoot, "ops/release-1/final-go-live-gate-readiness-phase31.json"),
);
const index = await readJson(indexPath);

assert.equal(index.schemaVersion, 1);
assert.equal(index.schema, "carepoint.go-live-evidence-index/v1");
assert.equal(index.releaseCandidate.consolidatedPr, phase31.baselineValidation.consolidatedPr);
assert.equal(index.releaseCandidate.sourceSha, phase31.baselineValidation.validatedHead);
assert.equal(
  index.releaseCandidate.canonicalWorkflowCount,
  phase31.baselineValidation.canonicalWorkflowCount,
);
assert.equal(
  index.releaseCandidate.canonicalMatrixConclusion,
  phase31.baselineValidation.canonicalMatrixConclusion,
);
assert.equal(index.productionAcceptance, false);
assert.equal(index.mainMergeAllowed, false);
assert.equal(index.humanReleaseAuthorizationRequired, true);

const expectedGates = new Map(phase31.gates.map((gate) => [gate.id, gate]));
assert.equal(index.gates.length, expectedGates.size);
assert.deepEqual(
  [...index.gates.map((gate) => gate.id)].sort(),
  [...expectedGates.keys()].sort(),
  "Evidence index gate IDs must match Phase 31 exactly.",
);

const acceptedWords = new Set([
  "ACCEPTED",
  "APPROVED",
  "PASS",
  "PASSED",
  "READY",
  "COMPLETE",
  "COMPLETED",
  "RESOLVED",
  "CLOSED",
]);
const permittedNonBlockingWords = new Set([
  ...acceptedWords,
  "NOT_APPLICABLE",
  "DISABLED",
]);

const placeholderPatterns = [
  /REPLACE_WITH/i,
  /CHANGE-ME/i,
  /TO-BE-SET/i,
  /^<[^>]+>$/,
  /^PENDING(?:_|$)/i,
  /^0{40}$/,
  /^sha256:0{64}$/,
  /^0{64}$/,
  /^1970-01-01T00:00:00(?:\.000)?Z$/,
];

const forbiddenSecretKeys = new Set([
  "password",
  "accesstoken",
  "refreshtoken",
  "privatekey",
  "secretvalue",
  "authorization",
  "cookie",
  "setcookie",
]);

function assertNoPlaceholders(value, path = "$") {
  if (typeof value === "string") {
    for (const pattern of placeholderPatterns) {
      assert.equal(
        pattern.test(value),
        false,
        `Accepted evidence contains placeholder at ${path}: ${value}`,
      );
    }
    assert.equal(
      ["PENDING", "BLOCKED", "DRAFT", "UNDECIDED"].includes(value),
      false,
      `Accepted evidence contains non-final state at ${path}: ${value}`,
    );
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoPlaceholders(item, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (forbiddenSecretKeys.has(normalizedKey)) {
        assert.ok(
          child === null || child === "" || child === false,
          `Accepted evidence must not embed secret field ${path}.${key}`,
        );
      }
      assertNoPlaceholders(child, `${path}.${key}`);
    }
  }
}

function assertReleaseSha(evidence, expectedSha) {
  const candidates = [
    evidence?.release?.sourceSha,
    evidence?.release?.sourceSHA,
    evidence?.releaseCandidate?.sourceSha,
  ].filter(Boolean);
  if (candidates.length) {
    for (const sourceSha of candidates) {
      assert.equal(sourceSha, expectedSha, "Evidence release SHA must match final candidate.");
    }
  }
}

function assertSensitiveDataFlags(evidence) {
  if ("sensitiveDataIncluded" in evidence) {
    assert.equal(evidence.sensitiveDataIncluded, false);
  }
  if ("restrictedReportContentIncluded" in evidence) {
    assert.equal(evidence.restrictedReportContentIncluded, false);
  }
}

function assertApprovedArray(rows, label) {
  assert.ok(Array.isArray(rows) && rows.length > 0, `${label} approvals are required.`);
  for (const row of rows) {
    const decision = String(row.decision ?? row.status ?? "").toUpperCase();
    assert.ok(
      acceptedWords.has(decision),
      `${label} approval ${row.role ?? "<unknown>"} is not accepted: ${decision}`,
    );
  }
}

function assertApprovedObject(approvals, label) {
  assert.ok(approvals && typeof approvals === "object" && !Array.isArray(approvals));
  for (const [key, value] of Object.entries(approvals)) {
    if (key === "approvalRef" || key === "clinicalRequired") continue;
    if (typeof value === "boolean") {
      assert.equal(value, true, `${label} approval flag must be true: ${key}`);
    }
  }
  if (approvals.clinicalRequired === true) {
    assert.equal(approvals.clinical, true, `${label} clinical approval is required.`);
  }
}

function assertCommonApproval(evidence, gateId) {
  if ("approved" in evidence) assert.equal(evidence.approved, true, `${gateId} approved must be true.`);
  if ("overallStatus" in evidence) {
    assert.ok(
      acceptedWords.has(String(evidence.overallStatus).toUpperCase()),
      `${gateId} overallStatus is not accepted: ${evidence.overallStatus}`,
    );
  }
  if ("finalDecision" in evidence) {
    assert.ok(
      acceptedWords.has(String(evidence.finalDecision).toUpperCase()),
      `${gateId} finalDecision is not accepted: ${evidence.finalDecision}`,
    );
  }
  if ("acceptedAt" in evidence) {
    assert.ok(evidence.acceptedAt, `${gateId} acceptedAt is required.`);
    assert.ok(!Number.isNaN(Date.parse(evidence.acceptedAt)), `${gateId} acceptedAt must be ISO-8601.`);
  }
  if (Array.isArray(evidence.approvals)) assertApprovedArray(evidence.approvals, gateId);
  else if (evidence.approvals && typeof evidence.approvals === "object") {
    assertApprovedObject(evidence.approvals, gateId);
  }
}

function assertGateSpecific(gateId, evidence) {
  if (gateId === "LIVE-01-PRODUCTION-INFRASTRUCTURE") {
    for (const control of evidence.controls ?? []) {
      const applicability = String(control.applicability ?? "").toUpperCase();
      if (applicability === "NOT_APPLICABLE") continue;
      assert.ok(
        acceptedWords.has(String(control.status ?? "").toUpperCase()),
        `Infrastructure control ${control.id} is not accepted.`,
      );
    }
    assert.ok(
      acceptedWords.has(String(evidence.continuity?.status ?? "").toUpperCase()),
      "Infrastructure continuity evidence must be accepted.",
    );
  }

  if (gateId === "LIVE-02-EXTERNAL-PROVIDERS") {
    for (const integration of evidence.integrations ?? []) {
      const disposition = String(integration.disposition ?? "").toUpperCase();
      if (["DISABLED", "NOT_APPLICABLE"].includes(disposition)) continue;
      assert.ok(
        acceptedWords.has(String(integration.status ?? "").toUpperCase()),
        `External integration ${integration.id} is not accepted.`,
      );
    }
  }

  if (gateId === "LIVE-03-SIGNED-MOBILE-RELEASES") {
    for (const artifact of evidence.artifacts ?? []) {
      const status = String(artifact.status ?? artifact.validationStatus ?? "").toUpperCase();
      if (status) {
        assert.ok(
          acceptedWords.has(status),
          `Mobile artifact ${artifact.id ?? artifact.app ?? "<unknown>"} is not accepted.`,
        );
      }
    }
  }

  if (gateId === "LIVE-04-INDEPENDENT-SECURITY-ASSESSMENT") {
    assert.equal(evidence.assessment?.independenceConfirmed, true);
    assert.equal(evidence.assessment?.manualTestingPerformed, true);
    assert.equal(evidence.assessment?.productionValidationAuthorized, true);
    assert.equal(evidence.findings?.countsKnown, true);
  }

  if (gateId === "LIVE-05-HUMAN-UAT") {
    for (const item of evidence.cases ?? []) {
      const applicability = String(item.applicability ?? "").toUpperCase();
      if (applicability === "NOT_APPLICABLE") continue;
      assert.ok(
        acceptedWords.has(String(item.status ?? "").toUpperCase()),
        `UAT case ${item.id} is not accepted.`,
      );
    }
    for (const signoff of evidence.journeySignoffs ?? []) {
      assert.ok(
        acceptedWords.has(String(signoff.decision ?? "").toUpperCase()),
        `UAT journey ${signoff.journey} is not accepted.`,
      );
    }
  }

  if (gateId === "LIVE-06-RESILIENCE-RPO-RTO") {
    assert.equal(evidence.approved, true);
    for (const scenario of evidence.scenarioCatalog ?? []) {
      assert.equal(scenario.enabled, true, `Resilience scenario ${scenario.id} must be executed/enabled.`);
    }
  }

  if (gateId === "LIVE-07-KSA-MARKET-CLINICAL-APPROVALS") {
    for (const issue of evidence.blockingIssues ?? []) {
      assert.ok(
        permittedNonBlockingWords.has(String(issue.status ?? "").toUpperCase()),
        `Market-readiness blocker ${issue.id} is still blocking.`,
      );
    }
    for (const control of evidence.controls ?? []) {
      const applicability = String(control.applicability ?? "").toUpperCase();
      if (applicability === "NOT_APPLICABLE") continue;
      assert.ok(
        acceptedWords.has(String(control.status ?? "").toUpperCase()),
        `Market/clinical control ${control.id} is not accepted.`,
      );
    }
  }

  if (gateId === "LIVE-08-DEPLOYMENT-ROLLBACK-REHEARSAL") {
    assert.equal(evidence.predeploy?.pitrReady, true);
    assert.equal(evidence.predeploy?.configReady, true);
    assert.equal(evidence.deployment?.safetySignalsPass, true);
    assert.equal(evidence.rollback?.executed, true);
    assert.equal(evidence.rollback?.sideEffectsReconciled, true);
    assert.equal(evidence.recovery?.pitrRehearsed, true);
    assert.equal(evidence.approvals?.rehearsalAccepted, true);
  }
}

const results = [];
for (const entry of index.gates) {
  const gate = expectedGates.get(entry.id);
  assert.ok(gate, `Unknown gate: ${entry.id}`);
  assert.ok(["PENDING", "ACCEPTED"].includes(entry.status));

  if (entry.status === "PENDING") {
    assert.equal(entry.evidenceFile, null);
    assert.equal(entry.evidenceSha256, null);
    assert.equal(entry.acceptedByRef, null);
    assert.equal(entry.acceptedAt, null);
    results.push({ id: entry.id, status: "PENDING" });
    continue;
  }

  assert.ok(entry.evidenceFile, `${entry.id} accepted evidence file is required.`);
  assert.ok(entry.evidenceSha256, `${entry.id} accepted evidence SHA-256 is required.`);
  assert.ok(entry.acceptedByRef, `${entry.id} acceptedByRef is required.`);
  assert.ok(entry.acceptedAt && !Number.isNaN(Date.parse(entry.acceptedAt)));

  assert.equal(entry.evidenceFile.endsWith(".example.json"), false);
  assert.ok(
    entry.evidenceFile.startsWith("ops/release-1/evidence/"),
    `${entry.id} evidence must live under ops/release-1/evidence/.`,
  );
  assert.equal(entry.evidenceFile.includes(".."), false);

  const absoluteEvidence = resolve(repoRoot, entry.evidenceFile);
  const relativeEvidence = relative(repoRoot, absoluteEvidence);
  assert.equal(relativeEvidence.startsWith(".."), false);

  const raw = await readFile(absoluteEvidence);
  const actualSha256 = createHash("sha256").update(raw).digest("hex");
  assert.match(entry.evidenceSha256, /^[a-f0-9]{64}$/);
  assert.equal(actualSha256, entry.evidenceSha256, `${entry.id} evidence SHA-256 mismatch.`);

  const evidence = JSON.parse(raw.toString("utf8"));
  const template = await readJson(resolve(repoRoot, gate.evidenceTemplate));
  assert.equal(
    evidence.schema,
    template.schema,
    `${entry.id} evidence schema must match its approved template schema.`,
  );

  assertSensitiveDataFlags(evidence);
  assertReleaseSha(evidence, index.releaseCandidate.sourceSha);
  assertNoPlaceholders(evidence);
  assertCommonApproval(evidence, entry.id);
  assertGateSpecific(entry.id, evidence);

  results.push({
    id: entry.id,
    status: "ACCEPTED",
    evidenceFile: entry.evidenceFile,
    evidenceSha256: actualSha256,
  });
}

const acceptedCount = results.filter((row) => row.status === "ACCEPTED").length;
const allAccepted = acceptedCount === expectedGates.size;

assert.equal(index.productionAcceptance, false);
assert.equal(index.mainMergeAllowed, false);
assert.equal(index.humanReleaseAuthorizationRequired, true);
assert.equal(
  index.finalDecision,
  allAccepted ? "READY_FOR_HUMAN_RELEASE_AUTHORIZATION" : "BLOCKED",
);

const summary = {
  schema: "carepoint.go-live-evidence-validation-result/v1",
  releaseCandidate: index.releaseCandidate,
  acceptedGateCount: acceptedCount,
  totalGateCount: expectedGates.size,
  allExternalEvidenceAccepted: allAccepted,
  finalDecision: index.finalDecision,
  humanReleaseAuthorizationRequired: true,
  mainMergeAllowed: false,
  productionAcceptancePerformed: false,
  gates: results,
};

process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
process.exitCode = allAccepted ? 0 : 2;
