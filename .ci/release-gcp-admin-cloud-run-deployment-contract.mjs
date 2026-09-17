import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';

const SCHEMA = 'carepoint.release1-gcp-admin-cloud-run-deployment/v1';
const RESULT_SCHEMA = 'carepoint.release1-gcp-admin-cloud-run-deployment-result/v1';
const CONTRACT_SCHEMA = 'carepoint.release1-gcp-admin-cloud-run-deployment-contract/v1';
const PHASE = 'G5d';
const REGION = 'me-central2';
const ROUTE_PATH = '/login';
const SHA40 = /^[0-9a-f]{40}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const SHA256_REF = /^sha256:[0-9a-f]{64}$/;
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
  const result = value.trim();
  if (result.length > 1000 || /[\r\n\0]/.test(result)) fail(`${label} must be a bounded single-line string.`);
  return result;
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
        fail(`${path}.${key} is forbidden in Admin deployment evidence.`);
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
  if (bool(evidence.productionAcceptance, 'productionAcceptance') !== false) fail('G5d evidence cannot grant production acceptance.');

  const release = object(evidence.release, 'release');
  string(release.sourceSha, 'release.sourceSha');
  string(release.releaseVersion, 'release.releaseVersion');
  string(release.rcFreezeEvidenceRef, 'release.rcFreezeEvidenceRef');
  string(release.artifactRegistryPromotionEvidenceRef, 'release.artifactRegistryPromotionEvidenceRef');

  const topology = object(evidence.topology, 'topology');
  if (string(topology.provider, 'topology.provider').toLowerCase() !== 'gcp') fail("topology.provider must be 'gcp'.");
  if (string(topology.workload, 'topology.workload') !== 'cloud-run-admin') fail("topology.workload must be 'cloud-run-admin'.");
  if (string(topology.region, 'topology.region') !== REGION) fail(`topology.region must be ${REGION}.`);
  string(topology.adminServiceResourceHash, 'topology.adminServiceResourceHash');
  if (string(topology.publicRoutePath, 'topology.publicRoutePath') !== ROUTE_PATH) fail(`topology.publicRoutePath must be ${ROUTE_PATH}.`);
  string(topology.externalOriginEvidenceRef, 'topology.externalOriginEvidenceRef');

  const deployment = object(evidence.deployment, 'deployment');
  string(deployment.imageDigest, 'deployment.imageDigest');
  string(deployment.cloudRunRevisionEvidenceRef, 'deployment.cloudRunRevisionEvidenceRef');
  string(deployment.deploymentEvidenceRef, 'deployment.deploymentEvidenceRef');

  const runtime = object(evidence.runtime, 'runtime');
  string(runtime.releaseVersion, 'runtime.releaseVersion');
  string(runtime.releaseSha, 'runtime.releaseSha');
  string(runtime.artifactDigest, 'runtime.artifactDigest');
  string(runtime.routeSmokeEvidenceRef, 'runtime.routeSmokeEvidenceRef');

  const controls = object(evidence.controls, 'controls');
  for (const name of [
    'rcFrozen',
    'artifactRegistryPromotionVerified',
    'explicitAdminCloudRunTopology',
    'exactDigestDeployment',
    'noRebuild',
    'keylessDeploymentIdentity',
    'runtimeServiceAccountVerified',
    'serviceReconciled',
    'terminalConditionSucceeded',
    'loadBalancerOnlyIngress',
    'defaultRunAppUriDisabled',
    'externalHttpsRouteVerified',
    'runtimeSourceIdentityVerified',
    'compatibilityBypassUsed',
    'productionDeploymentEvidence',
  ]) bool(controls[name], `controls.${name}`);

  if (controls.compatibilityBypassUsed !== false) fail('G5d forbids compatibility bypasses.');
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
  if (expectedSourceSha && sourceSha !== expectedSourceSha) fail(`release.sourceSha ${sourceSha} does not match exact checkout ${expectedSourceSha}.`);
  const version = real(evidence.release.releaseVersion, 'release.releaseVersion');
  real(evidence.release.rcFreezeEvidenceRef, 'release.rcFreezeEvidenceRef');
  real(evidence.release.artifactRegistryPromotionEvidenceRef, 'release.artifactRegistryPromotionEvidenceRef');

  const serviceHash = real(evidence.topology.adminServiceResourceHash, 'topology.adminServiceResourceHash');
  if (!SHA256_REF.test(serviceHash)) fail('topology.adminServiceResourceHash must be sha256:<64 hex>.');
  real(evidence.topology.externalOriginEvidenceRef, 'topology.externalOriginEvidenceRef');

  const digest = real(evidence.deployment.imageDigest, 'deployment.imageDigest');
  if (!DIGEST.test(digest)) fail('deployment.imageDigest must be sha256:<64 hex>.');
  real(evidence.deployment.cloudRunRevisionEvidenceRef, 'deployment.cloudRunRevisionEvidenceRef');
  real(evidence.deployment.deploymentEvidenceRef, 'deployment.deploymentEvidenceRef');

  if (real(evidence.runtime.releaseSha, 'runtime.releaseSha') !== sourceSha) fail('runtime.releaseSha must match release.sourceSha.');
  if (real(evidence.runtime.releaseVersion, 'runtime.releaseVersion') !== version) fail('runtime.releaseVersion must match release.releaseVersion.');
  if (real(evidence.runtime.artifactDigest, 'runtime.artifactDigest') !== digest) fail('runtime.artifactDigest must match deployment.imageDigest.');
  real(evidence.runtime.routeSmokeEvidenceRef, 'runtime.routeSmokeEvidenceRef');

  for (const name of [
    'rcFrozen',
    'artifactRegistryPromotionVerified',
    'explicitAdminCloudRunTopology',
    'exactDigestDeployment',
    'noRebuild',
    'keylessDeploymentIdentity',
    'runtimeServiceAccountVerified',
    'serviceReconciled',
    'terminalConditionSucceeded',
    'loadBalancerOnlyIngress',
    'defaultRunAppUriDisabled',
    'externalHttpsRouteVerified',
    'runtimeSourceIdentityVerified',
    'productionDeploymentEvidence',
  ]) {
    if (evidence.controls[name] !== true) fail(`controls.${name} must be true for G5d acceptance.`);
  }
  if (evidence.controls.compatibilityBypassUsed !== false) fail('controls.compatibilityBypassUsed must remain false.');
  if (evidence.productionAcceptance !== false) fail('G5d does not grant production acceptance.');
  return evidence;
}

export function assertLiveWorkflowContract(content) {
  const usesLines = content.split(/\r?\n/).map((line) => line.trim()).filter((line) => /^(?:-\s*)?uses:\s*/.test(line));
  if (usesLines.length === 0) fail('GCP Admin Cloud Run deployment workflow has no uses: actions.');
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
    'CAREPOINT_GCP_ADMIN_CLOUD_RUN_SERVICE',
    'CAREPOINT_GCP_ADMIN_SERVICE_ACCOUNT_EMAIL',
    'CAREPOINT_PUBLIC_ADMIN_ORIGIN',
    'carepoint-new-admin',
    'gcloud run services update',
    '--image="$ARTIFACT_REGISTRY_IMMUTABLE_REF"',
    'CAREPOINT_RELEASE_VERSION=',
    'CAREPOINT_RELEASE_SHA=',
    'CAREPOINT_RELEASE_ARTIFACT_DIGEST=',
    'run.googleapis.com/v2/projects/',
    'INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER',
    'defaultUriDisabled',
    '/login',
    'explicitAdminCloudRunTopology: true',
    'productionDeploymentEvidence: true',
    'productionAcceptance: false',
  ];
  for (const fragment of required) if (!content.includes(fragment)) fail(`GCP Admin Cloud Run deployment workflow is missing required control: ${fragment}`);

  for (const forbidden of [
    'credentials_json:',
    'service_account_key',
    'activate-service-account',
    'docker build ',
    'docker buildx build',
    ':latest',
    'productionAcceptance: true',
  ]) {
    if (content.includes(forbidden)) fail(`GCP Admin Cloud Run deployment workflow contains forbidden pattern: ${forbidden}`);
  }
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
    topology: {
      provider: 'gcp',
      workload: 'cloud-run-admin',
      region: REGION,
      adminServiceResourceHash: `sha256:${'c'.repeat(64)}`,
      publicRoutePath: ROUTE_PATH,
      externalOriginEvidenceRef: 'evidence://admin/edge',
    },
    deployment: {
      imageDigest: digest,
      cloudRunRevisionEvidenceRef: `sha256:${'d'.repeat(64)}`,
      deploymentEvidenceRef: 'github://actions/runs/1/attempts/1',
    },
    runtime: {
      releaseVersion: '1.0.0-rc.1',
      releaseSha: sourceSha,
      artifactDigest: digest,
      routeSmokeEvidenceRef: 'github://actions/runs/1/attempts/1#admin-login',
    },
    controls: {
      rcFrozen: true,
      artifactRegistryPromotionVerified: true,
      explicitAdminCloudRunTopology: true,
      exactDigestDeployment: true,
      noRebuild: true,
      keylessDeploymentIdentity: true,
      runtimeServiceAccountVerified: true,
      serviceReconciled: true,
      terminalConditionSucceeded: true,
      loadBalancerOnlyIngress: true,
      defaultRunAppUriDisabled: true,
      externalHttpsRouteVerified: true,
      runtimeSourceIdentityVerified: true,
      compatibilityBypassUsed: false,
      productionDeploymentEvidence: true,
    },
  };
}

function expectFailure(fn, label) {
  let failed = false;
  try { fn(); } catch { failed = true; }
  if (!failed) fail(`Self-test expected failure did not occur: ${label}`);
}

function selfTest() {
  const valid = fixture();
  validateFinal(valid, { expectedSourceSha: valid.release.sourceSha });
  expectFailure(() => validateFinal({ ...valid, productionAcceptance: true }), 'self-approved production acceptance');
  expectFailure(() => validateFinal({ ...valid, topology: { ...valid.topology, region: 'us-central1' } }), 'wrong region');
  expectFailure(() => validateFinal({ ...valid, topology: { ...valid.topology, workload: 'cloud-run-api' } }), 'wrong workload');
  expectFailure(() => validateFinal({ ...valid, runtime: { ...valid.runtime, releaseSha: 'e'.repeat(40) } }), 'runtime SHA mismatch');
  expectFailure(() => validateFinal({ ...valid, controls: { ...valid.controls, defaultRunAppUriDisabled: false } }), 'run.app bypass');
  expectFailure(() => validateFinal({ ...valid, controls: { ...valid.controls, compatibilityBypassUsed: true } }), 'compatibility bypass');
  console.log('GCP Admin Cloud Run deployment evidence contract self-test passed');
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
    console.log(`GCP Admin Cloud Run deployment workflow contract valid: ${path}`);
    return;
  }
  if (args[0] === '--validate-template') {
    const path = args[1];
    validateTemplate(JSON.parse(await readFile(path, 'utf8')));
    console.log(`GCP Admin Cloud Run deployment template valid: ${path}`);
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
      explicitAdminCloudRunTopology: true,
      productionDeploymentEvidence: true,
      externalHttpsRouteEvidence: true,
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
      explicitAdminCloudRunTopology: true,
      productionDeploymentEvidence: false,
      externalHttpsRouteEvidence: false,
      productionAcceptance: false,
    };
    await writeFile(out, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
    console.log(`Wrote ${out}`);
    return;
  }
  fail('Usage: --self-test | --validate-workflow <file> | --validate-template <file> | --validate <file> [--out <file>] | --contract-evidence <template> <workflow> <out>');
}

await main();
