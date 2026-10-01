import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const FULL_GIT_SHA = /^[0-9a-f]{40}$/i;
const RELEASE_VERSION = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,63}$/;
const CONTRACT_PATH = "ops/release-1/final-go-live-gate-readiness-phase31.json";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function command(name, args) {
  return execFileSync(name, args, { encoding: "utf8" }).trim();
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function hasAcceptedApproval(value) {
  if (Array.isArray(value)) return value.some(hasAcceptedApproval);
  if (!value || typeof value !== "object") return false;
  for (const [key, child] of Object.entries(value)) {
    if (/approved|accepted|signoff|signOff/i.test(key) && child === true) return true;
    if (/decision|status/i.test(key) && typeof child === "string"
        && /^(APPROVED|ACCEPTED|PASS|PASSED|GO|READY|COMPLETE|COMPLETED)$/i.test(child)) {
      return true;
    }
    if (hasAcceptedApproval(child)) return true;
  }
  return false;
}

export function assertFailClosedEvidence(template, label) {
  if (!template || typeof template !== "object" || Array.isArray(template)) {
    throw new Error(label + " must be an evidence object.");
  }
  if ("approved" in template && template.approved !== false) {
    throw new Error(label + " must remain approved=false.");
  }
  if ("productionAcceptance" in template && template.productionAcceptance === true) {
    throw new Error(label + " must not declare productionAcceptance=true.");
  }
  if (typeof template.overallStatus === "string"
      && /^(APPROVED|ACCEPTED|PASS|PASSED|GO|READY|COMPLETE|COMPLETED)$/i.test(template.overallStatus)) {
    throw new Error(label + " overallStatus must remain fail-closed.");
  }
  if (typeof template.finalDecision === "string"
      && /^(APPROVED|ACCEPTED|PASS|PASSED|GO|READY|COMPLETE|COMPLETED)$/i.test(template.finalDecision)) {
    throw new Error(label + " finalDecision must remain fail-closed.");
  }
  if ("acceptedAt" in template && template.acceptedAt !== null) {
    throw new Error(label + " acceptedAt must remain null.");
  }
  if (hasAcceptedApproval(template.approvals)) {
    throw new Error(label + " must not contain accepted/approved sign-offs.");
  }
  return template;
}

export function bindCandidate(template, sourceSha, releaseVersion) {
  const result = deepClone(template);
  let releaseBindingApplied = false;

  if (result.release && typeof result.release === "object" && !Array.isArray(result.release)) {
    if ("sourceSha" in result.release) {
      result.release.sourceSha = sourceSha;
      releaseBindingApplied = true;
    }
    if ("releaseVersion" in result.release) {
      result.release.releaseVersion = releaseVersion;
      releaseBindingApplied = true;
    } else if ("version" in result.release) {
      result.release.version = releaseVersion;
      releaseBindingApplied = true;
    }
  }

  return { evidence: result, releaseBindingApplied };
}

function safeFileName(gateId) {
  return gateId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + ".json";
}

function selfTest() {
  const original = {
    schema: "example/v1",
    approved: false,
    overallStatus: "DRAFT",
    release: {
      sourceSha: "REPLACE",
      releaseVersion: "REPLACE",
    },
    approvals: [{ role: "Security", decision: "PENDING" }],
    acceptedAt: null,
  };
  assertFailClosedEvidence(original, "self-test");
  const { evidence, releaseBindingApplied } = bindCandidate(
    original,
    "0123456789abcdef0123456789abcdef01234567",
    "2026.10.01-rc1",
  );
  if (!releaseBindingApplied) throw new Error("self-test release binding was not applied.");
  if (evidence.release.sourceSha !== "0123456789abcdef0123456789abcdef01234567") {
    throw new Error("self-test source SHA binding failed.");
  }
  if (evidence.release.releaseVersion !== "2026.10.01-rc1") {
    throw new Error("self-test version binding failed.");
  }
  if (original.release.sourceSha !== "REPLACE") {
    throw new Error("self-test mutated the source template.");
  }
  assertFailClosedEvidence(evidence, "bound self-test");
  try {
    assertFailClosedEvidence({ ...original, approved: true }, "unsafe self-test");
    throw new Error("approved=true self-test was not rejected.");
  } catch (error) {
    if (!String(error).includes("approved=false")) throw error;
  }
  try {
    assertFailClosedEvidence(
      { ...original, approvals: [{ role: "Security", decision: "APPROVED" }] },
      "unsafe approval self-test",
    );
    throw new Error("approved sign-off self-test was not rejected.");
  } catch (error) {
    if (!String(error).includes("sign-offs")) throw error;
  }
  console.log("Final Go-Live evidence skeleton generator self-test passed");
}

async function generate(outputDirArg) {
  const repoRoot = process.cwd();
  const sourceSha = (process.env.CAREPOINT_RELEASE_SHA || "").trim().toLowerCase();
  const releaseVersion = (process.env.CAREPOINT_RELEASE_VERSION || "").trim();

  if (!FULL_GIT_SHA.test(sourceSha)) {
    throw new Error("CAREPOINT_RELEASE_SHA must be the exact full 40-hex candidate SHA.");
  }
  if (!RELEASE_VERSION.test(releaseVersion)) {
    throw new Error("CAREPOINT_RELEASE_VERSION must be a bounded release identifier.");
  }
  const checkoutSha = command("git", ["rev-parse", "HEAD"]).toLowerCase();
  if (checkoutSha !== sourceSha) {
    throw new Error("Release SHA mismatch: checkout is " + checkoutSha + ", requested " + sourceSha + ".");
  }

  const contract = JSON.parse(await readFile(path.join(repoRoot, CONTRACT_PATH), "utf8"));
  if (contract.productionAcceptance !== false || contract.mainMergeAllowed !== false) {
    throw new Error("Phase 31 contract must remain fail-closed before generating skeletons.");
  }
  if (!Array.isArray(contract.gates) || contract.gates.length !== 8) {
    throw new Error("Phase 31 contract must declare exactly eight external evidence gates.");
  }

  const outputDir = path.resolve(repoRoot, outputDirArg || "release-live-evidence-skeleton");
  await mkdir(outputDir, { recursive: true, mode: 0o700 });

  const items = [];
  for (const gate of contract.gates) {
    if (gate.externalEvidenceRequired !== true
        || gate.automatedContractIsSufficient !== false
        || gate.autoClosable !== false) {
      throw new Error("Gate " + gate.id + " is not fail-closed.");
    }

    const templatePath = path.join(repoRoot, gate.evidenceTemplate);
    const template = JSON.parse(await readFile(templatePath, "utf8"));
    assertFailClosedEvidence(template, gate.id + " template");

    const { evidence, releaseBindingApplied } = bindCandidate(
      template,
      sourceSha,
      releaseVersion,
    );
    assertFailClosedEvidence(evidence, gate.id + " generated skeleton");

    const file = safeFileName(gate.id);
    const content = JSON.stringify(evidence, null, 2) + "\n";
    await writeFile(path.join(outputDir, file), content, { mode: 0o600 });

    items.push({
      gateId: gate.id,
      automatedWorkflow: gate.automatedWorkflow,
      sourceTemplate: gate.evidenceTemplate,
      file,
      sha256: sha256(content),
      releaseBindingApplied,
      externalEvidenceRequired: true,
      automatedContractIsSufficient: false,
      autoClosable: false,
    });
  }

  const manifest = {
    schema: "carepoint.final-go-live-evidence-skeleton-bundle/v1",
    release: {
      sourceSha,
      releaseVersion,
    },
    generatedFrom: {
      readinessContract: CONTRACT_PATH,
      gateCount: items.length,
    },
    productionAcceptance: false,
    approvalsApplied: false,
    externalEvidenceCompleted: false,
    restrictedEvidenceIncluded: false,
    items,
    boundaries: {
      skeletonOnly: true,
      placeholdersRemainExpected: true,
      automatedGreenDoesNotEqualLiveAcceptance: true,
      noGateAutoClosed: true,
      rawRestrictedReportsIncluded: false,
      secretsIncluded: false,
    },
  };
  const manifestContent = JSON.stringify(manifest, null, 2) + "\n";
  await writeFile(
    path.join(outputDir, "go-live-evidence-skeleton-manifest.json"),
    manifestContent,
    { mode: 0o600 },
  );

  console.log(JSON.stringify({
    sourceSha,
    releaseVersion,
    gateCount: items.length,
    manifestSha256: sha256(manifestContent),
    productionAcceptance: false,
    externalEvidenceCompleted: false,
  }));
}

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--self-test") {
  selfTest();
} else if (args.length >= 1 && args[0] === "--generate" && args.length <= 2) {
  await generate(args[1]);
} else {
  throw new Error(
    "Usage: node .ci/generate-final-go-live-evidence-skeleton.mjs --self-test | --generate [output-dir]",
  );
}
