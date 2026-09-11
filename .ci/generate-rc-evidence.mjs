import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, open, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const FULL_GIT_SHA = /^[0-9a-f]{40}$/i;
const RELEASE_VERSION = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,63}$/;
const EVIDENCE_PURPOSES = new Set(["validation", "candidate"]);

function sha256Buffer(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function readRegularFileSnapshot(absolutePath, displayPath) {
  const handle = await open(absolutePath, "r");
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile()) throw new Error(`${displayPath} is not a regular file.`);
    const content = await handle.readFile();
    return {
      bytes: content.length,
      sha256: sha256Buffer(content),
    };
  } finally {
    await handle.close();
  }
}

async function fileEvidence(repoRoot, relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  const snapshot = await readRegularFileSnapshot(absolutePath, relativePath);
  return {
    path: relativePath.replaceAll(path.sep, "/"),
    ...snapshot,
  };
}

function command(commandName, args) {
  return execFileSync(commandName, args, { encoding: "utf8" }).trim();
}

async function migrationEvidence(repoRoot) {
  const migrationsRoot = path.join(repoRoot, "services/api/prisma/migrations");
  const entries = await readdir(migrationsRoot, { withFileTypes: true });
  const migrations = [];
  for (const entry of entries.filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const relativePath = path.posix.join("services/api/prisma/migrations", entry.name, "migration.sql");
    migrations.push({ name: entry.name, ...(await fileEvidence(repoRoot, relativePath)) });
  }
  if (migrations.length === 0) throw new Error("No Prisma migrations were found for Release Candidate evidence.");
  const aggregateInput = migrations.map((item) => `${item.name}\0${item.sha256}\0${item.bytes}\n`).join("");
  return {
    count: migrations.length,
    aggregateSha256: sha256Buffer(aggregateInput),
    items: migrations,
  };
}

async function mobileLockEvidence(repoRoot) {
  const contractPath = ".ci/flutter-pubspec-locks.sha256";
  const contract = await readFile(path.join(repoRoot, contractPath), "utf8");
  const locks = [];
  for (const rawLine of contract.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = /^([0-9a-f]{64})\s+(.+)$/.exec(line);
    if (!match) throw new Error(`Malformed ${contractPath} line: ${rawLine}`);
    const [, expectedSha256, relativePathRaw] = match;
    const relativePath = relativePathRaw.replace(/^\*/, "").trim();
    const evidence = await fileEvidence(repoRoot, relativePath);
    if (evidence.sha256 !== expectedSha256.toLowerCase()) {
      throw new Error(`${relativePath} does not match the canonical Flutter lock digest.`);
    }
    locks.push({ ...evidence, expectedSha256: expectedSha256.toLowerCase() });
  }
  if (locks.length === 0) throw new Error(`${contractPath} does not declare any mobile dependency lock.`);
  return {
    contract: await fileEvidence(repoRoot, contractPath),
    locks,
  };
}

async function artifactEvidence(outputDir, fileName) {
  const absolutePath = path.join(outputDir, fileName);
  const snapshot = await readRegularFileSnapshot(absolutePath, fileName);
  return {
    file: fileName,
    ...snapshot,
  };
}

const repoRoot = process.cwd();
const outputDir = path.resolve(repoRoot, process.argv[2] || "rc-evidence");
await mkdir(outputDir, { recursive: true });

const version = (process.env.CAREPOINT_RELEASE_VERSION || "").trim();
if (!RELEASE_VERSION.test(version)) {
  throw new Error("CAREPOINT_RELEASE_VERSION must be present and use only letters, digits, dot, underscore, plus or hyphen (max 64 characters).");
}

const requestedSha = (process.env.CAREPOINT_RELEASE_SHA || "").trim().toLowerCase();
if (!FULL_GIT_SHA.test(requestedSha)) {
  throw new Error("CAREPOINT_RELEASE_SHA must be the exact full 40-hex Git SHA used to build the evidence package.");
}
const gitSha = command("git", ["rev-parse", "HEAD"]).toLowerCase();
if (gitSha !== requestedSha) {
  throw new Error(`Release SHA mismatch: checkout is ${gitSha}, requested evidence SHA is ${requestedSha}.`);
}

const purpose = (process.env.CAREPOINT_RELEASE_EVIDENCE_PURPOSE || "validation").trim();
if (!EVIDENCE_PURPOSES.has(purpose)) throw new Error("CAREPOINT_RELEASE_EVIDENCE_PURPOSE must be validation or candidate.");

const sourceFiles = [
  "package.json",
  "package-lock.json",
  ".ci/npm-package-lock.canonical.sha256",
  ".ci/verify-npm-lock.mjs",
  ".ci/flutter-pubspec-locks.sha256",
  ".ci/verify-container-supply-chain.mjs",
  ".ci/generate-release-change-inventory.mjs",
  "Dockerfile",
  ".dockerignore",
  "services/api/package.json",
  "services/api/.env.example",
  "apps/admin/package.json",
  "apps/admin/next.config.ts",
  ".github/workflows/ci.yml",
  ".github/workflows/security-analysis.yml",
  ".github/workflows/postgres-recovery.yml",
  ".github/workflows/slice10-fhir.yml",
  ".github/workflows/release-candidate-evidence.yml",
  ".github/workflows/release1-container-compatibility.yml",
];

const sourceContracts = [];
for (const relativePath of sourceFiles) sourceContracts.push(await fileEvidence(repoRoot, relativePath));

const packageLock = sourceContracts.find((item) => item.path === "package-lock.json");
const canonicalNpmContract = sourceContracts.find((item) => item.path === ".ci/npm-package-lock.canonical.sha256");
const canonicalNpmVerifier = sourceContracts.find((item) => item.path === ".ci/verify-npm-lock.mjs");
if (!packageLock || !canonicalNpmContract || !canonicalNpmVerifier) {
  throw new Error("Required npm lock evidence files are missing from the Release Candidate source contracts.");
}

// Reuse the repository's canonical Phase C2 verifier instead of interpreting its
// normalized digest as a raw package-lock.json byte hash. The raw lock SHA is
// fingerprinted separately in the manifest for artifact correlation.
const canonicalVerificationOutput = command(process.execPath, [".ci/verify-npm-lock.mjs"]);
if (!canonicalVerificationOutput.includes("committed canonical npm dependency graph verified")) {
  throw new Error("Canonical npm dependency verification did not report a successful Phase C2 result.");
}

const artifacts = [];
for (const fileName of [
  "api-build-snapshot.tar.gz",
  "admin-build-snapshot.tar.gz",
  "node-sbom.cdx.json",
  "mobile-core-deps.json",
  "patient-mobile-deps.json",
  "doctor-mobile-deps.json",
  "provider-mobile-deps.json",
  "flutter-version.txt",
]) {
  artifacts.push(await artifactEvidence(outputDir, fileName));
}

const changeInventoryPath = path.join(outputDir, "release-change-inventory.json");
const changeInventory = JSON.parse(await readFile(changeInventoryPath, "utf8"));
if (changeInventory.schema !== "carepoint.release-change-inventory/v1") {
  throw new Error("Release change inventory has an unsupported schema.");
}
if (changeInventory.candidateSha !== gitSha || changeInventory.releaseVersion !== version) {
  throw new Error("Release change inventory does not match the exact Release Candidate SHA/version.");
}
if (!FULL_GIT_SHA.test(String(changeInventory.baseSha || ""))) {
  throw new Error("Release change inventory is missing a valid base SHA.");
}
if (changeInventory.evidenceBoundaries?.sourceChangeEvidenceOnly !== true
    || changeInventory.evidenceBoundaries?.containsRawDiffHunks !== false
    || changeInventory.evidenceBoundaries?.containsCommitMessages !== false
    || changeInventory.evidenceBoundaries?.containsConfigurationValues !== false) {
  throw new Error("Release change inventory evidence boundaries are not fail-closed.");
}

const changeEvidence = {
  baseSha: changeInventory.baseSha,
  inventory: await artifactEvidence(outputDir, "release-change-inventory.json"),
  generatedReleaseNotes: await artifactEvidence(outputDir, "release-notes.generated.md"),
};

const manifest = {
  schema: "carepoint.release-candidate-evidence/v1",
  purpose,
  release: {
    version,
    sourceSha: gitSha,
    sourceRef: process.env.CAREPOINT_RELEASE_SOURCE_REF?.trim() || null,
    buildId: process.env.CAREPOINT_RELEASE_BUILD_ID?.trim() || null,
  },
  repository: {
    slug: process.env.GITHUB_REPOSITORY?.trim() || null,
    workflowRunId: process.env.GITHUB_RUN_ID?.trim() || null,
    workflowRunAttempt: process.env.GITHUB_RUN_ATTEMPT?.trim() || null,
  },
  toolchain: {
    node: process.version,
    npm: command("npm", ["--version"]),
  },
  dependencyEvidence: {
    npmPackageLock: packageLock,
    npmCanonicalVerification: {
      verified: true,
      performedBy: canonicalNpmVerifier.path,
      verifier: canonicalNpmVerifier,
      canonicalContract: canonicalNpmContract,
      verifierOutputSha256: sha256Buffer(canonicalVerificationOutput),
      note: "Phase C2 canonicalization is verified by the repository verifier; package-lock.json raw bytes are fingerprinted independently.",
    },
    mobile: await mobileLockEvidence(repoRoot),
  },
  migrationEvidence: await migrationEvidence(repoRoot),
  changeEvidence,
  sourceContracts,
  buildEvidence: artifacts,
  releaseBoundaries: {
    evidenceBundleIsProductionDeploymentArtifact: false,
    changeInventoryIsSourceEvidenceOnly: true,
    containerCompatibilityIsSourceSideEvidenceOnly: true,
    finalApiAdminArtifactDigestStillRequired: true,
    finalContainerRegistryProvenanceStillRequired: true,
    signedNativeArtifactsStillRequired: true,
    productionEnvironmentAcceptanceIssue: 79,
    mobileNativeReleaseIssue: 81,
    promotionProtectionIssue: 84,
    immutableArtifactIssue: 97,
    deploymentRollbackIssue: 98,
  },
};

const manifestPath = path.join(outputDir, "rc-manifest.json");
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
const manifestDigest = await artifactEvidence(outputDir, "rc-manifest.json");

const checksumEntries = [
  ...artifacts,
  changeEvidence.inventory,
  changeEvidence.generatedReleaseNotes,
  manifestDigest,
]
  .sort((a, b) => a.file.localeCompare(b.file))
  .map((item) => `${item.sha256}  ${item.file}`)
  .join("\n");
await writeFile(path.join(outputDir, "SHA256SUMS"), `${checksumEntries}\n`, "utf8");

console.log(JSON.stringify({
  version,
  baseSha: changeInventory.baseSha,
  sourceSha: gitSha,
  purpose,
  manifestSha256: manifestDigest.sha256,
  artifactCount: artifacts.length + 3,
}));