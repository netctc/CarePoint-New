import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const SCHEMA = 'carepoint.release1-gcp-artifact-registry-promotion/v1';
const PHASE = 'G5b';
const REGION = 'me-central2';
const AR_HOST = `${REGION}-docker.pkg.dev`;
const API_SOURCE_NAME = 'ghcr.io/netctc/carepoint-new-api';
const ADMIN_SOURCE_NAME = 'ghcr.io/netctc/carepoint-new-admin';
const SHA40 = /^[0-9a-f]{40}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const WIF_PROVIDER = /^projects\/[0-9]+\/locations\/global\/workloadIdentityPools\/[A-Za-z0-9._-]+\/providers\/[A-Za-z0-9._-]+$/;
const SERVICE_ACCOUNT = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.iam\.gserviceaccount\.com$/;
const COMMIT_PIN = /@[0-9a-f]{40}(?:\s|#|$)/i;

function fail(message) { throw new Error(message); }
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
function isPlaceholder(value) { return typeof value === 'string' && value.startsWith('REPLACE_WITH_'); }
function requireReal(value, label) {
  value = string(value, label);
  if (isPlaceholder(value)) fail(`${label} is still a placeholder.`);
  return value;
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
      if (/^(password|privateKey|private_key|credentialsJson|credentials_json|secretValue|accessToken|refreshToken|apiKey)$/i.test(key)) {
        fail(`${path}.${key} is forbidden in promotion evidence.`);
      }
      assertNoSensitiveMaterial(child, `${path}.${key}`);
    }
  }
}

function validateSourceTemplate(image, label, expectedName) {
  image = object(image, label);
  if (string(image.name, `${label}.name`) !== expectedName) fail(`${label}.name must remain ${expectedName}.`);
  const digest = string(image.digest, `${label}.digest`);
  const immutableRef = string(image.immutableRef, `${label}.immutableRef`);
  if (!isPlaceholder(digest) && !DIGEST.test(digest)) fail(`${label}.digest must be sha256:<64 hex> or a placeholder.`);
  if (!isPlaceholder(immutableRef) && !immutableRef.startsWith(`${expectedName}@sha256:`)) fail(`${label}.immutableRef must be immutable or a placeholder.`);
}

function validateTargetTemplate(image, label) {
  image = object(image, label);
  const digest = string(image.digest, `${label}.digest`);
  const immutableRef = string(image.immutableRef, `${label}.immutableRef`);
  if (!isPlaceholder(digest) && !DIGEST.test(digest)) fail(`${label}.digest must be sha256:<64 hex> or a placeholder.`);
  if (!isPlaceholder(immutableRef) && !immutableRef.startsWith(`${AR_HOST}/`)) fail(`${label}.immutableRef must target ${AR_HOST} or be a placeholder.`);
  if (!isPlaceholder(immutableRef) && !immutableRef.includes('@sha256:')) fail(`${label}.immutableRef must be digest-addressed.`);
}

export function validateTemplate(evidence) {
  evidence = object(evidence, 'evidence');
  assertNoSensitiveMaterial(evidence);
  if (evidence.schema !== SCHEMA) fail(`schema must be ${SCHEMA}.`);
  if (evidence.phase !== PHASE) fail(`phase must be ${PHASE}.`);
  if (bool(evidence.productionAcceptance, 'productionAcceptance') !== false) fail('G5b evidence cannot grant production acceptance.');
  if (bool(evidence.productionDeploymentEvidence, 'productionDeploymentEvidence') !== false) fail('G5b promotion evidence is not deployment evidence.');

  const release = object(evidence.release, 'release');
  string(release.sourceSha, 'release.sourceSha');
  string(release.releaseVersion, 'release.releaseVersion');
  string(release.g5aFreezeEvidenceRef, 'release.g5aFreezeEvidenceRef');

  const target = object(evidence.target, 'target');
  if (string(target.provider, 'target.provider') !== 'gcp') fail('target.provider must be gcp.');
  if (string(target.region, 'target.region') !== REGION) fail(`target.region must be ${REGION}.`);
  string(target.projectRef, 'target.projectRef');
  string(target.repositoryRef, 'target.repositoryRef');

  const auth = object(evidence.auth, 'auth');
  if (string(auth.mode, 'auth.mode') !== 'workload-identity-federation') fail('auth.mode must be workload-identity-federation.');
  string(auth.workloadIdentityProviderRef, 'auth.workloadIdentityProviderRef');
  string(auth.serviceAccountRef, 'auth.serviceAccountRef');
  if (bool(auth.staticCredentialsUsed, 'auth.staticCredentialsUsed') !== false) fail('Static GCP credentials are forbidden.');
  if (bool(auth.serviceAccountKeyUsed, 'auth.serviceAccountKeyUsed') !== false) fail('Service-account key files are forbidden.');

  const source = object(evidence.sourceImages, 'sourceImages');
  validateSourceTemplate(source.api, 'sourceImages.api', API_SOURCE_NAME);
  validateSourceTemplate(source.admin, 'sourceImages.admin', ADMIN_SOURCE_NAME);
  const promoted = object(evidence.promotedImages, 'promotedImages');
  validateTargetTemplate(promoted.api, 'promotedImages.api');
  validateTargetTemplate(promoted.admin, 'promotedImages.admin');

  const controls = object(evidence.controls, 'controls');
  for (const name of [
    'exactFrozenRcUsed',
    'sourceDigestsVerified',
    'noRebuild',
    'digestPreservingCopy',
    'apiTargetDigestMatchesSource',
    'adminTargetDigestMatchesSource',
    'mutableLatestTagUsed',
    'keylessAuthentication',
  ]) bool(controls[name], `controls.${name}`);
  if (controls.noRebuild !== true) fail('G5b requires noRebuild=true.');
  if (controls.mutableLatestTagUsed !== false) fail('G5b forbids mutable latest tags.');
  if (controls.keylessAuthentication !== true) fail('G5b requires keylessAuthentication=true.');

  const refs = object(evidence.evidenceRefs, 'evidenceRefs');
  for (const name of ['promotionRun', 'sourceDigestVerification', 'apiPromotion', 'adminPromotion', 'targetDigestVerification']) {
    string(refs[name], `evidenceRefs.${name}`);
  }
  return evidence;
}

function validateFinalSource(image, label, expectedName) {
  const digest = requireReal(image.digest, `${label}.digest`);
  if (!DIGEST.test(digest)) fail(`${label}.digest must be sha256:<64 hex>.`);
  const ref = requireReal(image.immutableRef, `${label}.immutableRef`);
  if (ref !== `${expectedName}@${digest}`) fail(`${label}.immutableRef must exactly match name + digest.`);
  return digest;
}

function validateFinalTarget(image, label, expectedDigest) {
  const digest = requireReal(image.digest, `${label}.digest`);
  if (!DIGEST.test(digest)) fail(`${label}.digest must be sha256:<64 hex>.`);
  if (digest !== expectedDigest) fail(`${label}.digest must equal the frozen source digest.`);
  const ref = requireReal(image.immutableRef, `${label}.immutableRef`);
  if (!ref.startsWith(`${AR_HOST}/`) || !ref.endsWith(`@${digest}`)) fail(`${label}.immutableRef must be a ${AR_HOST} digest reference matching the promoted digest.`);
  if (/:latest(?:@|$)/.test(ref)) fail(`${label}.immutableRef must not use latest.`);
}

export function validateFinal(evidence) {
  validateTemplate(evidence);
  const release = evidence.release;
  const sourceSha = requireReal(release.sourceSha, 'release.sourceSha');
  if (!SHA40.test(sourceSha)) fail('release.sourceSha must be a full lowercase 40-hex Git SHA.');
  requireReal(release.releaseVersion, 'release.releaseVersion');
  requireReal(release.g5aFreezeEvidenceRef, 'release.g5aFreezeEvidenceRef');

  const projectRef = requireReal(evidence.target.projectRef, 'target.projectRef');
  if (!/^projects\/[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectRef)) fail('target.projectRef must be projects/<project-id>.');
  const repositoryRef = requireReal(evidence.target.repositoryRef, 'target.repositoryRef');
  if (!repositoryRef.startsWith(`${AR_HOST}/`)) fail(`target.repositoryRef must be hosted in ${AR_HOST}.`);

  const wif = requireReal(evidence.auth.workloadIdentityProviderRef, 'auth.workloadIdentityProviderRef');
  if (!WIF_PROVIDER.test(wif)) fail('auth.workloadIdentityProviderRef must be a full global Workload Identity Provider resource name.');
  const serviceAccount = requireReal(evidence.auth.serviceAccountRef, 'auth.serviceAccountRef');
  if (!SERVICE_ACCOUNT.test(serviceAccount)) fail('auth.serviceAccountRef must be a GCP service-account email.');

  const apiSourceDigest = validateFinalSource(evidence.sourceImages.api, 'sourceImages.api', API_SOURCE_NAME);
  const adminSourceDigest = validateFinalSource(evidence.sourceImages.admin, 'sourceImages.admin', ADMIN_SOURCE_NAME);
  validateFinalTarget(evidence.promotedImages.api, 'promotedImages.api', apiSourceDigest);
  validateFinalTarget(evidence.promotedImages.admin, 'promotedImages.admin', adminSourceDigest);

  for (const name of ['exactFrozenRcUsed', 'sourceDigestsVerified', 'noRebuild', 'digestPreservingCopy', 'apiTargetDigestMatchesSource', 'adminTargetDigestMatchesSource', 'keylessAuthentication']) {
    if (evidence.controls[name] !== true) fail(`controls.${name} must be true for G5b acceptance.`);
  }
  if (evidence.controls.mutableLatestTagUsed !== false) fail('controls.mutableLatestTagUsed must remain false.');
  for (const [key, value] of Object.entries(evidence.evidenceRefs)) requireReal(value, `evidenceRefs.${key}`);
  return evidence;
}

export function validatePromotionWorkflow(content) {
  const required = [
    'workflow_dispatch:',
    'id-token: write',
    'packages: read',
    `AR_HOST: ${AR_HOST}`,
    'vars.GCP_PROJECT_ID',
    'vars.GCP_WIF_PROVIDER',
    'vars.GCP_PROMOTION_SERVICE_ACCOUNT',
    'vars.GCP_ARTIFACT_REGISTRY_REPOSITORY',
    'google-github-actions/auth@',
    'workload_identity_provider:',
    'service_account:',
    'google-github-actions/setup-gcloud@',
    'gcloud auth configure-docker "$AR_HOST" --quiet',
    'docker buildx imagetools create',
    'docker buildx imagetools inspect',
    'test "$api_target_digest" = "$API_SOURCE_DIGEST"',
    'test "$admin_target_digest" = "$ADMIN_SOURCE_DIGEST"',
    'productionDeploymentEvidence=false',
    'productionAcceptance=false',
  ];
  for (const fragment of required) if (!content.includes(fragment)) fail(`Promotion workflow missing required control: ${fragment}`);
  const usesLines = content.split(/\r?\n/).map((line) => line.trim()).filter((line) => /^(?:-\s*)?uses:\s*/.test(line));
  for (const line of usesLines) if (!COMMIT_PIN.test(line)) fail(`Every action must be pinned to a full commit SHA: ${line}`);
  for (const forbidden of ['credentials_json:', 'service_account_key', 'GOOGLE_APPLICATION_CREDENTIALS:', 'docker build ', 'docker buildx build ', 'docker/build-push-action@', ':latest']) {
    if (content.includes(forbidden)) fail(`Promotion workflow contains forbidden pattern: ${forbidden}`);
  }
  if (/\npush:\s*\n/.test(content) || /pull_request:/.test(content)) fail('Live promotion workflow must be manual workflow_dispatch only.');
  return true;
}

function expectFailure(fn, label) {
  let failed = false;
  try { fn(); } catch { failed = true; }
  if (!failed) fail(`Self-test expected failure did not occur: ${label}`);
}

function fixture() {
  const apiDigest = `sha256:${'b'.repeat(64)}`;
  const adminDigest = `sha256:${'c'.repeat(64)}`;
  return {
    schema: SCHEMA,
    phase: PHASE,
    productionAcceptance: false,
    productionDeploymentEvidence: false,
    release: { sourceSha: 'a'.repeat(40), releaseVersion: '1.0.0-rc.1', g5aFreezeEvidenceRef: 'evidence://g5a/freeze' },
    target: { provider: 'gcp', region: REGION, projectRef: 'projects/carepoint-prod1', repositoryRef: `${AR_HOST}/carepoint-prod1/carepoint-release` },
    auth: { mode: 'workload-identity-federation', workloadIdentityProviderRef: 'projects/123456789/locations/global/workloadIdentityPools/github/providers/carepoint', serviceAccountRef: 'carepoint-promotion@carepoint-prod1.iam.gserviceaccount.com', staticCredentialsUsed: false, serviceAccountKeyUsed: false },
    sourceImages: {
      api: { name: API_SOURCE_NAME, digest: apiDigest, immutableRef: `${API_SOURCE_NAME}@${apiDigest}` },
      admin: { name: ADMIN_SOURCE_NAME, digest: adminDigest, immutableRef: `${ADMIN_SOURCE_NAME}@${adminDigest}` },
    },
    promotedImages: {
      api: { digest: apiDigest, immutableRef: `${AR_HOST}/carepoint-prod1/carepoint-release/carepoint-new-api@${apiDigest}` },
      admin: { digest: adminDigest, immutableRef: `${AR_HOST}/carepoint-prod1/carepoint-release/carepoint-new-admin@${adminDigest}` },
    },
    controls: { exactFrozenRcUsed: true, sourceDigestsVerified: true, noRebuild: true, digestPreservingCopy: true, apiTargetDigestMatchesSource: true, adminTargetDigestMatchesSource: true, mutableLatestTagUsed: false, keylessAuthentication: true },
    evidenceRefs: { promotionRun: 'evidence://promotion/run', sourceDigestVerification: 'evidence://source/digests', apiPromotion: 'evidence://api', adminPromotion: 'evidence://admin', targetDigestVerification: 'evidence://target/digests' },
  };
}

function selfTest() {
  const valid = fixture();
  validateFinal(valid);
  expectFailure(() => validateFinal({ ...valid, productionAcceptance: true }), 'self-approved production');
  expectFailure(() => validateFinal({ ...valid, auth: { ...valid.auth, staticCredentialsUsed: true } }), 'static credentials');
  expectFailure(() => validateFinal({ ...valid, controls: { ...valid.controls, noRebuild: false } }), 'rebuild enabled');
  expectFailure(() => validateFinal({ ...valid, promotedImages: { ...valid.promotedImages, api: { ...valid.promotedImages.api, digest: `sha256:${'d'.repeat(64)}` } } }), 'target digest mismatch');
  expectFailure(() => validateFinal({ ...valid, target: { ...valid.target, region: 'me-central1' } }), 'wrong region');
  console.log('GCP Artifact Registry promotion contract self-test passed');
}

async function sha256(path) {
  const bytes = await readFile(path);
  return createHash('sha256').update(bytes).digest('hex');
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) { selfTest(); return; }
  const mode = args[0];
  if (mode === '--validate-template') {
    const path = args[1];
    validateTemplate(JSON.parse(await readFile(path, 'utf8')));
    console.log(`GCP Artifact Registry promotion template valid: ${path}`);
    return;
  }
  if (mode === '--validate-workflow') {
    const path = args[1];
    validatePromotionWorkflow(await readFile(path, 'utf8'));
    console.log(`GCP Artifact Registry promotion workflow contract valid: ${path}`);
    return;
  }
  if (mode === '--validate') {
    const path = args[1];
    const outIndex = args.indexOf('--out');
    const out = outIndex >= 0 ? args[outIndex + 1] : null;
    const evidence = validateFinal(JSON.parse(await readFile(path, 'utf8')));
    const result = { schema: 'carepoint.release1-gcp-artifact-registry-promotion-result/v1', phase: PHASE, sourceSha: evidence.release.sourceSha, releaseVersion: evidence.release.releaseVersion, artifactRegistryPromotionEvidence: true, productionDeploymentEvidence: false, productionAcceptance: false };
    if (out) await writeFile(out, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
    console.log(JSON.stringify(result));
    return;
  }
  if (mode === '--contract-evidence') {
    const template = args[1];
    const workflow = args[2];
    const out = args[3];
    validateTemplate(JSON.parse(await readFile(template, 'utf8')));
    validatePromotionWorkflow(await readFile(workflow, 'utf8'));
    const result = { schema: 'carepoint.release1-gcp-artifact-registry-promotion-contract/v1', phase: PHASE, templateSha256: await sha256(template), workflowSha256: await sha256(workflow), contractSha256: await sha256(new URL(import.meta.url)), artifactRegistryPromotionEvidence: false, productionDeploymentEvidence: false, productionAcceptance: false };
    await writeFile(out, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
    console.log(`Wrote ${out}`);
    return;
  }
  fail('Usage: --self-test | --validate-template <file> | --validate-workflow <file> | --validate <file> [--out <file>] | --contract-evidence <template> <workflow> <out>');
}

await main();
