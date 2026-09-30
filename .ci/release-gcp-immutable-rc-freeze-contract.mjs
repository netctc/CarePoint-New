import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const SCHEMA = 'carepoint.release1-gcp-immutable-rc-freeze/v1';
const PHASE = 'G5a';
const API_IMAGE = 'ghcr.io/netctc/carepoint-new-api';
const ADMIN_IMAGE = 'ghcr.io/netctc/carepoint-new-admin';
const SHA40 = /^[0-9a-f]{40}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

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
      if (/^(password|privateKey|private_key|secretValue|accessToken|refreshToken|apiKey)$/i.test(key)) {
        fail(`${path}.${key} is forbidden in release evidence.`);
      }
      assertNoSensitiveMaterial(child, `${path}.${key}`);
    }
  }
}

function expectedImmutableRef(name, digest) {
  return `${name}@${digest}`;
}

function validateImageTemplate(image, label, expectedName) {
  image = object(image, label);
  if (string(image.name, `${label}.name`) !== expectedName) fail(`${label}.name must remain ${expectedName}.`);
  const digest = string(image.digest, `${label}.digest`);
  const immutableRef = string(image.immutableRef, `${label}.immutableRef`);
  if (!isPlaceholder(digest) && !DIGEST.test(digest)) fail(`${label}.digest must be sha256:<64 hex> or a placeholder.`);
  if (!isPlaceholder(immutableRef) && !immutableRef.startsWith(`${expectedName}@sha256:`)) {
    fail(`${label}.immutableRef must be an immutable ${expectedName}@sha256 reference or a placeholder.`);
  }
}

export function validateTemplate(evidence) {
  evidence = object(evidence, 'evidence');
  assertNoSensitiveMaterial(evidence);
  if (evidence.schema !== SCHEMA) fail(`schema must be ${SCHEMA}.`);
  if (evidence.phase !== PHASE) fail(`phase must be ${PHASE}.`);
  if (bool(evidence.productionAcceptance, 'productionAcceptance') !== false) fail('G5a evidence cannot grant production acceptance.');

  const release = object(evidence.release, 'release');
  string(release.sourceSha, 'release.sourceSha');
  string(release.releaseVersion, 'release.releaseVersion');
  string(release.rcEvidenceRef, 'release.rcEvidenceRef');
  string(release.immutableContainerEvidenceRef, 'release.immutableContainerEvidenceRef');

  const build = object(evidence.build, 'build');
  if (string(build.workflow, 'build.workflow') !== 'Release 1 Immutable Containers') fail('build.workflow must reference the existing immutable container workflow.');
  string(build.workflowRunRef, 'build.workflowRunRef');
  bool(build.published, 'build.published');

  const images = object(evidence.images, 'images');
  validateImageTemplate(images.api, 'images.api', API_IMAGE);
  validateImageTemplate(images.admin, 'images.admin', ADMIN_IMAGE);

  const controls = object(evidence.controls, 'controls');
  for (const name of [
    'exactSourceCheckout',
    'buildOncePromoteByDigest',
    'runtimeArtifactSmokeVerified',
    'sbomAttestationVerified',
    'provenanceAttestationVerified',
    'noMutableLatestTag',
    'rebuildAfterFreeze',
    'artifactRegistryPromotionEvidence',
    'productionDeploymentEvidence',
  ]) bool(controls[name], `controls.${name}`);

  if (controls.rebuildAfterFreeze !== false) fail('G5a forbids rebuilding after RC freeze.');
  if (controls.artifactRegistryPromotionEvidence !== false) fail('G5a does not claim Artifact Registry promotion evidence.');
  if (controls.productionDeploymentEvidence !== false) fail('G5a does not claim production deployment evidence.');

  const refs = object(evidence.evidenceRefs, 'evidenceRefs');
  string(refs.sourceIdentity, 'evidenceRefs.sourceIdentity');
  string(refs.apiDigest, 'evidenceRefs.apiDigest');
  string(refs.adminDigest, 'evidenceRefs.adminDigest');
  string(refs.apiProvenance, 'evidenceRefs.apiProvenance');
  string(refs.adminProvenance, 'evidenceRefs.adminProvenance');
  string(refs.sbom, 'evidenceRefs.sbom');

  return evidence;
}

function requireReal(value, label) {
  value = string(value, label);
  if (isPlaceholder(value)) fail(`${label} is still a placeholder.`);
  return value;
}

function validateFinalImage(image, label, expectedName) {
  const digest = requireReal(image.digest, `${label}.digest`);
  if (!DIGEST.test(digest)) fail(`${label}.digest must be sha256:<64 hex>.`);
  const immutableRef = requireReal(image.immutableRef, `${label}.immutableRef`);
  if (immutableRef !== expectedImmutableRef(expectedName, digest)) fail(`${label}.immutableRef must exactly match name + digest.`);
}

export function validateFinal(evidence, { expectedSourceSha } = {}) {
  validateTemplate(evidence);
  const release = evidence.release;
  const sourceSha = requireReal(release.sourceSha, 'release.sourceSha');
  if (!SHA40.test(sourceSha)) fail('release.sourceSha must be a full lowercase 40-hex Git SHA.');
  if (expectedSourceSha && sourceSha !== expectedSourceSha) fail(`release.sourceSha ${sourceSha} does not match exact checkout ${expectedSourceSha}.`);
  requireReal(release.releaseVersion, 'release.releaseVersion');
  requireReal(release.rcEvidenceRef, 'release.rcEvidenceRef');
  requireReal(release.immutableContainerEvidenceRef, 'release.immutableContainerEvidenceRef');

  if (evidence.build.published !== true) fail('build.published must be true for a frozen RC.');
  requireReal(evidence.build.workflowRunRef, 'build.workflowRunRef');
  validateFinalImage(evidence.images.api, 'images.api', API_IMAGE);
  validateFinalImage(evidence.images.admin, 'images.admin', ADMIN_IMAGE);

  const controls = evidence.controls;
  for (const name of [
    'exactSourceCheckout',
    'buildOncePromoteByDigest',
    'runtimeArtifactSmokeVerified',
    'sbomAttestationVerified',
    'provenanceAttestationVerified',
    'noMutableLatestTag',
  ]) {
    if (controls[name] !== true) fail(`controls.${name} must be true for G5a acceptance.`);
  }
  if (controls.rebuildAfterFreeze !== false) fail('controls.rebuildAfterFreeze must remain false.');
  if (controls.artifactRegistryPromotionEvidence !== false) fail('Artifact Registry promotion belongs to a later G5 slice.');
  if (controls.productionDeploymentEvidence !== false) fail('Production deployment evidence belongs to a later G5 slice.');

  for (const [key, value] of Object.entries(evidence.evidenceRefs)) requireReal(value, `evidenceRefs.${key}`);
  return evidence;
}

function expectFailure(fn, label) {
  let failed = false;
  try { fn(); } catch { failed = true; }
  if (!failed) fail(`Self-test expected failure did not occur: ${label}`);
}

function fixture() {
  const sourceSha = 'a'.repeat(40);
  const apiDigest = `sha256:${'b'.repeat(64)}`;
  const adminDigest = `sha256:${'c'.repeat(64)}`;
  return {
    schema: SCHEMA,
    phase: PHASE,
    productionAcceptance: false,
    release: {
      sourceSha,
      releaseVersion: '1.0.0-rc.1',
      rcEvidenceRef: 'evidence://rc/1',
      immutableContainerEvidenceRef: 'evidence://immutable/1',
    },
    build: {
      workflow: 'Release 1 Immutable Containers',
      workflowRunRef: 'github://actions/runs/123',
      published: true,
    },
    images: {
      api: { name: API_IMAGE, digest: apiDigest, immutableRef: `${API_IMAGE}@${apiDigest}` },
      admin: { name: ADMIN_IMAGE, digest: adminDigest, immutableRef: `${ADMIN_IMAGE}@${adminDigest}` },
    },
    controls: {
      exactSourceCheckout: true,
      buildOncePromoteByDigest: true,
      runtimeArtifactSmokeVerified: true,
      sbomAttestationVerified: true,
      provenanceAttestationVerified: true,
      noMutableLatestTag: true,
      rebuildAfterFreeze: false,
      artifactRegistryPromotionEvidence: false,
      productionDeploymentEvidence: false,
    },
    evidenceRefs: {
      sourceIdentity: 'evidence://source',
      apiDigest: 'evidence://api-digest',
      adminDigest: 'evidence://admin-digest',
      apiProvenance: 'evidence://api-provenance',
      adminProvenance: 'evidence://admin-provenance',
      sbom: 'evidence://sbom',
    },
  };
}

function selfTest() {
  const valid = fixture();
  validateFinal(valid, { expectedSourceSha: valid.release.sourceSha });
  expectFailure(() => validateFinal({ ...valid, productionAcceptance: true }), 'self-approved production evidence');
  expectFailure(() => validateFinal({ ...valid, release: { ...valid.release, sourceSha: 'd'.repeat(40) } }, { expectedSourceSha: valid.release.sourceSha }), 'wrong source SHA');
  expectFailure(() => validateFinal({ ...valid, build: { ...valid.build, published: false } }), 'unpublished build');
  expectFailure(() => validateFinal({ ...valid, controls: { ...valid.controls, buildOncePromoteByDigest: false } }), 'build-once disabled');
  expectFailure(() => validateFinal({ ...valid, controls: { ...valid.controls, artifactRegistryPromotionEvidence: true } }), 'premature Artifact Registry claim');
  expectFailure(() => validateFinal({ ...valid, images: { ...valid.images, api: { ...valid.images.api, immutableRef: `${API_IMAGE}:latest` } } }), 'mutable API ref');
  console.log('GCP immutable RC freeze contract self-test passed');
}

async function sha256(path) {
  const bytes = await readFile(path);
  return createHash('sha256').update(bytes).digest('hex');
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) {
    selfTest();
    return;
  }
  const mode = args[0];
  if (mode === '--validate-template') {
    const path = args[1];
    validateTemplate(JSON.parse(await readFile(path, 'utf8')));
    console.log(`GCP immutable RC freeze template valid: ${path}`);
    return;
  }
  if (mode === '--validate') {
    const path = args[1];
    const outIndex = args.indexOf('--out');
    const out = outIndex >= 0 ? args[outIndex + 1] : null;
    const expectedSourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const evidence = validateFinal(JSON.parse(await readFile(path, 'utf8')), { expectedSourceSha });
    const result = {
      schema: 'carepoint.release1-gcp-immutable-rc-freeze-result/v1',
      phase: PHASE,
      sourceSha: evidence.release.sourceSha,
      releaseVersion: evidence.release.releaseVersion,
      rcFrozen: true,
      productionAcceptance: false,
      artifactRegistryPromotionEvidence: false,
      productionDeploymentEvidence: false,
    };
    if (out) await writeFile(out, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
    console.log(JSON.stringify(result));
    return;
  }
  if (mode === '--contract-evidence') {
    const template = args[1];
    const out = args[2];
    validateTemplate(JSON.parse(await readFile(template, 'utf8')));
    const result = {
      schema: 'carepoint.release1-gcp-immutable-rc-freeze-contract/v1',
      phase: PHASE,
      templateSha256: await sha256(template),
      contractSha256: await sha256(new URL(import.meta.url)),
      rcFrozen: false,
      productionAcceptance: false,
      artifactRegistryPromotionEvidence: false,
      productionDeploymentEvidence: false,
    };
    await writeFile(out, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
    console.log(`Wrote ${out}`);
    return;
  }
  fail('Usage: --self-test | --validate-template <file> | --validate <file> [--out <file>] | --contract-evidence <template> <out>');
}

await main();
