import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';

const SCHEMA = 'carepoint.release1-gcp-cloud-sql-pitr-rehearsal/v1';
const RESULT_SCHEMA = 'carepoint.release1-gcp-cloud-sql-pitr-rehearsal-result/v1';
const CONTRACT_SCHEMA = 'carepoint.release1-gcp-cloud-sql-pitr-rehearsal-contract/v1';
const PHASE = 'G6a';
const REGION = 'me-central2';
const SHA40 = /^[0-9a-f]{40}$/;
const SHA256_REF = /^sha256:[0-9a-f]{64}$/;
const COMMIT_PIN = /@[0-9a-f]{40}(?:\s|#|$)/i;
const RPO_OBJECTIVE_SECONDS = 15 * 60;
const RTO_OBJECTIVE_SECONDS = 120 * 60;

function fail(message) { throw new Error(message); }
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
function integer(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${label} must be a non-negative integer.`);
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
    if (/postgres(?:ql)?:\/\//i.test(value)) fail(`${path} must not contain a database connection string.`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSensitiveMaterial(item, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (/^(password|privateKey|private_key|secretValue|accessToken|refreshToken|apiKey|credentialsJson|databaseUrl)$/i.test(key)) {
        fail(`${path}.${key} is forbidden in recovery evidence.`);
      }
      assertNoSensitiveMaterial(child, `${path}.${key}`);
    }
  }
}
function parseUtc(value, label, { allowPlaceholder = false } = {}) {
  const text = string(value, label);
  if (allowPlaceholder && isPlaceholder(text)) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(text)) fail(`${label} must be an RFC3339 UTC timestamp.`);
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) fail(`${label} is not a valid timestamp.`);
  return ms;
}
function real(value, label) {
  const result = string(value, label);
  if (isPlaceholder(result)) fail(`${label} is still a placeholder.`);
  return result;
}

export function validateTemplate(evidence) {
  evidence = object(evidence, 'evidence');
  assertNoSensitiveMaterial(evidence);
  if (evidence.schema !== SCHEMA) fail(`schema must be ${SCHEMA}.`);
  if (evidence.phase !== PHASE) fail(`phase must be ${PHASE}.`);
  if (bool(evidence.productionAcceptance, 'productionAcceptance') !== false) fail('G6a cannot grant production acceptance.');

  const release = object(evidence.release, 'release');
  string(release.sourceSha, 'release.sourceSha');
  string(release.releaseVersion, 'release.releaseVersion');
  string(release.g5BundleEvidenceRef, 'release.g5BundleEvidenceRef');

  const topology = object(evidence.topology, 'topology');
  if (string(topology.provider, 'topology.provider').toLowerCase() !== 'gcp') fail("topology.provider must be 'gcp'.");
  if (string(topology.jurisdiction, 'topology.jurisdiction').toUpperCase() !== 'SA') fail("topology.jurisdiction must be 'SA'.");
  if (string(topology.region, 'topology.region') !== REGION) fail(`topology.region must be ${REGION}.`);
  string(topology.sourceInstanceEvidenceHash, 'topology.sourceInstanceEvidenceHash');
  string(topology.restoredInstanceEvidenceHash, 'topology.restoredInstanceEvidenceHash');
  if (bool(topology.geographicDrProven, 'topology.geographicDrProven') !== false) {
    fail('G6a Cloud SQL PITR rehearsal must not claim geographic DR.');
  }

  const recovery = object(evidence.recovery, 'recovery');
  for (const name of [
    'pointInTimeUtc',
    'incidentCutoffUtc',
    'latestRecoveredMarkerUtc',
    'recoveryStartedAtUtc',
    'restoreReadyAtUtc',
    'dataValidationCompletedAtUtc',
    'cleanupCompletedAtUtc',
  ]) parseUtc(recovery[name], `recovery.${name}`, { allowPlaceholder: true });

  const metrics = object(evidence.metrics, 'metrics');
  integer(metrics.rpoSeconds, 'metrics.rpoSeconds');
  integer(metrics.rtoSeconds, 'metrics.rtoSeconds');
  if (integer(metrics.rpoObjectiveSeconds, 'metrics.rpoObjectiveSeconds') !== RPO_OBJECTIVE_SECONDS) {
    fail(`metrics.rpoObjectiveSeconds must remain ${RPO_OBJECTIVE_SECONDS}.`);
  }
  if (integer(metrics.rtoObjectiveSeconds, 'metrics.rtoObjectiveSeconds') !== RTO_OBJECTIVE_SECONDS) {
    fail(`metrics.rtoObjectiveSeconds must remain ${RTO_OBJECTIVE_SECONDS}.`);
  }

  const controls = object(evidence.controls, 'controls');
  for (const name of [
    'keylessAuthentication',
    'sourcePreflightVerified',
    'pitrCloneCreated',
    'restoredInstanceRunnable',
    'restoredInstancePrivateOnly',
    'sameKsaRegion',
    'dataPlaneValidationPassed',
    'applicationRecoveryValidated',
    'temporaryCloneCleanupVerified',
    'geographicDrClaimed',
    'productionRecoveryEvidence',
  ]) bool(controls[name], `controls.${name}`);
  if (controls.geographicDrClaimed !== false) fail('controls.geographicDrClaimed must remain false.');

  const refs = object(evidence.evidenceRefs, 'evidenceRefs');
  for (const name of ['sourcePreflight', 'cloneRun', 'privateDataValidation', 'applicationRecovery', 'cleanup']) {
    string(refs[name], `evidenceRefs.${name}`);
  }
  return evidence;
}

export function validateFinal(evidence, { expectedSourceSha } = {}) {
  validateTemplate(evidence);
  const sourceSha = real(evidence.release.sourceSha, 'release.sourceSha');
  if (!SHA40.test(sourceSha)) fail('release.sourceSha must be a full lowercase 40-hex Git SHA.');
  if (expectedSourceSha && sourceSha !== expectedSourceSha) fail(`release.sourceSha ${sourceSha} does not match exact checkout ${expectedSourceSha}.`);
  real(evidence.release.releaseVersion, 'release.releaseVersion');
  real(evidence.release.g5BundleEvidenceRef, 'release.g5BundleEvidenceRef');

  for (const name of ['sourceInstanceEvidenceHash', 'restoredInstanceEvidenceHash']) {
    const value = real(evidence.topology[name], `topology.${name}`);
    if (!SHA256_REF.test(value)) fail(`topology.${name} must be sha256:<64 hex>.`);
  }

  const recovery = evidence.recovery;
  const pointInTime = parseUtc(recovery.pointInTimeUtc, 'recovery.pointInTimeUtc');
  const incidentCutoff = parseUtc(recovery.incidentCutoffUtc, 'recovery.incidentCutoffUtc');
  const latestMarker = parseUtc(recovery.latestRecoveredMarkerUtc, 'recovery.latestRecoveredMarkerUtc');
  const recoveryStarted = parseUtc(recovery.recoveryStartedAtUtc, 'recovery.recoveryStartedAtUtc');
  const restoreReady = parseUtc(recovery.restoreReadyAtUtc, 'recovery.restoreReadyAtUtc');
  const dataValidationCompleted = parseUtc(recovery.dataValidationCompletedAtUtc, 'recovery.dataValidationCompletedAtUtc');
  const cleanupCompleted = parseUtc(recovery.cleanupCompletedAtUtc, 'recovery.cleanupCompletedAtUtc');

  if (latestMarker > pointInTime) fail('latest recovered marker cannot be newer than the selected PITR timestamp.');
  if (pointInTime > incidentCutoff) fail('PITR timestamp cannot be newer than incident cutoff.');
  if (recoveryStarted < incidentCutoff) fail('recoveryStartedAtUtc cannot precede incidentCutoffUtc.');
  if (restoreReady < recoveryStarted) fail('restoreReadyAtUtc cannot precede recoveryStartedAtUtc.');
  if (dataValidationCompleted < restoreReady) fail('dataValidationCompletedAtUtc cannot precede restoreReadyAtUtc.');
  if (cleanupCompleted < dataValidationCompleted) fail('cleanupCompletedAtUtc cannot precede data validation completion.');

  const calculatedRpo = Math.floor((incidentCutoff - latestMarker) / 1000);
  const calculatedRto = Math.floor((dataValidationCompleted - recoveryStarted) / 1000);
  if (evidence.metrics.rpoSeconds !== calculatedRpo) fail('metrics.rpoSeconds must equal the measured recovered-marker loss window.');
  if (evidence.metrics.rtoSeconds !== calculatedRto) fail('metrics.rtoSeconds must equal recovery start through private data validation completion.');
  if (calculatedRpo > RPO_OBJECTIVE_SECONDS) fail(`Measured RPO ${calculatedRpo}s exceeds ${RPO_OBJECTIVE_SECONDS}s objective.`);
  if (calculatedRto > RTO_OBJECTIVE_SECONDS) fail(`Measured RTO ${calculatedRto}s exceeds ${RTO_OBJECTIVE_SECONDS}s objective.`);

  for (const name of [
    'keylessAuthentication',
    'sourcePreflightVerified',
    'pitrCloneCreated',
    'restoredInstanceRunnable',
    'restoredInstancePrivateOnly',
    'sameKsaRegion',
    'dataPlaneValidationPassed',
    'applicationRecoveryValidated',
    'temporaryCloneCleanupVerified',
    'productionRecoveryEvidence',
  ]) {
    if (evidence.controls[name] !== true) fail(`controls.${name} must be true for final G6a evidence.`);
  }
  if (evidence.controls.geographicDrClaimed !== false || evidence.topology.geographicDrProven !== false) {
    fail('G6a PITR evidence cannot be used as geographic-DR proof.');
  }
  for (const [key, value] of Object.entries(evidence.evidenceRefs)) real(value, `evidenceRefs.${key}`);
  if (evidence.productionAcceptance !== false) fail('G6a does not grant production acceptance.');
  return { evidence, calculatedRpo, calculatedRto };
}

export function assertLiveWorkflowContract(content) {
  const usesLines = content.split(/\r?\n/).map((line) => line.trim()).filter((line) => /^(?:-\s*)?uses:\s*/.test(line));
  if (usesLines.length === 0) fail('GCP Cloud SQL PITR workflow has no uses: actions.');
  for (const line of usesLines) if (!COMMIT_PIN.test(line)) fail(`Third-party action must be pinned to a full commit SHA: ${line}`);
  const required = [
    'workflow_dispatch:',
    'id-token: write',
    'environment: gcp-production-equivalent',
    'google-github-actions/auth@',
    'workload_identity_provider:',
    'service_account:',
    'google-github-actions/setup-gcloud@',
    'CAREPOINT_GCP_CLOUD_SQL_INSTANCE',
    'GCP_RECOVERY_SERVICE_ACCOUNT',
    'me-central2',
    'gcloud sql instances describe',
    'gcloud sql instances clone',
    '--point-in-time="$PITR_TIMESTAMP"',
    'REGIONAL',
    'pointInTimeRecoveryEnabled',
    'ipv4Enabled',
    'requiresPrivateDataPlaneValidation: true',
    'productionRecoveryEvidence: false',
    'productionAcceptance: false',
    'geographicDrClaimed: false',
  ];
  for (const fragment of required) if (!content.includes(fragment)) fail(`GCP Cloud SQL PITR workflow is missing required control: ${fragment}`);
  for (const forbidden of [
    'credentials_json:',
    'service_account_key',
    'activate-service-account',
    'GOOGLE_APPLICATION_CREDENTIALS:',
    'productionRecoveryEvidence: true',
    'productionAcceptance: true',
    'geographicDrClaimed: true',
    'gcloud sql instances delete',
  ]) if (content.includes(forbidden)) fail(`GCP Cloud SQL PITR workflow contains forbidden pattern: ${forbidden}`);
  if (/\npush:\s*\n/.test(content) || /pull_request:/.test(content)) fail('Live PITR workflow must be manual workflow_dispatch only.');
}

function fixture() {
  const sourceSha = 'a'.repeat(40);
  return {
    schema: SCHEMA,
    phase: PHASE,
    productionAcceptance: false,
    release: { sourceSha, releaseVersion: '1.0.0-rc.1', g5BundleEvidenceRef: 'evidence://g5e/bundle' },
    topology: {
      provider: 'gcp', jurisdiction: 'SA', region: REGION,
      sourceInstanceEvidenceHash: `sha256:${'b'.repeat(64)}`,
      restoredInstanceEvidenceHash: `sha256:${'c'.repeat(64)}`,
      geographicDrProven: false,
    },
    recovery: {
      pointInTimeUtc: '2026-09-17T11:55:00Z',
      incidentCutoffUtc: '2026-09-17T12:00:00Z',
      latestRecoveredMarkerUtc: '2026-09-17T11:54:00Z',
      recoveryStartedAtUtc: '2026-09-17T12:01:00Z',
      restoreReadyAtUtc: '2026-09-17T12:20:00Z',
      dataValidationCompletedAtUtc: '2026-09-17T12:30:00Z',
      cleanupCompletedAtUtc: '2026-09-17T12:35:00Z',
    },
    metrics: { rpoSeconds: 360, rtoSeconds: 1740, rpoObjectiveSeconds: 900, rtoObjectiveSeconds: 7200 },
    controls: {
      keylessAuthentication: true,
      sourcePreflightVerified: true,
      pitrCloneCreated: true,
      restoredInstanceRunnable: true,
      restoredInstancePrivateOnly: true,
      sameKsaRegion: true,
      dataPlaneValidationPassed: true,
      applicationRecoveryValidated: true,
      temporaryCloneCleanupVerified: true,
      geographicDrClaimed: false,
      productionRecoveryEvidence: true,
    },
    evidenceRefs: {
      sourcePreflight: 'evidence://g3b/preflight',
      cloneRun: 'github://actions/runs/1/attempts/1',
      privateDataValidation: 'evidence://private-validation',
      applicationRecovery: 'evidence://application-recovery',
      cleanup: 'evidence://cleanup',
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
  expectFailure(() => validateFinal({ ...valid, topology: { ...valid.topology, geographicDrProven: true } }), 'false geographic DR proof');
  expectFailure(() => validateFinal({ ...valid, metrics: { ...valid.metrics, rpoSeconds: 901 }, recovery: { ...valid.recovery, latestRecoveredMarkerUtc: '2026-09-17T11:44:59Z' } }), 'RPO above objective');
  expectFailure(() => validateFinal({ ...valid, metrics: { ...valid.metrics, rtoSeconds: 7201 }, recovery: { ...valid.recovery, dataValidationCompletedAtUtc: '2026-09-17T14:01:01Z', cleanupCompletedAtUtc: '2026-09-17T14:05:00Z' } }), 'RTO above objective');
  expectFailure(() => validateFinal({ ...valid, controls: { ...valid.controls, restoredInstancePrivateOnly: false } }), 'non-private restored instance');
  expectFailure(() => validateFinal({ ...valid, controls: { ...valid.controls, temporaryCloneCleanupVerified: false } }), 'temporary clone not cleaned');
  console.log('GCP Cloud SQL PITR rehearsal evidence contract self-test passed');
}

async function sha256(pathOrUrl) {
  const bytes = await readFile(pathOrUrl);
  return createHash('sha256').update(bytes).digest('hex');
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) { selfTest(); return; }
  if (args[0] === '--validate-template') {
    validateTemplate(JSON.parse(await readFile(args[1], 'utf8')));
    console.log(`GCP Cloud SQL PITR rehearsal template valid: ${args[1]}`);
    return;
  }
  if (args[0] === '--validate-workflow') {
    assertLiveWorkflowContract(await readFile(args[1], 'utf8'));
    console.log(`GCP Cloud SQL PITR live workflow contract valid: ${args[1]}`);
    return;
  }
  if (args[0] === '--validate') {
    const path = args[1];
    const outIndex = args.indexOf('--out');
    const out = outIndex >= 0 ? args[outIndex + 1] : null;
    const expectedSourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const { evidence, calculatedRpo, calculatedRto } = validateFinal(JSON.parse(await readFile(path, 'utf8')), { expectedSourceSha });
    const result = {
      schema: RESULT_SCHEMA,
      phase: PHASE,
      sourceSha: evidence.release.sourceSha,
      releaseVersion: evidence.release.releaseVersion,
      region: REGION,
      rpoSeconds: calculatedRpo,
      rtoSeconds: calculatedRto,
      rpoObjectiveMet: true,
      rtoObjectiveMet: true,
      productionRecoveryEvidence: true,
      geographicDrProven: false,
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
      contractSha256: await sha256(new URL(import.meta.url)),
      templateSha256: await sha256(template),
      workflowSha256: await sha256(workflow),
      rpoObjectiveSeconds: RPO_OBJECTIVE_SECONDS,
      rtoObjectiveSeconds: RTO_OBJECTIVE_SECONDS,
      livePitrExecuted: false,
      privateDataPlaneValidated: false,
      productionRecoveryEvidence: false,
      geographicDrProven: false,
      productionAcceptance: false,
    };
    await writeFile(out, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
    console.log(`Wrote ${out}`);
    return;
  }
  fail('Usage: --self-test | --validate-template <file> | --validate-workflow <file> | --validate <file> [--out <file>] | --contract-evidence <template> <workflow> <out>');
}

await main();
