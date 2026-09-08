import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const lockPath = "package-lock.json";
const expectedPath = ".ci/npm-package-lock.canonical.sha256";

const [rawLock, rawExpected] = await Promise.all([
  readFile(lockPath, "utf8"),
  readFile(expectedPath, "utf8"),
]);

const lock = JSON.parse(rawLock);
const canonical = JSON.stringify(sortRecursively(lock));
const actual = createHash("sha256").update(canonical).digest("hex");
const expected = rawExpected.trim().split(/\s+/)[0];

console.log(`Phase C2 canonical package-lock SHA-256: ${actual}`);
if (!/^[a-f0-9]{64}$/.test(expected)) throw new Error(`${expectedPath} does not contain a valid SHA-256 digest.`);
if (actual !== expected) {
  throw new Error(`Canonical npm dependency graph digest mismatch: expected ${expected}, got ${actual}.`);
}
console.log("Phase C2 canonical npm dependency graph verified.");

function sortRecursively(value) {
  if (Array.isArray(value)) return value.map(sortRecursively);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortRecursively(value[key])]),
  );
}
