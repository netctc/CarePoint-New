import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const scannerPath = path.join(repoRoot, ".ci", "repository-security-scan.mjs");
const workflowPath = path.join(repoRoot, ".github", "workflows", "security-analysis.yml");

function runScanner(args) {
  const result = spawnSync(process.execPath, [scannerPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env },
  });
  if (result.status !== 0) {
    throw new Error(`C10 repository scanner failed (${args.join(" ") || "scan"}):\n${result.stdout ?? ""}${result.stderr ?? ""}`);
  }
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

const selfTest = runScanner(["--self-test"]);
assert.match(selfTest, /Phase C10 repository security scanner self-test passed/);
const repositoryScan = runScanner([]);
assert.match(repositoryScan, /Phase C10 repository security scan passed:/);

const workflow = await readFile(workflowPath, "utf8");
const scanner = await readFile(scannerPath, "utf8");
const codeqlSha = "6f5948dfacef28e207b48d0905cf90c03365536d";

assert.match(workflow, /^name: Security Analysis$/m);
assert.match(workflow, /^\s*pull_request:\s*$/m);
assert.match(workflow, /^\s*branches: \[main\]\s*$/m);
assert.match(workflow, /^\s*schedule:\s*$/m);
assert.match(workflow, /name: Repository Security Gate/);
assert.match(workflow, /node \.ci\/repository-security-scan\.mjs --self-test/);
assert.match(workflow, /node \.ci\/repository-security-scan\.mjs/);
assert.match(workflow, /name: CodeQL SAST \(javascript-typescript\)/);
assert.equal((workflow.match(new RegExp(`github\\/codeql-action\\/(?:init|analyze)@${codeqlSha}`, "g")) ?? []).length, 2,
  "CodeQL init and analyze must both be pinned to the approved exact SHA.");
assert.doesNotMatch(workflow, /github\/codeql-action\/(?:init|analyze)@v\d/);
assert.match(workflow, /languages: javascript-typescript/);
assert.match(workflow, /queries: security-extended/);
assert.match(workflow, /security-events: write/);
assert.doesNotMatch(workflow, /continue-on-error:/);

for (const rule of [
  "PRIVATE_KEY_PEM",
  "AWS_ACCESS_KEY_ID",
  "GITHUB_TOKEN",
  "SLACK_TOKEN",
  "STRIPE_LIVE_SECRET",
  "SENDGRID_API_KEY",
  "GOOGLE_API_KEY",
  "TLS_VERIFICATION_DISABLED",
  "DYNAMIC_CODE_EXECUTION",
  "WEAK_CRYPTO_HASH",
  "EMBEDDED_CREDENTIAL_URL",
  "HARDCODED_SECRET_FALLBACK",
  "HARDCODED_SECRET_LITERAL",
  "TRACKED_SECRET_ENV_FILE",
]) {
  assert.ok(scanner.includes(rule), `C10 scanner is missing rule ${rule}.`);
}
assert.match(scanner, /git", \["ls-files", "-z"\]/);
assert.match(scanner, /console\.error\(`\$\{item\.rule\} \$\{item\.file\}:\$\{item\.line\}`\)/);
assert.doesNotMatch(scanner, /console\.error\([^\n]*(?:match\[0\]|value)\)/,
  "C10 scanner must not print matched secret material.");

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
assert.match(packageJson.scripts.test, /c10:static-security/);
assert.equal(packageJson.scripts["c10:static-security"], "node scripts/c10-static-security-gate-smoke.mjs");

console.log("Phase C10 static security gate acceptance passed");
