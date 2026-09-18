import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { assertProductionDataGovernanceReady } = require("../dist/infrastructure/data-governance/production-data-governance-preflight.js");
const { parseDataRetentionPolicy } = require("../dist/infrastructure/data-governance/data-governance-policy.js");

function policy(overrides = {}) {
  const actions = {
    AUTH_EPHEMERAL: ["DELETE", 30],
    IDENTITY_PROFILE: ["PRESERVE", null],
    CLINICAL_RECORD: ["DELETE", 365],
    CLINICAL_DOCUMENT: ["PURGE", 365],
    DIAGNOSTIC_REPORT: ["DELETE", 365],
    CONSENT: ["PRESERVE", null],
    FINANCIAL: ["PRESERVE", null],
    COMMUNICATION: ["DELETE", 90],
    AUDIT_SECURITY: ["PRESERVE", null],
    ...overrides,
  };
  return JSON.stringify({
    version: "release1-test-policy-v1",
    rules: Object.entries(actions).map(([dataClass, [action, retentionDays]]) => ({
      dataClass,
      action,
      ...(retentionDays === null ? {} : { retentionDays }),
    })),
  });
}

function validEnv() {
  return {
    NODE_ENV: "production",
    AWS_REGION: "me-south-1",
    DATA_RESIDENCY_JURISDICTION: "TEST-JURISDICTION",
    DATA_RESIDENCY_REGION: "me-south-1",
    DATA_RESIDENCY_POLICY_VERSION: "residency-test-v1",
    DATA_RESIDENCY_EVIDENCE_REFERENCE: "R3-TEST-EVIDENCE",
    DATABASE_DEPLOYMENT_REGION: "me-south-1",
    REDIS_DEPLOYMENT_REGION: "me-south-1",
    DATA_RETENTION_POLICY_JSON: policy(),
    DATA_RETENTION_EXECUTION_ENABLED: "true",
    DATA_RETENTION_EXECUTION_MODE: "manual",
    DATA_RETENTION_APPROVAL_REFERENCE: "RETENTION-TEST-APPROVAL",
    DATA_RETENTION_BATCH_SIZE: "100",
  };
}

assert.doesNotThrow(() => assertProductionDataGovernanceReady({ NODE_ENV: "test" }));
assert.doesNotThrow(() => assertProductionDataGovernanceReady(validEnv()));

for (const name of [
  "DATA_RESIDENCY_JURISDICTION",
  "DATA_RESIDENCY_REGION",
  "DATA_RESIDENCY_POLICY_VERSION",
  "DATA_RESIDENCY_EVIDENCE_REFERENCE",
  "DATABASE_DEPLOYMENT_REGION",
  "REDIS_DEPLOYMENT_REGION",
  "AWS_REGION",
  "DATA_RETENTION_POLICY_JSON",
]) {
  const env = validEnv();
  delete env[name];
  assert.throws(() => assertProductionDataGovernanceReady(env), new RegExp(name));
}

{
  const env = validEnv();
  env.DATABASE_DEPLOYMENT_REGION = "eu-west-1";
  assert.throws(() => assertProductionDataGovernanceReady(env), /DATABASE_DEPLOYMENT_REGION.*must match DATA_RESIDENCY_REGION/);
}
{
  const env = validEnv();
  env.REDIS_DEPLOYMENT_REGION = "eu-west-1";
  assert.throws(() => assertProductionDataGovernanceReady(env), /REDIS_DEPLOYMENT_REGION.*must match DATA_RESIDENCY_REGION/);
}
{
  const env = validEnv();
  env.AWS_REGION = "eu-west-1";
  assert.throws(() => assertProductionDataGovernanceReady(env), /AWS_REGION.*must match DATA_RESIDENCY_REGION/);
}
{
  const env = validEnv();
  env.DATA_RETENTION_EXECUTION_ENABLED = "false";
  assert.throws(() => assertProductionDataGovernanceReady(env), /DATA_RETENTION_EXECUTION_ENABLED=true/);
}
{
  const env = validEnv();
  delete env.DATA_RETENTION_APPROVAL_REFERENCE;
  assert.throws(() => assertProductionDataGovernanceReady(env), /DATA_RETENTION_APPROVAL_REFERENCE/);
}
{
  const env = validEnv();
  env.DATA_RETENTION_EXECUTION_MODE = "automatic";
  assert.throws(() => assertProductionDataGovernanceReady(env), /manual.*scheduled/);
}
{
  const env = validEnv();
  env.DATA_RETENTION_BATCH_SIZE = "0";
  assert.throws(() => assertProductionDataGovernanceReady(env), /DATA_RETENTION_BATCH_SIZE/);
}

assert.throws(
  () => parseDataRetentionPolicy(policy({ AUDIT_SECURITY: ["DELETE", 30] }), true),
  /AUDIT_SECURITY.*does not support destructive action|AUDIT_SECURITY must be PRESERVE/,
);
assert.throws(
  () => parseDataRetentionPolicy(policy({ IDENTITY_PROFILE: ["DELETE", 30] }), true),
  /IDENTITY_PROFILE does not support destructive action/,
);
assert.throws(
  () => parseDataRetentionPolicy(policy({ CLINICAL_DOCUMENT: ["DELETE", 30] }), true),
  /CLINICAL_DOCUMENT does not support destructive action DELETE/,
);
assert.throws(
  () => parseDataRetentionPolicy(JSON.stringify({ version: "missing-class", rules: [] }), true),
  /missing required data class/,
);

const preservePolicy = JSON.stringify({
  version: "preserve-all-v1",
  rules: [
    "AUTH_EPHEMERAL", "IDENTITY_PROFILE", "CLINICAL_RECORD", "CLINICAL_DOCUMENT", "DIAGNOSTIC_REPORT",
    "CONSENT", "FINANCIAL", "COMMUNICATION", "AUDIT_SECURITY",
  ].map((dataClass) => ({ dataClass, action: "PRESERVE" })),
});
{
  const env = validEnv();
  env.DATA_RETENTION_POLICY_JSON = preservePolicy;
  env.DATA_RETENTION_EXECUTION_ENABLED = "false";
  delete env.DATA_RETENTION_APPROVAL_REFERENCE;
  delete env.DATA_RETENTION_EXECUTION_MODE;
  assert.doesNotThrow(() => assertProductionDataGovernanceReady(env));
}

console.log("Release 1 data-residency and retention-policy preflight acceptance passed");
