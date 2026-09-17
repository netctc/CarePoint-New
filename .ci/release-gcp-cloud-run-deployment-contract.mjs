import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';

const SCHEMA = 'carepoint.release1-gcp-cloud-run-deployment/v1';
const RESULT_SCHEMA = 'carepoint.release1-gcp-cloud-run-deployment-result/v1';
const CONTRACT_SCHEMA = 'carepoint.release1-gcp-cloud-run-deployment-contract/v1';
const PHASE = 'G5c';
const REGION = 'me-central2';
const SHA40 = /^[0-9a-f]{40}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const COMMIT_PIN = /@[0-9a-f]{40}(?:\s|#|$)/i;

function fail(message) {
  throw new Error(message);
}

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object.`);
  return value;
}

function string(value, label) {
  if (typeof value !== 'string' || value.trim() === '') fail(`${label} must be a non-empty string.`);
  return value.trim();
}

function bool(value, label) {
  if (typeof value !== 'boolean') fail(`${label} must be boolean.`);
  return value;
}

function isPlaceholder(value) {
  return typeof value === 'string' && value.startsWith('REPLACE_WITH_');
}

function assertNoSensitiveMaterial(value, path = 'root') {
  if (typeof value === 'string') {
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value)) fail(`${path} contains private-key material.`);
    if (/\"private_key\"\s*:/.test(value)) fail(`${path} contains service-account private-key material.`);
    if (/\b(?:ya29\.|AIza[0-9A-Za-z_-]{20,}|gh[pousr]_[0-9A-Za-z]{20,})/.test(value)) fail(`${path} appears to contain a credential/token.`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSensitiveMaterial(item, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (/^(password|privateKey|private_key|secretValue|accessToken|refreshToken|apiKey|credentialsJson)$/i.test(key)) {
        fail(`${path}.${key} is forbidden in deployment evidence.`);
      }
      assertNoSensitiveMaterial(child, `${path}.${key}`);
    }
  }
}

export function validateTemplate(evidence) {
  evidence = object(evidence, 'evidence');
  assertNoSensitiveMaterial(evidence);
  if (evidence.schema !== SCHEMA) fail(`schema must be ${SCHEMA}.`);
  if (evidence.phase !== PHASE) fail(`phase must be ${PHASE}.`);
  if (bool(evidence.productionAcceptance, 'productionAcceptance') !== false) fail('G5c evidence cannot grant production acceptance.');

  const release = object(evidence.release, 'release');
  string(release.sourceSha, 'release.sourceSha');
  string(release.releaseVersion, 'release.releaseVersion');
  string(release.rcFreezeEvidenceRef, 'release.rcFreezeEvidenceRef');
  string(release.artifactRegistryPromotionEvidenceRef, 'release.artifactRegistryPromotionEvidenceRef');

  const deployment = object(evidence.deployment, 'deployment');
  if (string(deployment.region, 'deployment.region') !== REGION) fail(`deployment.region must be ${REGION}.`);
  string(deployment.imageDigest, 'deployment.imageDigest');
  string(deployment.cloudRunRevisionEvidenceRef, 'deployment.cloudRunRevisionEvidenceRef');
  string(deployment.deploymentEvidenceRef, 'deployment.deploymentEvidenceRef');

  const runtime = object(evidence.runtime, 'runtime');
  string(runtime.releaseVersion, 'runtime.releaseVersion');
  string(runtime.releaseSha, 'runtime.releaseSha');
  string(runtime.artifactDigest, 'runtime.artifactDigest');
  string(runtime.healthEvidenceRef, 'runtime.healthEvidenceRef');
  string(runtime.readinessEvidenceRef, 'runtime.readinessEvidenceRef');

  const controls = object(evidence.controls, 'controls');
  for (const name of [
    'rcFrozen',
    'artifactRegistryPromotionVerified',
    'exactDigestDeployment',
    'noRebuild',
    'keylessDeploymentIdentity',
    'runtimeServiceAccountVerified',
    'serviceReconciled',
    'terminalConditionSucceeded',
    'runtimeSourceIdentityVerified',
    'readinessVerified',
    'productionPreflightsPassed',
    'compatibilityBypassUsed',
    'productionDeploymentEvidence',
  ]) bool(controls[name], `controls.${name}`);

  if (controls.compatibilityBypassUsed !== false) fail('G5c forbids compatibility bypasses.');
  return evidence;
}

function real(value, label) {
  const result = string(value, label);
  if (isPlaceholder(result)) fail(`${label} is still a placeholder.`);
  return result;
}

export function validateFinal(evidence, { expectedSourceSha } = {}) {
  validateTemplate(evidence);
  const sourceSha = real(evidence.release.sourceSha, 'release.sourceSha');
  if (!SHA40.test(sourceSha)) fail('release.sourceSha must be a full lowercase 40-hex Git SHA.');
  if (expectedSourceSha && sourceSha !== expectedSourceSha) {
    fail(`release.sourceSha ${sourceSha} does not match exact checkout ${expectedSourceSha}.`);
  }
  const version = real(evidence.release.releaseVersion, 'release.releaseVersion');
  real(evidence.release.rcFreezeEvidenceRef, 'release.rcFreezeEvidenceRef');
  real(evidence.release.artifactRegistryPromotionEvidenceRef, 'release.artifactRegistryPromotionEvidenceRef');

  const digest = real(evidence.deployment.imageDigest, 'deployment.imageDigest');
  if (!DIGEST.test(digest)) fail('deployment.imageDigest must be sha256:<64 hex>.');
  real(evidence.deployment.cloudRunRevisionEvidenceRef, 'deployment.cloudRunRevisionEvidenceRef');
  real(evidence.deployment.deploymentEvidenceRef, 'deployment.deploymentEvidenceRef');

  if (real(evidence.runtime.releaseSha, 'runtime.releaseSha') !== sourceSha) fail('runtime.releaseSha must match release.sourceSha.');
  if (real(evidence.runtime.releaseVersion, 'runtime.releaseVersion') !== version) fail('runtime.releaseVersion must match release.releaseVersion.');
  if (real(evidence.runtime.artifactDigest, 'runtime.artifactDigest') !== digest) fail('runtime.artifactDigest must match deployment.imageDigest.');
  real(evidence.runtime.healthEvidenceRef, 'runtime.healthEvidenceRef');
  real(evidence.runtime.readinessEvidenceRef, 'runtime.readinessEvidenceRef');

  for (const name of [
    'rcFrozen',
    'artifactRegistryPromotionVerified',
    'exactDigestDeployment',
    'noRebuild',
    'keylessDeploymentIdentity',
    'runtimeServiceAccountVerified',
    'serviceReconciled',
    'terminalConditionSucceeded',
    'runtimeSourceIdentityVerified',
    'readinessVerified',
    'productionPreflightsPassed',
    'productionDeploymentEvidence',
  ]) {
    if (evidence.controls[name] !== true) fail(`controls.${name} must be true for G5c acceptance.`);
  }
  if (evidence.controls.compatibilityBypassUsed !== false) fail('controls.compatibilityBypassUsed must remain false.');
  if (evidence.productionAcceptance !== false) fail('G5c does not grant production acceptance.');
  return evidence;
}

export function assertLiveWorkflowContract(content) {
  const usesLines = content.split(/\r?\n/).map((line) => line.trim()).filter((line) => /^(?:-\s*)?uses:\s*/.test(line));
  if (usesLines.length === 0) fail('GCP Cloud Run deployment workflow has no uses: actions.');
  for (const line of usesLines) if (!COMMIT_PIN.test(line)) fail(`Third-party action must be pinned to a full commit SHA: ${line}`);

  const required = [
    'workflow_dispatch:',
    'id-token: write',
    'environment: gcp-production-equivalent',
    'google-github-actions/auth@',
    'workload_identity_provider:',
    'service_account:',
    'google-github-actions/setup-gcloud@',
    'me-central2',
    'gcloud run services update',
    '--image="$ARTIFACT_REGISTRY_IMMUTABLE_REF"',
    'CAREPOINT_RELEASE_VERSION=',
    'CAREPOINT_RELEASE_SHA=',
    'CAREPOINT_RELEASE_ARTIFACT_DIGEST=',
    'gcloud run services describe',
    '/api/v1/health',
    '/api/v1/health/ready',
    'productionDeploymentEvidence: true',
    'productionAcceptance: false',
  ];
  for (const fragment of required) if (!content.includes(fragment)) fail(`GCP Cloud Run deployment workflow is missing required control: ${fragment}`);

  for (const forbidden of [
    'credentials_json:',
    'service_account_key',
    'activate-service-account',
    'docker build ',
    'docker buildx build',
    ':latest',
    'productionAcceptance: true',
  ]) {
    if (content.includes(forbidden)) fail(`GCP Cloud Run deployment workflow contains forbidden pattern: ${forbidden}`);
  }
}

function expectFailure(fn, label) {
  let failed = false;
  try { fn(); } catch { failed = true; }
  if (!failed) fail(`Self-test expected failure did not occur: ${label}`);
}

function fixture() {
  const sourceSha = 'a'.repeat(40);
  const digest = `sha256:${'b'.repeat(64)}`;
  return {
    schema: SCHEMA,
    phase: PHASE,
    productionAcceptance: false,
    release: {
      sourceSha,
      releaseVersion: '1.0.0-rc.1',
      rcFreezeEvidenceRef: 'evidence://g5a/freeze',
      artifactRegistryPromotionEvidenceRef: 'evidence://g5b/promotion',
    },
    deployment: {
      region: REGION,
      imageDigest: digest,
      cloudRunRevisionEvidenceRef: 'evidence://cloud-run/revision',
      deploymentEvidenceRef: 'evidence://cloud-run/deployment',
    },
    runtime: {
      releaseVersion: '1.0.0-rc.1',
      releaseSha: sourceSha,
      artifactDigest: digest,
      healthEvidenceRef: 'evidence://health',
      readinessEvidenceRef: 'evidence://ready',
    },
    controls: {
      rcFrozen: true,
      artifactRegistryPromotionVerified: true,
      exactDigestDeployment: true,
      noRebuild: true,
      keylessDeploymentIdentity: true,
      runtimeServiceAccountVerified: true,
      serviceReconciled: true,
      terminalConditionSucceeded: true,
      runtimeSourceIdentityVerified: true,
      readinessVerified: true,
      productionPreflightsPassed: true,
      compatibilityBypassUsed: false,
      productionDeploymentEvidence: true,
    },
  };
}

function selfTest() {
  const valid = fixture();
  validateFinal(valid, { expectedSourceSha: valid.release.sourceSha });
  expectFailure(() => validateFinal({ ...valid, productionAcceptance: true }), 'self-approved production acceptance');
  expectFailure(() => validateFinal({ ...valid, deployment: { ...valid.deployment, region: 'us-central1' } }), 'wrong region');
  expectFailure(() => validateFinal({ ...valid, runtime: { ...valid.runtime, releaseSha: 'c'.repeat(40) } }), 'runtime SHA mismatch');
  expectFailure(() => validateFinal({ ...valid, runtime: { ...valid.runtime, artifactDigest: `sha256:${'d'.repeat(64)}` } }), 'runtime digest mismatch');
  expectFailure(() => validateFinal({ ...valid, controls: { ...valid.controls, exactDigestDeployment: false } }), 'mutable deployment');
  expectFailure(() => validateFinal({ ...valid, controls: { ...valid.controls, compatibilityBypassUsed: true } }), 'compatibility bypass');
  console.log('GCP Cloud Run deployment evidence contract self-test passed');
}

async function sha256(pathOrUrl) {
  const bytes = await readFile(pathOrUrl);
  return createHash('sha256').update(bytes).digest('hex');
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) {
    selfTest();
    return;
  }
  if (args[0] === '--validate-workflow') {
    const path = args[1];
    assertLiveWorkflowContract(await readFile(path, 'utf8'));
    console.log(`GCP Cloud Run deployment workflow contract valid: ${path}`);
    return;
  }
  if (args[0] === '--validate-template') {
    const path = args[1];
    validateTemplate(JSON.parse(await readFile(path, 'utf8')));
    console.log(`GCP Cloud Run deployment template valid: ${path}`);
    return;
  }
  if (args[0] === '--validate') {
    const path = args[1];
    const outIndex = args.indexOf('--out');
    const out = outIndex >= 0 ? args[outIndex + 1] : null;
    const expectedSourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const evidence = validateFinal(JSON.parse(await readFile(path, 'utf8')), { expectedSourceSha });
    const result = {
      schema: RESULT_SCHEMA,
      phase: PHASE,
      sourceSha: evidence.release.sourceSha,
      releaseVersion: evidence.release.releaseVersion,
      imageDigest: evidence.deployment.imageDigest,
      region: REGION,
      productionDeploymentEvidence: true,
      runtimeReadinessEvidence: true,
      productionPreflightEvidence: true,
      productionAcceptance: false,
    };
    if (out) await writeFile(out, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
    console.log(JSON.stringify(result));
    return;
  }
  if (args[0] === '--contract-evidence') {
    const template = args[1];
    const workflow = args[2];
    const out = args[3];
    validateTemplate(JSON.parse(await readFile(template, 'utf8')));
    assertLiveWorkflowContract(await readFile(workflow, 'utf8'));
    const result = {
      schema: CONTRACT_SCHEMA,
      phase: PHASE,
      templateSha256: await sha256(template),
      workflowSha256: await sha256(workflow),
      contractSha256: await sha256(new URL(import.meta.url)),
      productionDeploymentEvidence: false,
      runtimeReadinessEvidence: false,
      productionPreflightEvidence: false,
      productionAcceptance: false,
    };
    await writeFile(out, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
    console.log(`Wrote ${out}`);
    return;
  }
  fail('Usage: --self-test | --validate-workflow <file> | --validate-template <file> | --validate <file> [--out <file>] | --contract-evidence <template> <workflow> <out>');
}

await main();
