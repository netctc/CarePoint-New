import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const args = process.argv.slice(2);
const stdoutMode = args.includes("--stdout");
const positional = args.filter((arg) => arg !== "--stdout");
const [gateId, outputPathArg] = positional;

if (!gateId || positional.length > 2) {
  process.stderr.write(
    "Usage: node scripts/v2-release-external-evidence-scaffold.mjs <gate-id> [ops/release-1/evidence/file.json] [--stdout]\n",
  );
  process.exit(64);
}
if (stdoutMode && outputPathArg) {
  throw new Error("--stdout cannot be combined with an output path.");
}

const phase31 = JSON.parse(
  await readFile(
    resolve(repoRoot, "ops/release-1/final-go-live-gate-readiness-phase31.json"),
    "utf8",
  ),
);

const gate = phase31.gates.find((row) => row.id === gateId);
assert.ok(gate, `Unknown external gate: ${gateId}`);

const governedSourceSha = phase31.baselineValidation?.validatedHead;
assert.match(
  governedSourceSha ?? "",
  /^[a-f0-9]{40}$/i,
  "Phase 31 governed release SHA must be 40 hex characters.",
);

const recommendedNames = new Map([
  ["LIVE-01-PRODUCTION-INFRASTRUCTURE", "production-infrastructure.json"],
  ["LIVE-02-EXTERNAL-PROVIDERS", "external-providers.json"],
  ["LIVE-03-SIGNED-MOBILE-RELEASES", "signed-mobile-releases.json"],
  ["LIVE-04-INDEPENDENT-SECURITY-ASSESSMENT", "independent-security-assessment.json"],
  ["LIVE-05-HUMAN-UAT", "human-uat.json"],
  ["LIVE-06-RESILIENCE-RPO-RTO", "resilience-rpo-rto.json"],
  ["LIVE-07-KSA-MARKET-CLINICAL-APPROVALS", "ksa-market-clinical-approvals.json"],
  ["LIVE-08-DEPLOYMENT-ROLLBACK-REHEARSAL", "deployment-rollback-rehearsal.json"],
]);

const template = JSON.parse(
  await readFile(resolve(repoRoot, gate.evidenceTemplate), "utf8"),
);
const scaffold = structuredClone(template);

if (
  scaffold.release &&
  typeof scaffold.release === "object" &&
  Object.prototype.hasOwnProperty.call(scaffold.release, "sourceSha")
) {
  scaffold.release.sourceSha = governedSourceSha;
}
if (
  scaffold.releaseCandidate &&
  typeof scaffold.releaseCandidate === "object" &&
  Object.prototype.hasOwnProperty.call(scaffold.releaseCandidate, "sourceSha")
) {
  scaffold.releaseCandidate.sourceSha = governedSourceSha;
}

const serialized = JSON.stringify(scaffold, null, 2) + "\n";

if (stdoutMode) {
  process.stderr.write(
    `Scaffold only for ${gateId}; no evidence or acceptance has been recorded.\n`,
  );
  process.stdout.write(serialized);
  process.exit(0);
}

const outputRelative =
  outputPathArg ??
  `ops/release-1/evidence/${recommendedNames.get(gateId)}`;

if (isAbsolute(outputRelative)) {
  throw new Error("Evidence scaffold output must be repository-relative.");
}
assert.ok(
  outputRelative.startsWith("ops/release-1/evidence/"),
  "Evidence scaffold output must live under ops/release-1/evidence/.",
);
assert.equal(
  outputRelative.endsWith(".example.json"),
  false,
  "Scaffold output cannot use an .example.json filename.",
);
assert.equal(
  outputRelative.endsWith(".json"),
  true,
  "Scaffold output must be a .json file.",
);

const outputAbsolute = resolve(repoRoot, outputRelative);
const relativeCheck = relative(repoRoot, outputAbsolute);
assert.equal(relativeCheck.startsWith(".."), false, "Output escapes repository root.");

await mkdir(dirname(outputAbsolute), { recursive: true });
await writeFile(outputAbsolute, serialized, {
  encoding: "utf8",
  flag: "wx",
});

process.stdout.write(
  JSON.stringify(
    {
      schema: "carepoint.external-evidence-scaffold-result/v1",
      gateId,
      outputFile: outputRelative,
      template: gate.evidenceTemplate,
      governedReleaseSourceSha: governedSourceSha,
      evidenceRecorded: false,
      acceptanceRecorded: false,
      gateClosed: false,
      nextStep:
        "Complete real sanitized evidence, then run v2:release-external-gate-preflight before updating the governed Phase 32 index.",
    },
    null,
    2,
  ) + "\n",
);
