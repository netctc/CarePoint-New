import { readFile } from "node:fs/promises";
import process from "node:process";

const COMMIT_PIN = /@[0-9a-f]{40}(?:\s|#|$)/i;
const IMAGE_DIGEST = /@sha256:[0-9a-f]{64}(?:\s|$)/i;

function fail(message) {
  throw new Error(message);
}

export function assertDockerfileSupplyChain(content) {
  const lines = content.split(/\r?\n/);
  const fromLines = lines
    .map((line) => line.trim())
    .filter((line) => /^FROM\s+/i.test(line));

  if (fromLines.length === 0) fail("Dockerfile has no FROM stages.");
  for (const line of fromLines) {
    if (!IMAGE_DIGEST.test(line)) {
      fail(`Every Dockerfile FROM stage must pin an immutable sha256 digest: ${line}`);
    }
  }

  const syntaxLine = lines.find((line) => /^#\s*syntax=/i.test(line.trim()));
  if (syntaxLine && !/@sha256:[0-9a-f]{64}/i.test(syntaxLine)) {
    fail("Dockerfile syntax frontend must be omitted or pinned by immutable sha256 digest.");
  }
}

export function assertWorkflowSupplyChain(content) {
  const usesLines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^uses:\s*/.test(line));

  if (usesLines.length === 0) fail("Container compatibility workflow has no uses: actions.");
  for (const line of usesLines) {
    if (!COMMIT_PIN.test(line)) {
      fail(`Every third-party GitHub Action must be pinned to a full commit SHA: ${line}`);
    }
  }

  const requiredFragments = [
    "CAREPOINT_CONTAINER_SOURCE_SHA:",
    "ref: ${{ env.CAREPOINT_CONTAINER_SOURCE_SHA }}",
    "id: build",
    "push: false",
    "provenance: false",
    "steps.build.outputs.imageid",
    '"published": false',
    '"productionDeploymentEvidence": false',
  ];

  for (const fragment of requiredFragments) {
    if (!content.includes(fragment)) fail(`Container compatibility workflow is missing required control: ${fragment}`);
  }
}

function expectFailure(fn, label) {
  let failed = false;
  try {
    fn();
  } catch {
    failed = true;
  }
  if (!failed) fail(`Self-test expected failure did not occur: ${label}`);
}

function selfTest() {
  assertDockerfileSupplyChain("FROM node:22@sha256:" + "a".repeat(64) + " AS build\n");
  expectFailure(() => assertDockerfileSupplyChain("FROM node:22-bookworm-slim AS build\n"), "mutable base image");
  expectFailure(() => assertDockerfileSupplyChain("# syntax=docker/dockerfile:1.7\nFROM node:22@sha256:" + "a".repeat(64) + "\n"), "mutable Dockerfile frontend");

  const validWorkflow = [
    "env:",
    "  CAREPOINT_CONTAINER_SOURCE_SHA: ${{ github.sha }}",
    "steps:",
    "  - uses: actions/checkout@" + "b".repeat(40) + " # v4",
    "    with:",
    "      ref: ${{ env.CAREPOINT_CONTAINER_SOURCE_SHA }}",
    "  - id: build",
    "    uses: docker/build-push-action@" + "c".repeat(40) + " # v6",
    "    with:",
    "      push: false",
    "      provenance: false",
    "  - run: echo ${{ steps.build.outputs.imageid }}",
    "  - run: |",
    "      echo '\"published\": false'",
    "      echo '\"productionDeploymentEvidence\": false'",
  ].join("\n");
  assertWorkflowSupplyChain(validWorkflow);
  expectFailure(() => assertWorkflowSupplyChain(validWorkflow.replace("actions/checkout@" + "b".repeat(40), "actions/checkout@v4")), "mutable action tag");
  expectFailure(() => assertWorkflowSupplyChain(validWorkflow.replace("ref: ${{ env.CAREPOINT_CONTAINER_SOURCE_SHA }}", "ref: ${{ github.ref }}")), "non-exact checkout ref");

  console.log("container supply-chain contract self-test passed");
}

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  const [dockerfile, workflow] = await Promise.all([
    readFile("Dockerfile", "utf8"),
    readFile(".github/workflows/release1-container-compatibility.yml", "utf8"),
  ]);
  assertDockerfileSupplyChain(dockerfile);
  assertWorkflowSupplyChain(workflow);
  console.log("container supply-chain contract verified");
}
