import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const apiRoot = new URL("../", import.meta.url);
const repoRoot = new URL("../../../", import.meta.url);
const readApi = (path) => readFile(new URL(path, apiRoot), "utf8");
const readRepo = (path) => readFile(new URL(path, repoRoot), "utf8");

const manifest = JSON.parse(
  await readRepo("ops/transport/transport-e2e-acceptance-phase28.json"),
);
const pkg = JSON.parse(await readApi("package.json"));

assert.equal(manifest.schemaVersion, 1);
assert.equal(manifest.scope, "transport-end-to-end-phases-5-27");
assert.equal(manifest.productionAcceptance, false);
assert.equal(manifest.fullMatrixStillRequired, true);
assert.equal(manifest.liveUatEvidenceStillRequired, true);
assert.equal(manifest.scenarios.length, 12);

const expectedOrder = Array.from({ length: 12 }, (_, index) => index + 1);
assert.deepEqual(
  manifest.scenarios.map((scenario) => scenario.order),
  expectedOrder,
  "Phase 28 scenarios must remain ordered and contiguous",
);

const allowedActors = new Set(["PATIENT", "PROVIDER", "ADMIN", "ADMIN_SYSTEM"]);
const expectedPermission = {
  PATIENT: "PATIENT_TRANSPORT_REQUEST",
  PROVIDER: "TRANSPORT_RESPOND",
  ADMIN: "TRANSPORT_OPERATE",
  ADMIN_SYSTEM: "TRANSPORT_OPERATE",
};
const ids = new Set();
const orderById = new Map();
const sourceCache = new Map();

for (const scenario of manifest.scenarios) {
  assert.match(scenario.id, /^T28-\d{2}-[a-z0-9-]+$/);
  assert.equal(ids.has(scenario.id), false, `duplicate Phase 28 scenario id: ${scenario.id}`);
  ids.add(scenario.id);
  orderById.set(scenario.id, scenario.order);
  assert.equal(allowedActors.has(scenario.actor), true, `unsupported actor for ${scenario.id}`);
  assert.equal(
    scenario.permission,
    expectedPermission[scenario.actor],
    `permission boundary drift for ${scenario.id}`,
  );
  assert.ok(Array.isArray(scenario.sources) && scenario.sources.length > 0);

  for (const dependency of scenario.dependsOn) {
    const dependencyOrder = orderById.get(dependency);
    assert.ok(
      dependencyOrder && dependencyOrder < scenario.order,
      `dependency ${dependency} must exist before ${scenario.id}`,
    );
  }

  let permissionEvidence = false;
  for (const source of scenario.sources) {
    assert.match(source.path, /^services\/api\/(?:src|prisma)\//);
    assert.equal(source.path.includes(".env"), false);
    assert.ok(Array.isArray(source.mustContain) && source.mustContain.length > 0);

    let content = sourceCache.get(source.path);
    if (!content) {
      content = await readRepo(source.path);
      sourceCache.set(source.path, content);
    }
    if (content.includes(`@RequirePermissions("${scenario.permission}")`)) {
      permissionEvidence = true;
    }
    for (const evidence of source.mustContain) {
      assert.equal(typeof evidence, "string");
      assert.ok(
        content.includes(evidence),
        `${scenario.id} source ${source.path} must include: ${evidence}`,
      );
    }
  }
  assert.equal(
    permissionEvidence,
    true,
    `${scenario.id} must retain explicit ${scenario.permission} authorization evidence`,
  );
}

const transport = sourceCache.get(
  "services/api/src/modules/transport/transport.module.ts",
);
const sequence = [
  'ASSIGNED: "EN_ROUTE"',
  'EN_ROUTE: "ARRIVED"',
  'ARRIVED: "TRANSPORTING"',
  'TRANSPORTING: "COMPLETED"',
];
let previousIndex = -1;
for (const transition of sequence) {
  const index = transport.indexOf(transition);
  assert.ok(index > previousIndex, `transport lifecycle order drifted at ${transition}`);
  previousIndex = index;
}

const telemetry = sourceCache.get(
  "services/api/src/modules/transport/transport-telemetry.module.ts",
);
assert.ok(telemetry.includes("coordinateValuesExcludedFromAudit: true"));
assert.equal(
  /metadata:\s*\{[\s\S]{0,500}(latitude|longitude):\s*(point\.|input\.)/m.test(telemetry),
  false,
  "raw telemetry coordinates must not enter bounded audit metadata",
);

const milestones = sourceCache.get(
  "services/api/src/modules/transport/transport-trip-milestones.module.ts",
);
assert.ok(milestones.includes("automaticLifecycleMutation: false"));

const execution = sourceCache.get(
  "services/api/src/modules/transport/transport-report-execution.module.ts",
);
const download = sourceCache.get(
  "services/api/src/modules/transport/transport-report-download.module.ts",
);
const governance = sourceCache.get(
  "services/api/src/modules/transport/transport-report-governance.module.ts",
);
for (const source of [execution, download]) {
  assert.equal(source.includes("signedUrl"), false);
  assert.equal(source.includes("publicUrl:"), false);
}
assert.ok(execution.includes("publicUrlIssued: false"));
assert.ok(download.includes("tokenPersistedPlaintext: false"));
assert.ok(download.includes("publicUrlIssued: false"));

for (const privacyInvariant of [
  "rawAuditMetadataIncluded: false",
  "objectStorageKeyIncluded: false",
  "csvContentIncluded: false",
  "patientIdentityIncluded: false",
  "patientContactIncluded: false",
  "patientLocationIncluded: false",
]) {
  assert.ok(
    governance.includes(privacyInvariant),
    `compliance manifest privacy invariant missing: ${privacyInvariant}`,
  );
}

const scheduler = sourceCache.get(
  "services/api/src/scripts/run-transport-report-scheduler.ts",
);
const reportIndex = scheduler.indexOf("worker.workerCycle(principal, 25)");
const deliveryIndex = scheduler.indexOf("deliveryWorker.runOnce(25)");
const integrityIndex = scheduler.indexOf("integrityWorker.runOnce(principal, 50)");
const retentionIndex = scheduler.indexOf("retentionWorker.runOnce(principal, 100)");
assert.ok(reportIndex >= 0);
assert.ok(deliveryIndex > reportIndex, "delivery notification worker must run after report execution");
assert.ok(integrityIndex > deliveryIndex, "integrity verification must follow report/delivery work");
assert.ok(retentionIndex > integrityIndex, "retention purge must run after integrity verification");

assert.equal(
  pkg.scripts["v2:transport-phase28"],
  "node scripts/v2-transport-phase28-smoke.mjs",
);
assert.ok(pkg.scripts.test.includes("npm run v2:transport-phase27"));
assert.ok(pkg.scripts.test.includes("npm run v2:transport-phase28"));

const serializedManifest = JSON.stringify(manifest);
for (const forbidden of [
  '".env"',
  '"secretValue"',
  '"credentialValue"',
  '"privateKey"',
  '"accessToken"',
]) {
  assert.equal(
    serializedManifest.includes(forbidden),
    false,
    `Phase 28 manifest must not contain secret material: ${forbidden}`,
  );
}

console.log(
  `Transport Phase 28 end-to-end acceptance matrix passed: ${manifest.scenarios.length} ordered scenarios across ${sourceCache.size} source files.`,
);
