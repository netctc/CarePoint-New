import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';

const MANIFEST_SCHEMA = 'carepoint.release1-gcp-immutable-deployment-bundle-manifest/v1';
const RESULT_SCHEMA = 'carepoint.release1-gcp-immutable-deployment-bundle-result/v1';
const CONTRACT_SCHEMA = 'carepoint.release1-gcp-immutable-deployment-bundle-contract/v1';
const PHASE = 'G5e';
const REGION = 'me-central2';
const SHA40 = /^[0-9a-f]{40}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

const VALIDATORS = {
  g5a: '.ci/release-gcp-immutable-rc-freeze-contract.mjs',
  g5b: '.ci/release-gcp-artifact-registry-promotion-contract.mjs',
  g5c: '.ci/release-gcp-cloud-run-deployment-contract.mjs',
  g5d: '.ci/release-gcp-admin-cloud-run-deployment-contract.mjs',
};

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

function real(value, label) {
  const result = string(value, label);
  if (isPlaceholder(result)) fail(`${label} is still a placeholder.`);
  return result;
}

function assertNoSensitiveMaterial(value, path = 'root') {
  if (typeof value === 'string') {
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value)) fail(`${path} contains private-key material.`);
    if (/\"private_key\"\s*:/.test(value)) fail(`${path} contains service-account private-key material.`);
    if (/\b(?:ya29\.|AIza[0-9A-Za-z_-]{20,}|gh[pousr]_[0-9A-Za-z]{20,})/.test(value)) fail(`${path} appears to contain credential material.`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSensitiveMaterial(item, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (/^(password|privateKey|private_key|secretValue|accessToken|refreshToken|apiKey|credentialsJson|credentials_json)$/i.test(key)) {
        fail(`${path}.${key} is forbidden in G5 bundle evidence.`);
      }
      assertNoSensitiveMaterial(child, `${path}.${key}`);
    }
  }
}

export function validateManifestTemplate(manifest) {
  manifest = object(manifest, 'manifest');
  assertNoSensitiveMaterial(manifest);
  if (manifest.schema !== MANIFEST_SCHEMA) fail(`schema must be ${MANIFEST_SCHEMA}.`);
  if (manifest.phase !== PHASE) fail(`phase must be ${PHASE}.`);
  if (bool(manifest.productionAcceptance, 'productionAcceptance') !== false) fail('G5e cannot grant production acceptance.');
  if (bool(manifest.productionDeploymentEvidence, 'productionDeploymentEvidence') !== false) {
    fail('The G5e template is contract-only and cannot claim live production deployment evidence.');
  }
  if (bool(manifest.bundleComplete, 'bundleComplete') !== false) fail('The G5e template cannot declare a live bundle complete.');

  const release = object(manifest.release, 'release');
  string(release.sourceSha, 'release.sourceSha');
  string(release.releaseVersion, 'release.releaseVersion');

  const files = object(manifest.evidenceFiles, 'evidenceFiles');
  for (const name of ['g5aFreeze', 'g5bPromotion', 'g5cApiDeployment', 'g5dAdminDeployment']) {
    string(files[name], `evidenceFiles.${name}`);
  }

  const controls = object(manifest.controls, 'controls');
  for (const name of [
    'exactRcIdentityAcrossSlices',
    'apiDigestChainVerified',
    'adminDigestChainVerified',
    'bothWorkloadsDeployed',
    'noRebuildAcrossPromotionAndDeployment',
    'noCompatibilityBypass',
    'runtimeIdentityBound',
    'phaseComplete',
  ]) {
    if (bool(controls[name], `controls.${name}`) !== false) fail(`Template controls.${name} must remain false.`);
  }
  return manifest;
}

function validateSchema(evidence, expectedSchema, expectedPhase, label) {
  evidence = object(evidence, label);
  assertNoSensitiveMaterial(evidence, label);
  if (evidence.schema !== expectedSchema) fail(`${label}.schema must be ${expectedSchema}.`);
  if (evidence.phase !== expectedPhase) fail(`${label}.phase must be ${expectedPhase}.`);
  if (evidence.productionAcceptance !== false) fail(`${label} must keep productionAcceptance=false.`);
  return evidence;
}

export function validateCrossEvidence({ g5a, g5b, g5c, g5d }, { expectedSourceSha } = {}) {
  g5a = validateSchema(g5a, 'carepoint.release1-gcp-immutable-rc-freeze/v1', 'G5a', 'g5a');
  g5b = validateSchema(g5b, 'carepoint.release1-gcp-artifact-registry-promotion/v1', 'G5b', 'g5b');
  g5c = validateSchema(g5c, 'carepoint.release1-gcp-cloud-run-deployment/v1', 'G5c', 'g5c');
  g5d = validateSchema(g5d, 'carepoint.release1-gcp-admin-cloud-run-deployment/v1', 'G5d', 'g5d');

  const sourceSha = real(g5a.release?.sourceSha, 'g5a.release.sourceSha');
  if (!SHA40.test(sourceSha)) fail('Frozen RC source SHA must be a full lowercase 40-hex SHA.');
  if (expectedSourceSha && sourceSha !== expectedSourceSha) fail(`Frozen RC source SHA ${sourceSha} does not match exact checkout ${expectedSourceSha}.`);
  const releaseVersion = real(g5a.release?.releaseVersion, 'g5a.release.releaseVersion');

  for (const [label, evidence] of [['g5b', g5b], ['g5c', g5c], ['g5d', g5d]]) {
    if (real(evidence.release?.sourceSha, `${label}.release.sourceSha`) !== sourceSha) fail(`${label} source SHA does not match G5a.`);
    if (real(evidence.release?.releaseVersion, `${label}.release.releaseVersion`) !== releaseVersion) fail(`${label} release version does not match G5a.`);
  }

  const apiDigest = real(g5a.images?.api?.digest, 'g5a.images.api.digest');
  const adminDigest = real(g5a.images?.admin?.digest, 'g5a.images.admin.digest');
  if (!DIGEST.test(apiDigest) || !DIGEST.test(adminDigest)) fail('G5a API/Admin digests must be immutable sha256 digests.');

  const apiChain = [
    real(g5b.sourceImages?.api?.digest, 'g5b.sourceImages.api.digest'),
    real(g5b.promotedImages?.api?.digest, 'g5b.promotedImages.api.digest'),
    real(g5c.deployment?.imageDigest, 'g5c.deployment.imageDigest'),
    real(g5c.runtime?.artifactDigest, 'g5c.runtime.artifactDigest'),
  ];
  if (apiChain.some((digest) => digest !== apiDigest)) fail('API digest chain G5a -> G5b -> G5c is not identical.');

  const adminChain = [
    real(g5b.sourceImages?.admin?.digest, 'g5b.sourceImages.admin.digest'),
    real(g5b.promotedImages?.admin?.digest, 'g5b.promotedImages.admin.digest'),
    real(g5d.deployment?.imageDigest, 'g5d.deployment.imageDigest'),
    real(g5d.runtime?.artifactDigest, 'g5d.runtime.artifactDigest'),
  ];
  if (adminChain.some((digest) => digest !== adminDigest)) fail('Admin digest chain G5a -> G5b -> G5d is not identical.');

  if (g5b.target?.region !== REGION || g5c.deployment?.region !== REGION || g5d.topology?.region !== REGION) {
    fail(`All promoted/deployed workloads must remain in ${REGION}.`);
  }
  if (g5b.controls?.noRebuild !== true || g5c.controls?.noRebuild !== true || g5d.controls?.noRebuild !== true) {
    fail('G5 bundle requires no rebuild from promotion through both deployments.');
  }
  if (g5c.controls?.compatibilityBypassUsed !== false || g5d.controls?.compatibilityBypassUsed !== false) {
    fail('G5 bundle forbids compatibility bypasses.');
  }
  if (g5c.controls?.productionDeploymentEvidence !== true || g5d.controls?.productionDeploymentEvidence !== true) {
    fail('G5 bundle requires live production-equivalent deployment evidence for API and Admin.');
  }
  if (g5c.controls?.runtimeSourceIdentityVerified !== true || g5d.controls?.runtimeSourceIdentityVerified !== true) {
    fail('Both API and Admin runtime source identity must be verified.');
  }
  if (g5c.controls?.readinessVerified !== true || g5c.controls?.productionPreflightsPassed !== true) {
    fail('API runtime readiness and production preflights must pass for G5 completion.');
  }
  if (g5d.controls?.serviceReconciled !== true || g5d.controls?.terminalConditionSucceeded !== true || g5d.controls?.externalHttpsRouteVerified !== true) {
    fail('Admin Cloud Run readiness and external route evidence must pass for G5 completion.');
  }

  const freezeRefB = real(g5b.release?.g5aFreezeEvidenceRef, 'g5b.release.g5aFreezeEvidenceRef');
  const freezeRefC = real(g5c.release?.rcFreezeEvidenceRef, 'g5c.release.rcFreezeEvidenceRef');
  const freezeRefD = real(g5d.release?.rcFreezeEvidenceRef, 'g5d.release.rcFreezeEvidenceRef');
  if (new Set([freezeRefB, freezeRefC, freezeRefD]).size !== 1) fail('G5b/G5c/G5d must reference the same G5a freeze evidence.');

  const promotionRefC = real(g5c.release?.artifactRegistryPromotionEvidenceRef, 'g5c.release.artifactRegistryPromotionEvidenceRef');
  const promotionRefD = real(g5d.release?.artifactRegistryPromotionEvidenceRef, 'g5d.release.artifactRegistryPromotionEvidenceRef');
  if (promotionRefC !== promotionRefD) fail('G5c and G5d must reference the same G5b promotion evidence.');

  return {
    schema: RESULT_SCHEMA,
    phase: PHASE,
    sourceSha,
    releaseVersion,
    region: REGION,
    apiDigest,
    adminDigest,
    controls: {
      exactRcIdentityAcrossSlices: true,
      apiDigestChainVerified: true,
      adminDigestChainVerified: true,
      bothWorkloadsDeployed: true,
      noRebuildAcrossPromotionAndDeployment: true,
      noCompatibilityBypass: true,
      runtimeIdentityBound: true,
      apiReadinessAndProductionPreflightsPassed: true,
      adminServiceAndExternalRouteVerified: true,
      phaseComplete: true,
    },
    productionAcceptance: false,
  };
}

function runPhaseValidator(script, evidencePath) {
  execFileSync(process.execPath, [script, '--validate', evidencePath], { stdio: 'pipe', encoding: 'utf8' });
}

async function validateBundlePaths(paths, outputPath) {
  const expectedSourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim().toLowerCase();
  if (!SHA40.test(expectedSourceSha)) fail('Unable to resolve exact current Git SHA.');

  runPhaseValidator(VALIDATORS.g5a, paths.g5a);
  runPhaseValidator(VALIDATORS.g5b, paths.g5b);
  runPhaseValidator(VALIDATORS.g5c, paths.g5c);
  runPhaseValidator(VALIDATORS.g5d, paths.g5d);

  const [g5a, g5b, g5c, g5d] = await Promise.all([
    readFile(paths.g5a, 'utf8').then(JSON.parse),
    readFile(paths.g5b, 'utf8').then(JSON.parse),
    readFile(paths.g5c, 'utf8').then(JSON.parse),
    readFile(paths.g5d, 'utf8').then(JSON.parse),
  ]);
  const result = validateCrossEvidence({ g5a, g5b, g5c, g5d }, { expectedSourceSha });
  if (outputPath) await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  return result;
}

function fixture() {
  const sourceSha = 'a'.repeat(40);
  const apiDigest = `sha256:${'b'.repeat(64)}`;
  const adminDigest = `sha256:${'c'.repeat(64)}`;
  const freezeRef = 'restricted://g5a/freeze';
  const promotionRef = 'restricted://g5b/promotion';
  return {
    g5a: {
      schema: 'carepoint.release1-gcp-immutable-rc-freeze/v1', phase: 'G5a', productionAcceptance: false,
      release: { sourceSha, releaseVersion: '1.0.0-rc.1' },
      images: { api: { digest: apiDigest }, admin: { digest: adminDigest } },
    },
    g5b: {
      schema: 'carepoint.release1-gcp-artifact-registry-promotion/v1', phase: 'G5b', productionAcceptance: false,
      release: { sourceSha, releaseVersion: '1.0.0-rc.1', g5aFreezeEvidenceRef: freezeRef },
      target: { region: REGION },
      sourceImages: { api: { digest: apiDigest }, admin: { digest: adminDigest } },
      promotedImages: { api: { digest: apiDigest }, admin: { digest: adminDigest } },
      controls: { noRebuild: true },
    },
    g5c: {
      schema: 'carepoint.release1-gcp-cloud-run-deployment/v1', phase: 'G5c', productionAcceptance: false,
      release: { sourceSha, releaseVersion: '1.0.0-rc.1', rcFreezeEvidenceRef: freezeRef, artifactRegistryPromotionEvidenceRef: promotionRef },
      deployment: { region: REGION, imageDigest: apiDigest },
      runtime: { artifactDigest: apiDigest },
      controls: { noRebuild: true, compatibilityBypassUsed: false, productionDeploymentEvidence: true, runtimeSourceIdentityVerified: true, readinessVerified: true, productionPreflightsPassed: true },
    },
    g5d: {
      schema: 'carepoint.release1-gcp-admin-cloud-run-deployment/v1', phase: 'G5d', productionAcceptance: false,
      release: { sourceSha, releaseVersion: '1.0.0-rc.1', rcFreezeEvidenceRef: freezeRef, artifactRegistryPromotionEvidenceRef: promotionRef },
      topology: { region: REGION },
      deployment: { imageDigest: adminDigest },
      runtime: { artifactDigest: adminDigest },
      controls: { noRebuild: true, compatibilityBypassUsed: false, productionDeploymentEvidence: true, runtimeSourceIdentityVerified: true, serviceReconciled: true, terminalConditionSucceeded: true, externalHttpsRouteVerified: true },
    },
  };
}

function expectFailure(label, mutate) {
  const value = structuredClone(fixture());
  mutate(value);
  let rejected = false;
  try { validateCrossEvidence(value, { expectedSourceSha: value.g5a.release.sourceSha }); } catch { rejected = true; }
  if (!rejected) fail(`Self-test expected rejection: ${label}`);
}

function selfTest() {
  const value = fixture();
  const result = validateCrossEvidence(value, { expectedSourceSha: value.g5a.release.sourceSha });
  if (result.controls.phaseComplete !== true || result.productionAcceptance !== false) fail('Valid G5 bundle fixture did not validate.');
  expectFailure('source SHA mismatch', (v) => { v.g5d.release.sourceSha = 'd'.repeat(40); });
  expectFailure('API digest mismatch', (v) => { v.g5c.deployment.imageDigest = `sha256:${'e'.repeat(64)}`; });
  expectFailure('Admin digest mismatch', (v) => { v.g5d.runtime.artifactDigest = `sha256:${'f'.repeat(64)}`; });
  expectFailure('rebuild after freeze', (v) => { v.g5b.controls.noRebuild = false; });
  expectFailure('compatibility bypass', (v) => { v.g5c.controls.compatibilityBypassUsed = true; });
  expectFailure('missing API preflight', (v) => { v.g5c.controls.productionPreflightsPassed = false; });
  expectFailure('different freeze evidence', (v) => { v.g5d.release.rcFreezeEvidenceRef = 'restricted://g5a/other'; });
  expectFailure('different promotion evidence', (v) => { v.g5d.release.artifactRegistryPromotionEvidenceRef = 'restricted://g5b/other'; });
  console.log('GCP immutable deployment bundle contract self-test passed');
}

async function sha256(pathOrUrl) {
  return createHash('sha256').update(await readFile(pathOrUrl)).digest('hex');
}

async function contractEvidence(manifestPath, outputPath) {
  validateManifestTemplate(JSON.parse(await readFile(manifestPath, 'utf8')));
  const result = {
    schema: CONTRACT_SCHEMA,
    phase: PHASE,
    contractSha256: await sha256(new URL(import.meta.url)),
    manifestSha256: await sha256(manifestPath),
    bundleComplete: false,
    productionDeploymentEvidence: false,
    productionAcceptance: false,
  };
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--self-test') {
    selfTest();
    return;
  }
  if (args.length === 2 && args[0] === '--validate-manifest') {
    validateManifestTemplate(JSON.parse(await readFile(args[1], 'utf8')));
    console.log(`GCP immutable deployment bundle manifest valid: ${args[1]}`);
    return;
  }
  if (args.length === 3 && args[0] === '--contract-evidence') {
    const result = await contractEvidence(args[1], args[2]);
    console.log(JSON.stringify(result));
    return;
  }
  if (args[0] === '--validate-bundle') {
    if (args.length !== 5 && args.length !== 7) fail('Expected four phase evidence files and optional --out <file>.');
    const paths = { g5a: args[1], g5b: args[2], g5c: args[3], g5d: args[4] };
    let outputPath = null;
    if (args.length === 7) {
      if (args[5] !== '--out') fail('Expected --out <file>.');
      outputPath = args[6];
    }
    const result = await validateBundlePaths(paths, outputPath);
    console.log(JSON.stringify(result));
    return;
  }
  fail('Usage: --self-test | --validate-manifest <file> | --contract-evidence <manifest> <out> | --validate-bundle <g5a> <g5b> <g5c> <g5d> [--out <file>]');
}

await main();
