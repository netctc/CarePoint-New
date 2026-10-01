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


function templateIdentityKeys(rows) {
  const candidates = [
    ["app", "platform"],
    ["id", "platform"],
    ["id"],
    ["role"],
    ["journey"],
    ["app"],
  ];
  for (const keys of candidates) {
    if (
      rows.every(
        (row) =>
          row &&
          typeof row === "object" &&
          !Array.isArray(row) &&
          keys.every((key) => Object.prototype.hasOwnProperty.call(row, key)),
      )
    ) {
      const identities = rows.map((row) => keys.map((key) => String(row[key])).join("::"));
      if (new Set(identities).size === rows.length) return keys;
    }
  }
  return null;
}

function assertTemplateStructure(evidence, template, path = "$") {
  if (Array.isArray(template)) {
    assert.ok(Array.isArray(evidence), `${path} must be an array.`);
    if (template.length === 0) return;

    if (
      template.every(
        (row) => row && typeof row === "object" && !Array.isArray(row),
      )
    ) {
      const identityKeys = templateIdentityKeys(template);
      if (identityKeys) {
        const actualByIdentity = new Map();
        for (const row of evidence) {
          assert.ok(
            row && typeof row === "object" && !Array.isArray(row),
            `${path} entries must be objects.`,
          );
          const identity = identityKeys.map((key) => String(row[key])).join("::");
          assert.equal(
            actualByIdentity.has(identity),
            false,
            `${path} contains duplicate identity ${identity}.`,
          );
          actualByIdentity.set(identity, row);
        }
        for (const templateRow of template) {
          const identity = identityKeys
            .map((key) => String(templateRow[key]))
            .join("::");
          assert.ok(
            actualByIdentity.has(identity),
            `${path} is missing required template entry ${identity}.`,
          );
          assertTemplateStructure(
            actualByIdentity.get(identity),
            templateRow,
            `${path}[${identity}]`,
          );
        }
        return;
      }
    }

    assert.ok(
      evidence.length >= template.length,
      `${path} must contain at least ${template.length} entries.`,
    );
    for (let index = 0; index < template.length; index += 1) {
      assertTemplateStructure(evidence[index], template[index], `${path}[${index}]`);
    }
    return;
  }

  if (template && typeof template === "object") {
    assert.ok(
      evidence && typeof evidence === "object" && !Array.isArray(evidence),
      `${path} must be an object.`,
    );
    for (const [key, templateValue] of Object.entries(template)) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(evidence, key),
        `${path} is missing required field ${key}.`,
      );
      assertTemplateStructure(evidence[key], templateValue, `${path}.${key}`);
    }
    return;
  }

  if (template !== null) {
    assert.equal(
      typeof evidence,
      typeof template,
      `${path} must preserve template value type ${typeof template}.`,
    );
  } else {
    assert.notEqual(evidence, undefined, `${path} is required.`);
  }
}

function assertFiniteNonNegativeNumber(value, label) {
  assert.equal(typeof value, "number", `${label} must be numeric.`);
  assert.equal(Number.isFinite(value), true, `${label} must be finite.`);
  assert.ok(value >= 0, `${label} must be non-negative.`);
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
    assert.equal(evidence.environment?.classification, "production-equivalent");
    assert.equal(evidence.environment?.productionFaultOrValidationApproved, true);
    for (const destination of evidence.dataDestinations ?? []) {
      const applicability = String(destination.applicability ?? "").toUpperCase();
      if (applicability === "NOT_APPLICABLE") continue;
      assert.ok(Array.isArray(destination.regions) && destination.regions.length > 0,
        `Infrastructure destination ${destination.id} requires at least one approved region.`);
      assert.ok(destination.evidenceRef, `Infrastructure destination ${destination.id} requires evidence.`);
    }
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
    assertFiniteNonNegativeNumber(evidence.continuity?.rpoMinutes, "Infrastructure RPO minutes");
    assertFiniteNonNegativeNumber(evidence.continuity?.rtoMinutes, "Infrastructure RTO minutes");
  }

  if (gateId === "LIVE-02-EXTERNAL-PROVIDERS") {
    assert.equal(evidence.environment?.classification, "production-equivalent");
    assert.equal(evidence.environment?.productionValidationApproved, true);
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
    const launchProfiles = (evidence.appProfiles ?? []).filter(
      (profile) => profile.launchEnabled === true,
    );
    assert.ok(launchProfiles.length > 0, "At least one mobile application must be launch-enabled.");

    for (const profile of launchProfiles) {
      assert.equal(profile.apiEnvironment, "production",
        `Mobile profile ${profile.app} must target the production API environment.`);
      for (const platform of ["android", "ios"]) {
        const artifact = (evidence.artifacts ?? []).find(
          (row) => row.app === profile.app && row.platform === platform,
        );
        assert.ok(artifact, `Missing ${platform} release artifact for ${profile.app}.`);
        assert.equal(artifact.signed, true, `${profile.app}/${platform} must be signed.`);
        assert.equal(artifact.productionIdentity, true,
          `${profile.app}/${platform} must use the production identity.`);
        assert.equal(artifact.debugBuild, false,
          `${profile.app}/${platform} must not be a debug build.`);
        assert.equal(artifact.releaseShaEmbedded, true,
          `${profile.app}/${platform} must embed the release SHA.`);
        assert.equal(
          artifact.embeddedSourceSha,
          evidence.release?.sourceSha,
          `${profile.app}/${platform} embedded SHA must match the release candidate.`,
        );

        const device = (evidence.deviceMatrix ?? []).find(
          (row) => row.app === profile.app && row.platform === platform,
        );
        assert.ok(device, `Missing physical-device acceptance for ${profile.app}/${platform}.`);
        assert.ok(
          acceptedWords.has(String(device.status ?? "").toUpperCase()),
          `Physical-device acceptance is not complete for ${profile.app}/${platform}.`,
        );
      }
    }

    for (const control of evidence.controls ?? []) {
      const applicability = String(control.applicability ?? "").toUpperCase();
      if (applicability === "NOT_APPLICABLE") continue;
      assert.ok(
        acceptedWords.has(String(control.status ?? "").toUpperCase()),
        `Mobile control ${control.id} is not accepted.`,
      );
    }

    assert.equal(evidence.localization?.englishReleaseSmoke, true);
    assert.equal(evidence.localization?.arabicRtlReleaseSmoke, true);
    assert.equal(evidence.localization?.textScalingAccepted, true);
    assert.equal(evidence.localization?.screenReaderCriticalActionsAccepted, true);
  }

  if (gateId === "LIVE-04-INDEPENDENT-SECURITY-ASSESSMENT") {
    assert.equal(evidence.assessment?.independenceConfirmed, true);
    assert.equal(evidence.assessment?.manualTestingPerformed, true);
    assert.equal(evidence.assessment?.productionValidationAuthorized, true);
    assert.equal(evidence.findings?.countsKnown, true);

    for (const severity of ["critical", "high", "medium", "low", "informational"]) {
      const count = evidence.findings?.[severity];
      assert.equal(Number.isInteger(count), true, `Security finding count ${severity} must be an integer.`);
      assert.ok(count >= 0, `Security finding count ${severity} must be non-negative.`);
    }

    const unresolvedState = String(
      evidence.findings?.unresolvedCriticalOrHigh ?? "",
    ).toUpperCase();
    assert.ok(
      new Set([
        "NONE",
        "ZERO",
        "RESOLVED",
        "REMEDIATED",
        "CLOSED",
        "ACCEPTED_RISK",
        "FORMALLY_ACCEPTED_RISK",
      ]).has(unresolvedState),
      `Security Critical/High disposition is not acceptable: ${unresolvedState}`,
    );
    if (["ACCEPTED_RISK", "FORMALLY_ACCEPTED_RISK"].includes(unresolvedState)) {
      assert.ok(
        evidence.findings?.acceptedRiskEvidenceRef,
        "Formal risk-acceptance evidence is required for unresolved Critical/High findings.",
      );
    }
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
    assert.equal(
      evidence.schema,
      "carepoint.release-resilience-evidence/v1",
      "LIVE-06 must use the executed resilience evidence schema.",
    );
    assert.ok(
      ["production-equivalent", "production"].includes(evidence.environment?.classification),
      "Resilience evidence must come from a production-equivalent or production environment.",
    );

    for (const scenario of evidence.scenarios ?? []) {
      const applicability = String(scenario.applicability ?? "").toUpperCase();
      const status = String(scenario.status ?? "").toUpperCase();

      if (applicability === "NOT_APPLICABLE") {
        assert.equal(
          status,
          "NOT_APPLICABLE",
          `Resilience scenario ${scenario.id} marked N/A must have NOT_APPLICABLE status.`,
        );
        assert.ok(
          scenario.notApplicableRationaleRef,
          `Resilience scenario ${scenario.id} requires an N/A rationale.`,
        );
        assert.ok(
          scenario.notApplicableApprovalRef,
          `Resilience scenario ${scenario.id} requires N/A approval.`,
        );
        continue;
      }

      assert.equal(
        applicability,
        "APPLICABLE",
        `Resilience scenario ${scenario.id} applicability must be APPLICABLE or NOT_APPLICABLE.`,
      );
      assert.equal(status, "PASS", `Resilience scenario ${scenario.id} must PASS.`);
      assert.ok(
        scenario.startedAt && !Number.isNaN(Date.parse(scenario.startedAt)),
        `Resilience scenario ${scenario.id} startedAt must be ISO-8601.`,
      );
      assert.ok(
        scenario.completedAt && !Number.isNaN(Date.parse(scenario.completedAt)),
        `Resilience scenario ${scenario.id} completedAt must be ISO-8601.`,
      );
      assert.ok(
        Date.parse(scenario.completedAt) >= Date.parse(scenario.startedAt),
        `Resilience scenario ${scenario.id} completedAt cannot precede startedAt.`,
      );
      for (const refKey of [
        "faultExecutionRef",
        "expectedSafeBehaviorRef",
        "actualBehaviorRef",
        "observationsRef",
        "recoveryRef",
      ]) {
        assert.ok(
          scenario[refKey],
          `Resilience scenario ${scenario.id} requires ${refKey}.`,
        );
      }
      assertFiniteNonNegativeNumber(
        scenario.measurements?.recoverySeconds,
        `Resilience scenario ${scenario.id} recoverySeconds`,
      );
      assert.ok(
        scenario.measurements?.metricsRef,
        `Resilience scenario ${scenario.id} requires metrics evidence.`,
      );
      const assertions = scenario.assertions ?? {};
      assert.ok(
        Object.keys(assertions).length > 0,
        `Resilience scenario ${scenario.id} requires explicit safety assertions.`,
      );
      for (const [name, value] of Object.entries(assertions)) {
        assert.equal(
          value,
          true,
          `Resilience scenario ${scenario.id} assertion must be true: ${name}`,
        );
      }
    }

    const continuity = evidence.continuity;
    assert.equal(continuity?.pitrScenarioId, "postgres-pitr-restore");
    for (const key of [
      "incidentDeclaredAt",
      "recoveryPointReferenceAt",
      "recoveredDataThroughAt",
      "acceptedHealthyAt",
    ]) {
      assert.ok(
        continuity?.[key] && !Number.isNaN(Date.parse(continuity[key])),
        `Resilience continuity ${key} must be ISO-8601.`,
      );
    }
    assertFiniteNonNegativeNumber(continuity?.rpoMinutes, "Measured RPO minutes");
    assertFiniteNonNegativeNumber(continuity?.rtoMinutes, "Measured RTO minutes");
    assert.ok(continuity.rpoMinutes <= 15, "Measured RPO exceeds 15 minutes.");
    assert.ok(continuity.rtoMinutes <= 120, "Measured RTO exceeds 120 minutes.");

    assert.equal(
      evidence.observability?.sanitized,
      true,
      "Resilience observability evidence must be sanitized.",
    );
    for (const key of [
      "dashboardRef",
      "alertEvidenceRef",
      "traceCorrelationRef",
      "exporterFailureRef",
    ]) {
      assert.ok(
        evidence.observability?.[key],
        `Resilience observability requires ${key}.`,
      );
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
    assert.equal(evidence.environment?.classification, "production-equivalent");
    assert.equal(evidence.predeploy?.pitrReady, true);
    assert.equal(evidence.predeploy?.configReady, true);
    assert.equal(evidence.deployment?.safetySignalsPass, true);
    assert.equal(evidence.rollback?.executed, true);
    assert.equal(evidence.rollback?.sideEffectsReconciled, true);
    assert.equal(evidence.recovery?.pitrRehearsed, true);
    assert.equal(evidence.approvals?.rehearsalAccepted, true);
    assert.equal(
      evidence.deployment?.runtimeObservedSourceSha,
      evidence.release?.sourceSha,
      "Deployed runtime SHA must match the final release candidate.",
    );
    assert.equal(
      evidence.rollback?.runtimeObservedSourceSha,
      evidence.release?.previous?.sourceSha,
      "Rollback runtime SHA must match the previous approved release.",
    );
    assertFiniteNonNegativeNumber(evidence.recovery?.rpoMinutes, "Deployment rehearsal RPO minutes");
    assertFiniteNonNegativeNumber(evidence.recovery?.rtoMinutes, "Deployment rehearsal RTO minutes");
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

  assertTemplateStructure(evidence, template);
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
