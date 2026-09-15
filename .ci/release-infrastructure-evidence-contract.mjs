import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';

const FULL_GIT_SHA = /^[0-9a-f]{40}$/i;
const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/i;
const ENVIRONMENT_CLASSIFICATIONS = new Set(['production-equivalent', 'production']);
const APPLICABILITY = new Set(['APPLICABLE', 'NOT_APPLICABLE']);
const CONTROL_STATUS = new Set(['PASS', 'FAIL', 'BLOCKED', 'NOT_APPLICABLE']);
const APPROVAL_ROLES = ['Operations', 'SRE', 'Database', 'Security', 'Privacy', 'Product'];
const MAX_RPO_MINUTES = 15;
const MAX_RTO_MINUTES = 120;

const FORBIDDEN_KEYS = new Set([
  'password',
  'passphrase',
  'clientsecret',
  'apikey',
  'accesstoken',
  'refreshtoken',
  'privatekey',
  'authorization',
  'cookie',
  'connectionstring',
  'databaseurl',
  'patientid',
  'patientname',
  'mrn',
  'nationalid',
  'dateofbirth',
  'dob',
  'requestbody',
  'rawrequest',
  'phivalue',
]);

const SENSITIVE_VALUE_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/i,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  /https?:\/\/[^\s/@:]+:[^\s/@]+@/i,
  /[?&](?:token|access_token|api_key|apikey|secret|password)=([^&\s]+)/i,
  /\b(?:password|passphrase|client_secret|api_key|apikey|access_token|refresh_token)\s*[:=]\s*\S+/i,
];

const CONTROL_DEFINITIONS = [
  { id: 'postgres-tls-version', when: () => true },
  { id: 'postgres-ha-failover', when: () => true },
  { id: 'postgres-pitr-backup-restore', when: () => true },
  { id: 'postgres-pooling-limits', when: () => true },
  { id: 'redis-tls-auth', when: () => true },
  { id: 'redis-ha-persistence', when: () => true },
  { id: 'redis-monitoring-reconnect', when: () => true },
  { id: 'object-storage-private-access', when: () => true },
  { id: 'object-storage-kms-residency', when: () => true },
  { id: 'object-storage-lifecycle-recovery', when: () => true },
  { id: 'kms-customer-managed-least-privilege', when: () => true },
  { id: 'kms-rotation-recovery', when: () => true },
  { id: 'external-secrets-rotation', when: () => true },
  { id: 'clinical-upload-malware-scan', when: (root) => root.scope.clinicalUploadsEnabled },
  { id: 'dicom-pacs-security', when: (root) => root.scope.dicomEnabled },
  { id: 'otlp-tls-phi-safety', when: () => true },
  { id: 'siem-end-to-end-delivery', when: () => true },
  { id: 'async-backlog-alerting', when: () => true },
  { id: 'edge-dns-tls-chain', when: () => true },
  { id: 'edge-proxy-trust-cors-headers', when: () => true },
  { id: 'notification-worker-runtime', when: () => true },
  { id: 'siem-worker-runtime', when: () => true },
  { id: 'fhir-bulk-worker-cleanup', when: (root) => root.scope.fhirBulkEnabled },
  { id: 'scheduled-maintenance-runtime', when: () => true },
  { id: 'multi-replica-lease-idempotency', when: () => true },
  { id: 'export-lifecycle-residency', when: (root) => root.scope.exportsEnabled },
  { id: 'dr-runbook-failover-restore', when: () => true },
  { id: 'post-recovery-integrity', when: () => true },
];

const DESTINATION_DEFINITIONS = [
  { id: 'postgres-primary', when: () => true },
  { id: 'postgres-ha-replicas', when: () => true },
  { id: 'postgres-backups-pitr', when: () => true },
  { id: 'redis-primary', when: () => true },
  { id: 'redis-ha-replicas', when: () => true },
  { id: 'clinical-object-storage', when: () => true },
  { id: 'kms-key-material', when: () => true },
  { id: 'otlp-processing', when: () => true },
  { id: 'siem-processing', when: () => true },
  { id: 'exported-artifacts', when: (root) => root.scope.exportsEnabled },
  { id: 'fhir-bulk-artifacts', when: (root) => root.scope.fhirBulkEnabled },
];

function command(commandName, args) {
  return execFileSync(commandName, args, { encoding: 'utf8' }).trim();
}

function currentGitSha() {
  const value = command('git', ['rev-parse', 'HEAD']).toLowerCase();
  if (!FULL_GIT_SHA.test(value)) throw new Error('Unable to resolve a full current Git SHA.');
  return value;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function requiredObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value;
}

function requiredString(value, label, maxLength = 500) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} must be a non-empty string.`);
  const result = value.trim();
  if (result.length > maxLength || /[\r\n\0]/.test(result)) throw new Error(`${label} must be one line and at most ${maxLength} characters.`);
  return result;
}

function requireReference(value, label) {
  return requiredString(value, label, 500);
}

function requireBoolean(value, label, expected) {
  if (typeof value !== 'boolean') throw new Error(`${label} must be boolean.`);
  if (typeof expected === 'boolean' && value !== expected) throw new Error(`${label} must be ${expected}.`);
  return value;
}

function requireFullSha(value, label) {
  const result = requiredString(value, label, 40).toLowerCase();
  if (!FULL_GIT_SHA.test(result)) throw new Error(`${label} must be a full 40-hex Git SHA.`);
  return result;
}

function requireDigest(value, label) {
  const result = requiredString(value, label, 80).toLowerCase();
  if (!SHA256_DIGEST.test(result)) throw new Error(`${label} must be sha256:<64-hex>.`);
  return result;
}

function requireTimestamp(value, label) {
  const result = requiredString(value, label, 80);
  if (!Number.isFinite(Date.parse(result))) throw new Error(`${label} must be an ISO-compatible timestamp.`);
  return result;
}

function requireNonNegativeNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`${label} must be a non-negative number.`);
  return value;
}

function requireStringArray(value, label, { min = 1, max = 50 } = {}) {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw new Error(`${label} must contain between ${min} and ${max} values.`);
  const normalized = value.map((item, index) => requiredString(item, `${label}[${index}]`, 120));
  if (new Set(normalized).size !== normalized.length) throw new Error(`${label} must not contain duplicates.`);
  return normalized;
}

function scanSensitiveData(value, trail = 'evidence') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanSensitiveData(item, `${trail}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (FORBIDDEN_KEYS.has(normalizedKey)) throw new Error(`Sensitive/PHI-like key ${trail}.${key} is not allowed.`);
      scanSensitiveData(child, `${trail}.${key}`);
    }
    return;
  }
  if (typeof value === 'string') {
    for (const pattern of SENSITIVE_VALUE_PATTERNS) {
      if (pattern.test(value)) throw new Error(`Sensitive credential-like value detected at ${trail}.`);
    }
  }
}

function indexedById(value, label, expectedIds) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  const map = new Map();
  for (const item of value) {
    const record = requiredObject(item, `${label} record`);
    const id = requiredString(record.id, `${label}.id`, 100);
    if (map.has(id)) throw new Error(`Duplicate ${label} record ${id}.`);
    map.set(id, record);
  }
  const expected = new Set(expectedIds);
  for (const id of map.keys()) if (!expected.has(id)) throw new Error(`Unexpected ${label} record ${id}.`);
  for (const id of expected) if (!map.has(id)) throw new Error(`Missing required ${label} record ${id}.`);
  return map;
}

function validateControl(root, definition, control) {
  if (!APPLICABILITY.has(control.applicability)) throw new Error(`${definition.id}.applicability is invalid.`);
  if (!CONTROL_STATUS.has(control.status)) throw new Error(`${definition.id}.status is invalid.`);
  const required = definition.when(root);

  requireReference(control.ownerRef, `${definition.id}.ownerRef`);
  const checkedAt = requireTimestamp(control.checkedAt, `${definition.id}.checkedAt`);
  const revalidateBy = requireTimestamp(control.revalidateBy, `${definition.id}.revalidateBy`);
  if (Date.parse(revalidateBy) < Date.parse(checkedAt)) throw new Error(`${definition.id}.revalidateBy cannot precede checkedAt.`);

  if (!required) {
    if (control.applicability !== 'NOT_APPLICABLE' || control.status !== 'NOT_APPLICABLE') {
      throw new Error(`${definition.id} must be NOT_APPLICABLE for the approved scope.`);
    }
    requireReference(control.notApplicableRationaleRef, `${definition.id}.notApplicableRationaleRef`);
    requireReference(control.notApplicableApprovalRef, `${definition.id}.notApplicableApprovalRef`);
    return;
  }

  if (control.applicability !== 'APPLICABLE') throw new Error(`${definition.id} is mandatory for the approved scope.`);
  if (control.status !== 'PASS') throw new Error(`${definition.id} must PASS for final infrastructure acceptance.`);
  requireReference(control.evidenceRef, `${definition.id}.evidenceRef`);
}

function validateDestination(root, definition, destination, approvedRegions) {
  if (!APPLICABILITY.has(destination.applicability)) throw new Error(`${definition.id}.applicability is invalid.`);
  const required = definition.when(root);

  if (!required) {
    if (destination.applicability !== 'NOT_APPLICABLE') throw new Error(`${definition.id} must be NOT_APPLICABLE for the approved scope.`);
    if (Array.isArray(destination.regions) && destination.regions.length !== 0) throw new Error(`${definition.id}.regions must be empty when NOT_APPLICABLE.`);
    requireReference(destination.notApplicableRationaleRef, `${definition.id}.notApplicableRationaleRef`);
    requireReference(destination.notApplicableApprovalRef, `${definition.id}.notApplicableApprovalRef`);
    return;
  }

  if (destination.applicability !== 'APPLICABLE') throw new Error(`${definition.id} is mandatory for the approved scope.`);
  const regions = requireStringArray(destination.regions, `${definition.id}.regions`);
  for (const region of regions) {
    if (!approvedRegions.has(region)) throw new Error(`${definition.id} declares unapproved residency region ${region}.`);
  }
  requireReference(destination.evidenceRef, `${definition.id}.evidenceRef`);
}

function validateApprovals(value) {
  if (!Array.isArray(value)) throw new Error('approvals must be an array.');
  const map = new Map();
  for (const item of value) {
    const approval = requiredObject(item, 'approval');
    const role = requiredString(approval.role, 'approval.role', 80);
    if (map.has(role)) throw new Error(`Duplicate approval role ${role}.`);
    map.set(role, approval);
  }
  const allowed = new Set(APPROVAL_ROLES);
  for (const role of map.keys()) if (!allowed.has(role)) throw new Error(`Unexpected approval role ${role}.`);
  for (const role of APPROVAL_ROLES) {
    const approval = map.get(role);
    if (!approval) throw new Error(`Missing required ${role} approval.`);
    if (approval.decision !== 'APPROVE') throw new Error(`${role} approval decision must be APPROVE.`);
    requireReference(approval.approverRef, `${role}.approverRef`);
    requireReference(approval.evidenceRef, `${role}.evidenceRef`);
    requireTimestamp(approval.approvedAt, `${role}.approvedAt`);
  }
}

function validateContinuity(value) {
  const continuity = requiredObject(value, 'continuity');
  if (continuity.status !== 'PASS') throw new Error('continuity.status must be PASS.');
  const incidentDeclaredAt = requireTimestamp(continuity.incidentDeclaredAt, 'continuity.incidentDeclaredAt');
  const recoveryPointReferenceAt = requireTimestamp(continuity.recoveryPointReferenceAt, 'continuity.recoveryPointReferenceAt');
  const recoveredDataThroughAt = requireTimestamp(continuity.recoveredDataThroughAt, 'continuity.recoveredDataThroughAt');
  const acceptedHealthyAt = requireTimestamp(continuity.acceptedHealthyAt, 'continuity.acceptedHealthyAt');
  if (Date.parse(acceptedHealthyAt) < Date.parse(incidentDeclaredAt)) throw new Error('continuity.acceptedHealthyAt cannot precede incidentDeclaredAt.');

  const computedRpoMinutes = Math.max(0, (Date.parse(recoveryPointReferenceAt) - Date.parse(recoveredDataThroughAt)) / 60000);
  const computedRtoMinutes = (Date.parse(acceptedHealthyAt) - Date.parse(incidentDeclaredAt)) / 60000;
  const statedRpoMinutes = requireNonNegativeNumber(continuity.rpoMinutes, 'continuity.rpoMinutes');
  const statedRtoMinutes = requireNonNegativeNumber(continuity.rtoMinutes, 'continuity.rtoMinutes');
  if (Math.abs(statedRpoMinutes - computedRpoMinutes) > 0.1) throw new Error('continuity.rpoMinutes does not match supplied timestamps.');
  if (Math.abs(statedRtoMinutes - computedRtoMinutes) > 0.1) throw new Error('continuity.rtoMinutes does not match supplied timestamps.');
  if (computedRpoMinutes > MAX_RPO_MINUTES) throw new Error(`Measured RPO exceeds ${MAX_RPO_MINUTES} minutes.`);
  if (computedRtoMinutes > MAX_RTO_MINUTES) throw new Error(`Measured RTO exceeds ${MAX_RTO_MINUTES} minutes.`);

  requireReference(continuity.pitrEvidenceRef, 'continuity.pitrEvidenceRef');
  requireReference(continuity.restoreEvidenceRef, 'continuity.restoreEvidenceRef');
  requireReference(continuity.failoverEvidenceRef, 'continuity.failoverEvidenceRef');
  requireReference(continuity.integrityEvidenceRef, 'continuity.integrityEvidenceRef');
  requireReference(continuity.runbookRef, 'continuity.runbookRef');
  requireReference(continuity.operatorRef, 'continuity.operatorRef');
  return { rpoMinutes: computedRpoMinutes, rtoMinutes: computedRtoMinutes };
}

export async function validateEvidence(evidence, { checkoutSha = currentGitSha() } = {}) {
  const root = requiredObject(evidence, 'evidence');
  scanSensitiveData(root);
  if (root.schema !== 'carepoint.release-infrastructure-evidence/v1') throw new Error('Unsupported infrastructure evidence schema.');
  requireBoolean(root.sensitiveDataIncluded, 'sensitiveDataIncluded', false);
  requireBoolean(root.approved, 'approved', true);
  if (root.overallStatus !== 'PASS') throw new Error('overallStatus must be PASS for final infrastructure acceptance.');

  const release = requiredObject(root.release, 'release');
  const sourceSha = requireFullSha(release.sourceSha, 'release.sourceSha');
  const normalizedCheckout = requireFullSha(checkoutSha, 'checkoutSha');
  if (sourceSha !== normalizedCheckout) throw new Error(`release.sourceSha ${sourceSha} does not match checkout ${normalizedCheckout}.`);
  requireReference(release.releaseVersion, 'release.releaseVersion');
  requireDigest(release.apiArtifactDigest, 'release.apiArtifactDigest');
  requireDigest(release.adminArtifactDigest, 'release.adminArtifactDigest');
  requireReference(release.rcEvidenceRef, 'release.rcEvidenceRef');

  const environment = requiredObject(root.environment, 'environment');
  if (!ENVIRONMENT_CLASSIFICATIONS.has(environment.classification)) throw new Error('environment.classification must be production-equivalent or production.');
  requireReference(environment.id, 'environment.id');
  requireReference(environment.topologyEvidenceRef, 'environment.topologyEvidenceRef');
  requireReference(environment.changeApprovalRef, 'environment.changeApprovalRef');
  if (environment.classification === 'production') requireBoolean(environment.productionFaultOrValidationApproved, 'environment.productionFaultOrValidationApproved', true);

  const residency = requiredObject(root.residency, 'residency');
  requireReference(residency.jurisdiction, 'residency.jurisdiction');
  const primaryRegion = requiredString(residency.primaryRegion, 'residency.primaryRegion', 120);
  const approvedRegionValues = requireStringArray(residency.approvedRegions, 'residency.approvedRegions');
  const approvedRegions = new Set(approvedRegionValues);
  if (!approvedRegions.has(primaryRegion)) throw new Error('residency.primaryRegion must be listed in residency.approvedRegions.');
  requireReference(residency.approvalRef, 'residency.approvalRef');
  requireReference(residency.providerLocationEvidenceRef, 'residency.providerLocationEvidenceRef');

  const scope = requiredObject(root.scope, 'scope');
  for (const key of ['clinicalUploadsEnabled', 'dicomEnabled', 'fhirBulkEnabled', 'exportsEnabled']) requireBoolean(scope[key], `scope.${key}`);
  requireReference(scope.activationDecisionRef, 'scope.activationDecisionRef');

  const destinations = indexedById(root.dataDestinations, 'dataDestinations', DESTINATION_DEFINITIONS.map((item) => item.id));
  for (const definition of DESTINATION_DEFINITIONS) validateDestination(root, definition, destinations.get(definition.id), approvedRegions);

  const controls = indexedById(root.controls, 'controls', CONTROL_DEFINITIONS.map((item) => item.id));
  for (const definition of CONTROL_DEFINITIONS) validateControl(root, definition, controls.get(definition.id));

  const continuity = validateContinuity(root.continuity);
  validateApprovals(root.approvals);

  requireReference(root.finalEvidenceRef, 'finalEvidenceRef');
  requireTimestamp(root.acceptedAt, 'acceptedAt');

  return {
    schema: root.schema,
    sourceSha,
    environmentId: environment.id,
    classification: environment.classification,
    jurisdiction: residency.jurisdiction,
    primaryRegion,
    approvedRegions: approvedRegionValues,
    controlsPassed: CONTROL_DEFINITIONS.length,
    destinationsValidated: DESTINATION_DEFINITIONS.length,
    rpoMinutes: continuity.rpoMinutes,
    rtoMinutes: continuity.rtoMinutes,
    overallStatus: 'PASS',
    productionAcceptance: true,
  };
}

function validateTemplate(template) {
  const root = requiredObject(template, 'template');
  scanSensitiveData(root);
  if (root.schema !== 'carepoint.release-infrastructure-evidence/v1') throw new Error('Template uses an unsupported schema.');
  requireBoolean(root.sensitiveDataIncluded, 'template.sensitiveDataIncluded', false);
  requireBoolean(root.approved, 'template.approved', false);
  if (root.overallStatus !== 'DRAFT') throw new Error('Template overallStatus must remain DRAFT.');
  indexedById(root.dataDestinations, 'template.dataDestinations', DESTINATION_DEFINITIONS.map((item) => item.id));
  indexedById(root.controls, 'template.controls', CONTROL_DEFINITIONS.map((item) => item.id));
  if (!Array.isArray(root.approvals)) throw new Error('Template approvals must be an array.');
  const approvalRoles = root.approvals.map((item) => requiredString(requiredObject(item, 'template approval').role, 'template approval.role', 80));
  if (approvalRoles.length !== APPROVAL_ROLES.length || APPROVAL_ROLES.some((role) => !approvalRoles.includes(role))) throw new Error('Template must contain all required approval roles.');
  return {
    schema: root.schema,
    controls: CONTROL_DEFINITIONS.length,
    destinations: DESTINATION_DEFINITIONS.length,
    approvals: APPROVAL_ROLES.length,
    productionAcceptance: false,
  };
}

function makeSyntheticEvidence(checkoutSha) {
  const checkedAt = '2026-01-01T00:00:00Z';
  const revalidateBy = '2026-02-01T00:00:00Z';
  const controls = CONTROL_DEFINITIONS.map(({ id }) => ({
    id,
    applicability: 'APPLICABLE',
    status: 'PASS',
    ownerRef: `owner:${id}`,
    checkedAt,
    revalidateBy,
    evidenceRef: `evidence:${id}`,
  }));
  const dataDestinations = DESTINATION_DEFINITIONS.map(({ id }) => ({
    id,
    applicability: 'APPLICABLE',
    regions: ['region-a'],
    evidenceRef: `location-evidence:${id}`,
  }));
  return {
    schema: 'carepoint.release-infrastructure-evidence/v1',
    approved: true,
    overallStatus: 'PASS',
    sensitiveDataIncluded: false,
    release: {
      sourceSha: checkoutSha,
      releaseVersion: 'synthetic-self-test',
      apiArtifactDigest: `sha256:${'a'.repeat(64)}`,
      adminArtifactDigest: `sha256:${'b'.repeat(64)}`,
      rcEvidenceRef: 'evidence:rc',
    },
    environment: {
      id: 'synthetic-prod-equivalent',
      classification: 'production-equivalent',
      topologyEvidenceRef: 'evidence:topology',
      changeApprovalRef: 'approval:change',
      productionFaultOrValidationApproved: false,
    },
    residency: {
      jurisdiction: 'jurisdiction-a',
      primaryRegion: 'region-a',
      approvedRegions: ['region-a'],
      approvalRef: 'approval:residency',
      providerLocationEvidenceRef: 'evidence:provider-locations',
    },
    scope: {
      clinicalUploadsEnabled: true,
      dicomEnabled: true,
      fhirBulkEnabled: true,
      exportsEnabled: true,
      activationDecisionRef: 'approval:scope',
    },
    dataDestinations,
    controls,
    continuity: {
      status: 'PASS',
      incidentDeclaredAt: '2026-01-01T00:00:00Z',
      recoveryPointReferenceAt: '2026-01-01T00:10:00Z',
      recoveredDataThroughAt: '2026-01-01T00:05:00Z',
      acceptedHealthyAt: '2026-01-01T01:00:00Z',
      rpoMinutes: 5,
      rtoMinutes: 60,
      pitrEvidenceRef: 'evidence:pitr',
      restoreEvidenceRef: 'evidence:restore',
      failoverEvidenceRef: 'evidence:failover',
      integrityEvidenceRef: 'evidence:integrity',
      runbookRef: 'runbook:dr',
      operatorRef: 'operator:synthetic',
    },
    approvals: APPROVAL_ROLES.map((role) => ({
      role,
      decision: 'APPROVE',
      approverRef: `approver:${role.toLowerCase()}`,
      evidenceRef: `approval-evidence:${role.toLowerCase()}`,
      approvedAt: '2026-01-01T01:05:00Z',
    })),
    finalEvidenceRef: 'evidence:final',
    acceptedAt: '2026-01-01T01:10:00Z',
  };
}

async function expectReject(label, mutator, checkoutSha) {
  const evidence = makeSyntheticEvidence(checkoutSha);
  mutator(evidence);
  let rejected = false;
  try {
    await validateEvidence(evidence, { checkoutSha });
  } catch (_) {
    rejected = true;
  }
  if (!rejected) throw new Error(`Self-test expected rejection: ${label}`);
}

async function selfTest() {
  const checkoutSha = 'c'.repeat(40);
  const result = await validateEvidence(makeSyntheticEvidence(checkoutSha), { checkoutSha });
  if (result.overallStatus !== 'PASS' || result.rpoMinutes !== 5 || result.rtoMinutes !== 60) throw new Error('Synthetic PASS evidence did not validate as expected.');

  await expectReject('wrong source SHA', (value) => { value.release.sourceSha = 'd'.repeat(40); }, checkoutSha);
  await expectReject('unapproved residency region', (value) => { value.dataDestinations[0].regions = ['region-b']; }, checkoutSha);
  await expectReject('failed mandatory control', (value) => { value.controls[0].status = 'FAIL'; }, checkoutSha);
  await expectReject('missing mandatory control', (value) => { value.controls.pop(); }, checkoutSha);
  await expectReject('RPO above Release 1 ceiling', (value) => {
    value.continuity.recoveredDataThroughAt = '2025-12-31T23:40:00Z';
    value.continuity.rpoMinutes = 30;
  }, checkoutSha);
  await expectReject('RTO above Release 1 ceiling', (value) => {
    value.continuity.acceptedHealthyAt = '2026-01-01T02:30:00Z';
    value.continuity.rtoMinutes = 150;
  }, checkoutSha);
  await expectReject('missing approval', (value) => { value.approvals.pop(); }, checkoutSha);
  await expectReject('credential-like public evidence', (value) => { value.finalEvidenceRef = 'https://user:password@example.invalid/report'; }, checkoutSha);
  await expectReject('unapproved final record', (value) => { value.approved = false; }, checkoutSha);

  const optional = makeSyntheticEvidence(checkoutSha);
  optional.scope.dicomEnabled = false;
  const dicomControl = optional.controls.find((item) => item.id === 'dicom-pacs-security');
  dicomControl.applicability = 'NOT_APPLICABLE';
  dicomControl.status = 'NOT_APPLICABLE';
  delete dicomControl.evidenceRef;
  dicomControl.notApplicableRationaleRef = 'decision:dicom-disabled';
  dicomControl.notApplicableApprovalRef = 'approval:dicom-disabled';
  await validateEvidence(optional, { checkoutSha });

  console.log(`Release infrastructure evidence contract self-test passed (${CONTROL_DEFINITIONS.length} controls, ${DESTINATION_DEFINITIONS.length} destinations).`);
}

async function contractEvidence(templatePath, outputPath) {
  const scriptPath = fileURLToPath(import.meta.url);
  const [scriptContent, templateContent] = await Promise.all([readFile(scriptPath), readFile(templatePath)]);
  const template = JSON.parse(templateContent.toString('utf8'));
  const templateSummary = validateTemplate(template);
  const evidence = {
    schema: 'carepoint.release-infrastructure-contract/v1',
    sourceSha: currentGitSha(),
    evidenceSchema: templateSummary.schema,
    productionAcceptance: false,
    requiredControlCount: CONTROL_DEFINITIONS.length,
    requiredDestinationCount: DESTINATION_DEFINITIONS.length,
    requiredApprovalRoles: APPROVAL_ROLES,
    contractSha256: `sha256:${sha256(scriptContent)}`,
    templateSha256: `sha256:${sha256(templateContent)}`,
  };
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(evidence));
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--self-test') {
    await selfTest();
    return;
  }
  if (args.length === 2 && args[0] === '--validate-template') {
    const template = JSON.parse(await readFile(args[1], 'utf8'));
    console.log(JSON.stringify(validateTemplate(template)));
    return;
  }
  if (args.length === 3 && args[0] === '--contract-evidence') {
    await contractEvidence(args[1], args[2]);
    return;
  }
  if ((args.length === 2 || args.length === 4) && args[0] === '--validate') {
    const evidence = JSON.parse(await readFile(args[1], 'utf8'));
    const result = await validateEvidence(evidence);
    if (args.length === 4) {
      if (args[2] !== '--out') throw new Error('Expected --out <path>.');
      await writeFile(args[3], `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    }
    console.log(JSON.stringify(result));
    return;
  }
  throw new Error('Usage: --self-test | --validate-template <file> | --contract-evidence <template> <out> | --validate <evidence> [--out <result>]');
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
