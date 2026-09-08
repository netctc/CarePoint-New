import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const lockPath = "package-lock.json";
const expectedPath = ".ci/npm-package-lock.canonical.sha256";

const [rawLock, rawExpected] = await Promise.all([
  readFile(lockPath, "utf8"),
  readFile(expectedPath, "utf8"),
]);

assertCommittedLockUnchanged();

const lock = JSON.parse(rawLock);
const canonicalDigest = sha256(JSON.stringify(sortRecursively(lock)));
const artifactGraph = Object.entries(lock.packages ?? {})
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([path, metadata]) => ({
    path,
    version: metadata?.version ?? null,
    resolved: metadata?.resolved ?? null,
    integrity: metadata?.integrity ?? null,
    link: metadata?.link ?? null,
  }));
const artifactDigest = sha256(JSON.stringify(artifactGraph));
const pathVersionDigest = sha256(JSON.stringify(artifactGraph.map(({ path, version }) => [path, version])));
const expected = rawExpected.trim().split(/\s+/)[0];

console.log(`Phase C2 package count: ${artifactGraph.length}`);
console.log(`Phase C2 canonical package-lock SHA-256: ${canonicalDigest}`);
console.log(`Phase C2 artifact graph SHA-256: ${artifactDigest}`);
console.log(`Phase C2 path/version SHA-256: ${pathVersionDigest}`);
if (!/^[a-f0-9]{64}$/.test(expected)) throw new Error(`${expectedPath} does not contain a valid SHA-256 digest.`);
if (canonicalDigest !== expected) {
  throw new Error(`Canonical npm dependency graph digest mismatch: expected ${expected}, got ${canonicalDigest}.`);
}
console.log("Phase C2 committed canonical npm dependency graph verified.");

function assertCommittedLockUnchanged() {
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", lockPath], { stdio: "ignore" });
  } catch {
    throw new Error(`${lockPath} must be versioned in git before dependency installation.`);
  }
  try {
    execFileSync("git", ["diff", "--quiet", "--", lockPath], { stdio: "ignore" });
  } catch {
    throw new Error(`${lockPath} changed during dependency resolution. Review and commit the dependency drift before installation.`);
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sortRecursively(value) {
  if (Array.isArray(value)) return value.map(sortRecursively);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortRecursively(value[key])]),
  );
}
