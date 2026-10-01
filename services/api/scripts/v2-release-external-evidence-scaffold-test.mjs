import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const script = fileURLToPath(
  new URL("v2-release-external-evidence-scaffold.mjs", import.meta.url),
);

const phase31 = JSON.parse(
  await readFile(
    new URL("../../../ops/release-1/final-go-live-gate-readiness-phase31.json", import.meta.url),
    "utf8",
  ),
);

for (const gate of phase31.gates) {
  const child = spawnSync(process.execPath, [script, gate.id, "--stdout"], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(child.status, 0, `Scaffold stdout failed for ${gate.id}: ${child.stderr}`);
  const generated = JSON.parse(child.stdout);
  const template = JSON.parse(
    await readFile(new URL(`../../../${gate.evidenceTemplate}`, import.meta.url), "utf8"),
  );

  assert.equal(generated.schema, template.schema, `Schema mismatch for ${gate.id}`);

  if (generated.release && "sourceSha" in generated.release) {
    assert.equal(
      generated.release.sourceSha,
      phase31.baselineValidation.validatedHead,
      `Release SHA mismatch for ${gate.id}`,
    );
  }
  if (generated.releaseCandidate && "sourceSha" in generated.releaseCandidate) {
    assert.equal(
      generated.releaseCandidate.sourceSha,
      phase31.baselineValidation.validatedHead,
      `Release candidate SHA mismatch for ${gate.id}`,
    );
  }

  assert.match(
    child.stderr,
    /Scaffold only/,
    `Scaffold safety warning missing for ${gate.id}`,
  );
}

const source = await readFile(new URL("v2-release-external-evidence-scaffold.mjs", import.meta.url), "utf8");
for (const token of [
  'flag: "wx"',
  "evidenceRecorded: false",
  "acceptanceRecorded: false",
  "gateClosed: false",
  "ops/release-1/evidence/",
  "v2:release-external-gate-preflight",
]) {
  assert.ok(source.includes(token), `Scaffolder must include: ${token}`);
}

console.log("External evidence scaffold behavior contract passed for all 8 gates.");
