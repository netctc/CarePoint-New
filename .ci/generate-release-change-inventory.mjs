import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const FULL_GIT_SHA = /^[0-9a-f]{40}$/i;
const RELEASE_VERSION = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,63}$/;
const CONFIG_EXAMPLE = /(^|\/)\.env(?:\.[^/]+)?\.example$/;
const DEPENDENCY_FILE = /(^|\/)(?:package(?:-lock)?\.json|pubspec\.(?:yaml|lock)|\.nvmrc)$/;

function fail(message) {
  throw new Error(message);
}

function command(name, args, options = {}) {
  return execFileSync(name, args, {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    ...options,
  }).trim();
}

export function assertFullSha(value, label) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!FULL_GIT_SHA.test(normalized)) fail(`${label} must be a full 40-hex Git SHA.`);
  return normalized;
}

export function assertReleaseVersion(value) {
  const normalized = String(value ?? "").trim();
  if (!RELEASE_VERSION.test(normalized)) {
    fail("Release version must use only letters, digits, dot, underscore, plus or hyphen (max 64 characters).");
  }
  return normalized;
}

export function categoriesForPath(relativePath) {
  const categories = new Set();
  if (relativePath.startsWith("services/api/prisma/migrations/")) categories.add("databaseMigrations");
  if (relativePath.startsWith("services/api/")) categories.add("api");
  if (relativePath.startsWith("apps/admin/")) categories.add("admin");
  if (
    relativePath.startsWith("apps/patient-mobile/")
    || relativePath.startsWith("apps/doctor-mobile/")
    || relativePath.startsWith("apps/provider-mobile/")
    || relativePath.startsWith("packages/mobile_core/")
  ) categories.add("mobile");
  if (relativePath.startsWith("packages/") && !relativePath.startsWith("packages/mobile_core/")) categories.add("sharedPackages");
  if (relativePath.startsWith(".github/workflows/") || relativePath.startsWith(".ci/")) categories.add("releaseCi");
  if (relativePath === "Dockerfile" || relativePath === ".dockerignore") categories.add("packaging");
  if (relativePath.startsWith("ops/") || relativePath.startsWith("docs/release-")) categories.add("operations");
  if (relativePath.startsWith("docs/") || relativePath === "README.md") categories.add("documentation");
  if (DEPENDENCY_FILE.test(relativePath)) categories.add("dependencies");
  if (categories.size === 0) categories.add("other");
  return [...categories].sort();
}

export function parseConfigKeyDiff(diffText) {
  const added = new Set();
  const removed = new Set();
  for (const line of String(diffText).split(/\r?\n/)) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    const match = /^([+-])([A-Z][A-Z0-9_]*)\s*=/.exec(line);
    if (!match) continue;
    const [, direction, key] = match;
    if (direction === "+") added.add(key);
    else removed.add(key);
  }
  return {
    added: [...added].sort(),
    removed: [...removed].sort(),
  };
}

function gitObjectExists(sha, cwd) {
  const result = spawnSync("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd, encoding: "utf8" });
  return result.status === 0;
}

function isAncestor(baseSha, candidateSha, cwd) {
  const result = spawnSync("git", ["merge-base", "--is-ancestor", baseSha, candidateSha], { cwd, encoding: "utf8" });
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  fail(`Unable to verify Git ancestry: ${result.stderr?.trim() || "git merge-base failed"}`);
}

export function assertReleaseRange(baseSha, candidateSha, cwd = process.cwd()) {
  if (!gitObjectExists(baseSha, cwd)) fail(`Release base SHA is not available as a commit: ${baseSha}`);
  if (!gitObjectExists(candidateSha, cwd)) fail(`Release candidate SHA is not available as a commit: ${candidateSha}`);
  if (baseSha === candidateSha) fail("Release base SHA and candidate SHA must differ.");
  if (!isAncestor(baseSha, candidateSha, cwd)) {
    fail("Release base SHA must be an ancestor of the candidate SHA.");
  }
}

function changedPaths(baseSha, candidateSha, cwd) {
  const output = execFileSync(
    "git",
    ["diff", "--name-only", "-z", baseSha, candidateSha, "--"],
    { cwd, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
  );
  return output.split("\0").filter(Boolean).sort();
}

function changedConfigKeys(baseSha, candidateSha, paths, cwd) {
  const byFile = [];
  const added = new Set();
  const removed = new Set();

  for (const relativePath of paths.filter((item) => CONFIG_EXAMPLE.test(item))) {
    const diff = command("git", ["diff", "--unified=0", "--no-color", baseSha, candidateSha, "--", relativePath], { cwd });
    const keys = parseConfigKeyDiff(diff);
    for (const key of keys.added) added.add(key);
    for (const key of keys.removed) removed.add(key);
    byFile.push({ path: relativePath, added: keys.added, removed: keys.removed });
  }

  return {
    added: [...added].sort(),
    removed: [...removed].sort(),
    byFile,
  };
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function markdownList(values, emptyText = "None") {
  if (values.length === 0) return `- ${emptyText}`;
  return values.map((value) => `- \`${value}\``).join("\n");
}

function buildInventory({ baseSha, candidateSha, version, cwd }) {
  const paths = changedPaths(baseSha, candidateSha, cwd);
  const byCategory = {
    admin: [],
    api: [],
    databaseMigrations: [],
    dependencies: [],
    documentation: [],
    mobile: [],
    operations: [],
    packaging: [],
    releaseCi: [],
    sharedPackages: [],
    other: [],
  };

  for (const relativePath of paths) {
    for (const category of categoriesForPath(relativePath)) byCategory[category].push(relativePath);
  }
  for (const category of Object.keys(byCategory)) byCategory[category] = uniqueSorted(byCategory[category]);

  const apiModules = uniqueSorted(
    paths
      .map((relativePath) => /^services\/api\/src\/modules\/([^/]+)\//.exec(relativePath)?.[1] ?? null)
      .filter(Boolean),
  );
  const workflows = uniqueSorted(paths.filter((relativePath) => relativePath.startsWith(".github/workflows/")));
  const migrations = uniqueSorted(paths.filter((relativePath) => relativePath.startsWith("services/api/prisma/migrations/")));
  const dependencyFiles = uniqueSorted(paths.filter((relativePath) => DEPENDENCY_FILE.test(relativePath)));
  const configurationKeys = changedConfigKeys(baseSha, candidateSha, paths, cwd);
  const candidateCommitTime = command("git", ["show", "-s", "--format=%cI", candidateSha], { cwd });

  return {
    schema: "carepoint.release-change-inventory/v1",
    releaseVersion: version,
    baseSha,
    candidateSha,
    candidateCommitTime,
    changedFileCount: paths.length,
    changedPaths: paths.map((relativePath) => ({ path: relativePath, categories: categoriesForPath(relativePath) })),
    byCategory,
    apiModules,
    databaseMigrations: migrations,
    workflows,
    dependencyFiles,
    configurationKeys,
    evidenceBoundaries: {
      containsRawDiffHunks: false,
      containsCommitMessages: false,
      containsConfigurationValues: false,
      sourceChangeEvidenceOnly: true,
      productionImpactRequiresReview: true,
    },
  };
}

function renderReleaseNotes(inventory) {
  const categoryLines = Object.entries(inventory.byCategory)
    .map(([category, paths]) => `| ${category} | ${paths.length} |`)
    .join("\n");

  return [
    "# CarePoint Release Change Inventory",
    "",
    `**Release version:** \`${inventory.releaseVersion}\`  `,
    `**Base SHA:** \`${inventory.baseSha}\`  `,
    `**Candidate SHA:** \`${inventory.candidateSha}\`  `,
    `**Changed files:** ${inventory.changedFileCount}`,
    "",
    "This document is generated source-change evidence. It does not infer production impact, UAT acceptance, regulatory approval or deployment readiness.",
    "",
    "## Change categories",
    "",
    "| Category | Changed paths |",
    "|---|---:|",
    categoryLines,
    "",
    "## API modules changed",
    "",
    markdownList(inventory.apiModules),
    "",
    "## Database migrations changed",
    "",
    markdownList(inventory.databaseMigrations),
    "",
    "## Configuration contract keys added",
    "",
    markdownList(inventory.configurationKeys.added),
    "",
    "## Configuration contract keys removed",
    "",
    markdownList(inventory.configurationKeys.removed),
    "",
    "## CI / release workflows changed",
    "",
    markdownList(inventory.workflows),
    "",
    "## Dependency manifests / locks changed",
    "",
    markdownList(inventory.dependencyFiles),
    "",
    "## Packaging changes",
    "",
    markdownList(inventory.byCategory.packaging),
    "",
    "## Operations / release documentation changes",
    "",
    markdownList(uniqueSorted([...inventory.byCategory.operations, ...inventory.byCategory.documentation])),
    "",
    "## Evidence boundaries",
    "",
    "- Raw diff hunks are not copied into this evidence.",
    "- Commit messages are not copied into this evidence.",
    "- Configuration values are never copied; only approved example-file key names may be listed.",
    "- Production impact and release acceptance require the owning R3–R10 gates and authorized reviewers.",
    "",
  ].join("\n");
}

async function selfTest() {
  const validSha = "a".repeat(40);
  if (assertFullSha(validSha, "test") !== validSha) fail("SHA normalization self-test failed.");
  let invalidShaRejected = false;
  try { assertFullSha("abc", "test"); } catch { invalidShaRejected = true; }
  if (!invalidShaRejected) fail("Invalid SHA self-test failed.");

  const categories = categoriesForPath("services/api/prisma/migrations/20260101000000_example/migration.sql");
  if (!categories.includes("api") || !categories.includes("databaseMigrations")) fail("Migration classification self-test failed.");
  if (!categoriesForPath("Dockerfile").includes("packaging")) fail("Packaging classification self-test failed.");
  if (!categoriesForPath("apps/patient-mobile/pubspec.lock").includes("dependencies")) fail("Dependency classification self-test failed.");

  const keys = parseConfigKeyDiff([
    "--- a/services/api/.env.example",
    "+++ b/services/api/.env.example",
    "-OLD_ENDPOINT=https://old.invalid",
    "+NEW_ENDPOINT=https://new.invalid",
    "+NOT_A_VALUE_TO_EMIT=super-secret-example",
  ].join("\n"));
  if (keys.added.join(",") !== "NEW_ENDPOINT,NOT_A_VALUE_TO_EMIT" || keys.removed.join(",") !== "OLD_ENDPOINT") {
    fail("Configuration key extraction self-test failed.");
  }

  const temp = await mkdtemp(path.join(os.tmpdir(), "carepoint-release-inventory-"));
  try {
    command("git", ["init", "-q"], { cwd: temp });
    command("git", ["config", "user.name", "CarePoint CI"], { cwd: temp });
    command("git", ["config", "user.email", "ci@example.invalid"], { cwd: temp });
    await writeFile(path.join(temp, "fixture.txt"), "one\n", "utf8");
    command("git", ["add", "fixture.txt"], { cwd: temp });
    command("git", ["commit", "-q", "-m", "base"], { cwd: temp });
    const base = command("git", ["rev-parse", "HEAD"], { cwd: temp });
    await writeFile(path.join(temp, "fixture.txt"), "two\n", "utf8");
    command("git", ["commit", "-q", "-am", "candidate"], { cwd: temp });
    const candidate = command("git", ["rev-parse", "HEAD"], { cwd: temp });
    assertReleaseRange(base, candidate, temp);
    let reverseRejected = false;
    try { assertReleaseRange(candidate, base, temp); } catch { reverseRejected = true; }
    if (!reverseRejected) fail("Non-ancestor release base self-test failed.");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }

  console.log("release change inventory self-test passed");
}

if (process.argv.includes("--self-test")) {
  await selfTest();
} else {
  const cwd = process.cwd();
  const outputDir = path.resolve(cwd, process.argv[2] || "rc-evidence");
  const baseSha = assertFullSha(process.env.CAREPOINT_RELEASE_BASE_SHA, "CAREPOINT_RELEASE_BASE_SHA");
  const candidateSha = assertFullSha(process.env.CAREPOINT_RELEASE_SHA, "CAREPOINT_RELEASE_SHA");
  const version = assertReleaseVersion(process.env.CAREPOINT_RELEASE_VERSION);
  const headSha = assertFullSha(command("git", ["rev-parse", "HEAD"], { cwd }), "checked-out HEAD");
  if (headSha !== candidateSha) fail(`Candidate SHA mismatch: checkout is ${headSha}, requested candidate is ${candidateSha}.`);
  assertReleaseRange(baseSha, candidateSha, cwd);

  const inventory = buildInventory({ baseSha, candidateSha, version, cwd });
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, "release-change-inventory.json"), `${JSON.stringify(inventory, null, 2)}\n`, "utf8");
  await writeFile(path.join(outputDir, "release-notes.generated.md"), renderReleaseNotes(inventory), "utf8");

  // Re-read the JSON to prove the emitted file is valid and still carries the exact range.
  const written = JSON.parse(await readFile(path.join(outputDir, "release-change-inventory.json"), "utf8"));
  if (written.baseSha !== baseSha || written.candidateSha !== candidateSha || written.schema !== "carepoint.release-change-inventory/v1") {
    fail("Generated release change inventory failed exact-range verification.");
  }

  console.log(JSON.stringify({
    schema: inventory.schema,
    baseSha,
    candidateSha,
    changedFileCount: inventory.changedFileCount,
    apiModuleCount: inventory.apiModules.length,
    migrationPathCount: inventory.databaseMigrations.length,
    configKeysAdded: inventory.configurationKeys.added.length,
    configKeysRemoved: inventory.configurationKeys.removed.length,
  }));
}
