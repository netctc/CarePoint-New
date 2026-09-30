import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const heavyWorkflows = [
  ".github/workflows/uat-evidence-contract.yml",
  ".github/workflows/promotion-policy-evidence-contract.yml",
  ".github/workflows/patient-profile-postgres.yml",
  ".github/workflows/external-integration-contract.yml",
  ".github/workflows/availability-journeys-postgres.yml",
  ".github/workflows/market-readiness-evidence-contract.yml",
  ".github/workflows/slice10-fhir.yml",
  ".github/workflows/release1-immutable-containers.yml",
  ".github/workflows/release-candidate-evidence.yml",
  ".github/workflows/resilience-rehearsal-contract.yml",
  ".github/workflows/performance-harness-contract.yml",
  ".github/workflows/mobile-native-compatibility.yml",
  ".github/workflows/production-infrastructure-contract.yml",
  ".github/workflows/deployment-rehearsal-contract.yml",
  ".github/workflows/postgres-recovery.yml",
  ".github/workflows/mobile-release-evidence-contract.yml",
  ".github/workflows/integrated-test-version.yml",
  ".github/workflows/release1-container-compatibility.yml",
".github/workflows/gcp-admin-cloud-run-deployment-contract.yml",
".github/workflows/gcp-immutable-rc-freeze-contract.yml"
];

const [
  governance,
  adminPanel,
  securityWorkflow,
  packageText,
  docs,
  ...heavyTexts
] = await Promise.all([
  read("src/modules/transport/transport-report-governance.module.ts"),
  read("../../apps/admin/components/TransportReportGovernancePanel.tsx"),
  read("../../.github/workflows/security-analysis.yml"),
  read("package.json"),
  read("../../docs/transport-report-compliance-manifest-phase26.md"),
  ...heavyWorkflows.map((path) => read("../../" + path)),
]);

const pkg = JSON.parse(packageText);

for (const text of [
  "async complianceManifest(",
  '"carepoint.transport.governance-manifest.v1"',
  '"SORTED_JSON_KEYS_V1"',
  'createHash("sha256")',
  "manifestSha256",
  "missingIntegrityRecords",
  "lastEventHash",
  '"EXTERNAL_SIGNING_REQUIRED"',
  "cryptographicSignaturePerformed: false",
  "approvedSignerConfigured: false",
  "signingKeyReferenceIncluded: false",
  '@Get("report-runs/:runId/compliance-manifest")',
  'action: "ADMIN_TRANSPORT_REPORT_COMPLIANCE_MANIFEST_EXPORTED"',
  'purpose: "COMPLIANCE_EVIDENCE"',
]) {
  assert.ok(governance.includes(text), `governance manifest must include: ${text}`);
}

for (const text of [
  "rawAuditMetadataIncluded: false",
  "objectStorageKeyIncluded: false",
  "csvContentIncluded: false",
  "patientIdentityIncluded: false",
  "patientContactIncluded: false",
  "patientLocationIncluded: false",
]) {
  assert.ok(governance.includes(text), `manifest privacy boundary must include: ${text}`);
}

assert.ok(
  !governance.includes("privateKey") &&
  !governance.includes("signingSecret"),
  "Phase 26 must not invent a local signing key/secret",
);

for (const text of [
  "PHASE 26 · COMPLIANCE EVIDENCE + GOVERNANCE MANIFEST",
  "async function exportComplianceManifest",
  '"/compliance-manifest"',
  "Export compliance manifest",
  "carepoint-transport-compliance-manifest-",
  "cryptographic signing remains external",
]) {
  assert.ok(adminPanel.includes(text), `Admin manifest export must include: ${text}`);
}

assert.ok(
  securityWorkflow.includes("concurrency:") &&
    securityWorkflow.includes("cancel-in-progress: true"),
  "Security Analysis must cancel superseded stacked-PR runs",
);

for (let index = 0; index < heavyTexts.length; index += 1) {
  const text = heavyTexts[index];
  const path = heavyWorkflows[index];
  for (const branch of [
    "- main",
    "- v2/development",
    "- entorno-v2",
    '- "release/**"',
  ]) {
    assert.ok(text.includes(branch), `${path} must target canonical branch: ${branch}`);
  }
  assert.ok(text.includes("concurrency:"), `${path} must define concurrency`);
}

assert.equal(
  pkg.scripts["v2:transport-phase26"],
  "node scripts/v2-transport-phase26-smoke.mjs",
);
assert.ok(pkg.scripts.test.includes("npm run v2:transport-phase26"));

for (const text of [
  "Compliance Evidence Export + Governance Manifest",
  "EXTERNAL_SIGNING_REQUIRED",
  "20 heavy validation workflows",
  "Fast stacked-PR lane",
  "No new environment variables",
  "No database migration is required",
]) {
  assert.ok(docs.includes(text), `Phase 26 docs must include: ${text}`);
}

console.log("Transport Phase 26 compliance manifest + CI fast lane acceptance passed");
