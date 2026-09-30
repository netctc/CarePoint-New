import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";

const apiRoot = new URL("../", import.meta.url);
const repoRoot = new URL("../../../", import.meta.url);
const readApi = (path) => readFile(new URL(path, apiRoot), "utf8");
const readRepo = (path) => readFile(new URL(path, repoRoot), "utf8");
const existsRepo = async (path) => {
  try {
    await access(new URL(path, repoRoot));
    return true;
  } catch {
    return false;
  }
};

const [contractText, packageText, appModule, adminPage] = await Promise.all([
  readRepo("ops/transport/transport-phases8-26-integration-contract.json"),
  readApi("package.json"),
  readApi("src/app.module.ts"),
  readRepo("apps/admin/app/transport-providers/page.tsx"),
]);

const contract = JSON.parse(contractText);
const pkg = JSON.parse(packageText);

assert.equal(contract.schemaVersion, 1);
assert.equal(contract.scope, "transport-phases-8-26");
assert.equal(contract.canonicalBase, "main");
assert.equal(contract.productionAcceptance, false);
assert.equal(contract.validation?.fullMatrixRequiredBeforeMerge, true);
assert.equal(contract.validation?.mainMergeAllowed, false);
assert.equal(contract.validation?.consolidatedPr, 497);

const expectedPhases = Array.from({ length: 19 }, (_, index) => index + 8);
assert.deepEqual(
  contract.phases.map((item) => item.phase),
  expectedPhases,
  "Transport integration contract must cover every phase from 8 through 26 exactly once",
);

const docs = new Set();
const smokes = new Set();
const migrations = [];
const modules = new Set();
const panels = new Set();

for (const phase of contract.phases) {
  assert.equal(typeof phase.doc, "string");
  assert.equal(typeof phase.smoke, "string");
  assert.equal(await existsRepo(phase.doc), true, `missing Phase ${phase.phase} documentation: ${phase.doc}`);
  assert.equal(await existsRepo(phase.smoke), true, `missing Phase ${phase.phase} smoke: ${phase.smoke}`);
  assert.equal(docs.has(phase.doc), false, `duplicate phase documentation mapping: ${phase.doc}`);
  assert.equal(smokes.has(phase.smoke), false, `duplicate phase smoke mapping: ${phase.smoke}`);
  docs.add(phase.doc);
  smokes.add(phase.smoke);

  const scriptName = `v2:transport-phase${phase.phase}`;
  assert.equal(typeof pkg.scripts?.[scriptName], "string", `missing package script ${scriptName}`);
  assert.ok(
    pkg.scripts[scriptName].includes(phase.smoke.split("/").at(-1)),
    `${scriptName} must execute its declared smoke file`,
  );
  assert.ok(
    pkg.scripts.test.includes(`npm run ${scriptName}`),
    `full API test chain must include ${scriptName}`,
  );

  for (const migration of phase.migrations ?? []) {
    migrations.push(migration);
    assert.equal(
      await existsRepo(`services/api/prisma/migrations/${migration}/migration.sql`),
      true,
      `missing migration SQL for Phase ${phase.phase}: ${migration}`,
    );
  }
  for (const moduleName of phase.modules ?? []) modules.add(moduleName);
  for (const panelName of phase.panels ?? []) panels.add(panelName);
}

assert.equal(new Set(migrations).size, migrations.length, "Transport phase migration mapping must be unique");
const migrationTimestamps = migrations.map((name) => {
  const match = /^(\d{14})_/.exec(name);
  assert.ok(match, `migration must start with a 14-digit UTC timestamp: ${name}`);
  return match[1];
});
const sortedTimestamps = [...migrationTimestamps].sort();
assert.deepEqual(
  migrationTimestamps,
  sortedTimestamps,
  "Transport phase migrations must be declared in chronological order",
);

const transportSourceNames = await readdir(new URL("src/modules/transport/", apiRoot));
const transportSources = (
  await Promise.all(
    transportSourceNames
      .filter((name) => name.endsWith(".ts"))
      .map((name) => readApi("src/modules/transport/" + name)),
  )
).join("\n");

for (const moduleName of modules) {
  assert.ok(
    transportSources.includes(`class ${moduleName}`) ||
      transportSources.includes(`class ${moduleName} `) ||
      transportSources.includes(`export class ${moduleName}`),
    `declared integration module is missing from Transport sources: ${moduleName}`,
  );
}

for (const moduleName of [
  "TransportTelemetryModule",
  "TransportTripMilestonesModule",
  "TransportSmartDispatchModule",
  "TransportPerformanceAnalyticsModule",
  "TransportCommandCenterModule",
  "TransportExecutiveKpiModule",
  "TransportReportExecutionModule",
  "TransportReportDownloadModule",
  "TransportReportRetentionModule",
  "TransportReportGovernanceModule",
  "TransportReportIntegrityModule",
]) {
  assert.ok(appModule.includes(moduleName), `AppModule must register ${moduleName}`);
}

for (const panelName of panels) {
  assert.ok(adminPage.includes(panelName), `Transport Admin page must surface ${panelName}`);
}

assert.ok(
  contract.phases.every((phase) => !("environmentVariables" in phase)),
  "phase integration manifest must not embed environment secrets or variable values",
);

console.log(
  `Transport Phase 27 integration closure acceptance passed: ${contract.phases.length} phases, ${migrations.length} migrations, ${modules.size} modules, ${panels.size} Admin panels.`,
);
