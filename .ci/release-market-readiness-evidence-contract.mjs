import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';

const FULL_GIT_SHA = /^[0-9a-f]{40}$/i;
const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/i;
const ENVIRONMENTS = new Set(['production-equivalent', 'production']);
const APPLICABILITY = new Set(['APPLICABLE', 'NOT_APPLICABLE']);
const CONTROL_STATUS = new Set(['PASS', 'FAIL', 'BLOCKED', 'NOT_APPLICABLE']);
const BLOCKER_STATUS = new Set(['CLOSED', 'FORMALLY_ACCEPTED']);
const WAIVER_STATUS = new Set(['ACCEPTED']);
const DECISIONS = new Set(['ENABLED', 'DISABLED']);
const DEPENDENCIES = ['R3', 'R4', 'R5', 'R6', 'R7', 'R8'];
const BLOCKING_ISSUES = ['#92', '#93', '#94'];
const APPROVAL_ROLES = [
  'Legal/Regulatory',
  'Privacy/Compliance',
  'Clinical Safety',
  'Operations',
  'Provider Governance',
  'Product/Market',
  'Release Authority',
];

const CONTROL_DEFINITIONS = [
  { id: 'R9-PRI-01', when: () => true },
  { id: 'R9-PRI-02', when: () => true },
  { id: 'R9-PRI-03', when: () => true },
  { id: 'R9-PRI-04', when: () => true },
  { id: 'R9-PRI-05', when: () => true },
  { id: 'R9-PRI-06', when: () => true },
  { id: 'R9-PRI-07', when: () => true },
  { id: 'R9-CLN-01', when: () => true },
  { id: 'R9-CLN-02', when: () => true },
  { id: 'R9-CLN-03', when: () => true },
  { id: 'R9-CLN-04', when: () => true },
  { id: 'R9-CLN-05', when: () => true },
  { id: 'R9-CLN-06', when: () => true },
  { id: 'R9-TEL-01', when: (root) => root.scope.telemedicineEnabled },
  { id: 'R9-TEL-02', when: (root) => root.scope.telemedicineEnabled },
  { id: 'R9-TEL-03', when: (root) => root.scope.telemedicineEnabled },
  { id: 'R9-TEL-04', when: (root) => root.scope.telemedicineEnabled },
  { id: 'R9-TEL-05', when: (root) => root.scope.telemedicineEnabled },
  { id: 'R9-TEL-06', when: (root) => root.scope.telemedicineEnabled },
  { id: 'R9-EMS-01', when: () => true },
  { id: 'R9-EMS-02', when: (root) => !root.scope.emergencyAmbulanceEnabled },
  { id: 'R9-EMS-03', when: (root) => root.scope.emergencyAmbulanceEnabled },
  { id: 'R9-EMS-04', when: (root) => root.scope.emergencyAmbulanceEnabled },
  { id: 'R9-EMS-05', when: (root) => root.scope.emergencyAmbulanceEnabled },
  { id: 'R9-EMS-06', when: (root) => root.scope.emergencyAmbulanceEnabled },
  { id: 'R9-EMS-07', when: (root) => root.scope.emergencyAmbulanceEnabled },
  { id: 'R9-EMS-08', when: () => true },
  { id: 'R9-MKT-01', when: (root) => root.scope.paymentsEnabled },
  { id: 'R9-MKT-02', when: () => true },
  { id: 'R9-MKT-03', when: (root) => root.scope.communicationsEnabled },
  { id: 'R9-MKT-04', when: () => true },
  { id: 'R9-MKT-05', when: () => true },
  { id: 'R9-MKT-06', when: () => true },
];

const FORBIDDEN_KEYS = new Set([
  'password', 'passphrase', 'clientsecret', 'apikey', 'accesstoken', 'refreshtoken', 'privatekey',
  'authorization', 'cookie', 'connectionstring', 'databaseurl', 'patientid', 'patientname', 'mrn',
  'nationalid', 'dateofbirth', 'dob', 'phivalue', 'rawrequest', 'requestbody', 'cardnumber', 'pan',
  'cvv', 'licenseidentifier', 'credentialnumber', 'licensenumber',
]);

const SENSITIVE_VALUE_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/i,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  /https?:\/\/[^\s/@:]+:[^\s/@]+@/i,
  /[?&](?:token|access_token|api_key|apikey|secret|password)=([^&\s]+)/i,
  /\b(?:password|passphrase|client_secret|api_key|apikey|access_token|refresh_token)\s*[:=]\s*\S+/i,
];

function command(name, args) {
  return execFileSync(name, args, { encoding: 'utf8' }).trim();
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

function requireEnum(value, label, allowed) {
  const result = requiredString(value, label, 100);
  if (!allowed.has(result)) throw new Error(`${label} must be one of ${[...allowed].join(', ')}.`);
  return result;
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
  const epoch = Date.parse(result);
  if (!Number.isFinite(epoch)) throw new Error(`${label} must be an ISO-compatible timestamp.`);
  return { value: result, epoch };
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

function indexedByField(value, label, field, expectedValues) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  const map = new Map();
  for (const [index, raw] of value.entries()) {
    const item = requiredObject(raw, `${label}[${index}]`);
    const key = requiredString(item[field], `${label}[${index}].${field}`, 120);
    if (map.has(key)) throw new Error(`${label} contains duplicate ${field} ${key}.`);
    map.set(key, item);
  }
  const expected = new Set(expectedValues);
  const missing = expectedValues.filter((item) => !map.has(item));
  const unknown = [...map.keys()].filter((item) => !expected.has(item));
  if (missing.length || unknown.length) throw new Error(`${label} ${field} mismatch; missing=[${missing.join(', ')}] unknown=[${unknown.join(', ')}].`);
  return map;
}

function validateDecisionBoundaries(root) {
  const telemedicine = requiredObject(root.telemedicine, 'telemedicine');
  const teleDecision = requireEnum(telemedicine.decision, 'telemedicine.decision', DECISIONS);
  if ((teleDecision === 'ENABLED') !== root.scope.telemedicineEnabled) throw new Error('telemedicine.decision must match scope.telemedicineEnabled.');
  requireReference(telemedicine.decisionRef, 'telemedicine.decisionRef');
  requireBoolean(telemedicine.recordingEnabled, 'telemedicine.recordingEnabled');
  if (telemedicine.recordingEnabled) {
    if (!root.scope.telemedicineEnabled) throw new Error('Telemedicine recording cannot be enabled when telemedicine is disabled.');
    requireReference(telemedicine.recordingPurposeApprovalRef, 'telemedicine.recordingPurposeApprovalRef');
    requireReference(telemedicine.recordingConsentApprovalRef, 'telemedicine.recordingConsentApprovalRef');
    requireReference(telemedicine.recordingRetentionApprovalRef, 'telemedicine.recordingRetentionApprovalRef');
    requireReference(telemedicine.recordingLocationApprovalRef, 'telemedicine.recordingLocationApprovalRef');
    requireReference(telemedicine.recordingAccessApprovalRef, 'telemedicine.recordingAccessApprovalRef');
  } else {
    requireReference(telemedicine.recordingDisabledEvidenceRef, 'telemedicine.recordingDisabledEvidenceRef');
  }

  const emergency = requiredObject(root.emergencyAmbulance, 'emergencyAmbulance');
  const emergencyDecision = requireEnum(emergency.decision, 'emergencyAmbulance.decision', DECISIONS);
  if ((emergencyDecision === 'ENABLED') !== root.scope.emergencyAmbulanceEnabled) throw new Error('emergencyAmbulance.decision must match scope.emergencyAmbulanceEnabled.');
  requireReference(emergency.decisionRef, 'emergencyAmbulance.decisionRef');
  if (emergencyDecision === 'ENABLED') {
    requireReference(emergency.licensedOperatorApprovalRef, 'emergencyAmbulance.licensedOperatorApprovalRef');
    requireReference(emergency.localApprovalRef, 'emergencyAmbulance.localApprovalRef');
    requireReference(emergency.support24x7EvidenceRef, 'emergencyAmbulance.support24x7EvidenceRef');
    requireReference(emergency.serviceAreaApprovalRef, 'emergencyAmbulance.serviceAreaApprovalRef');
    requireReference(emergency.fallbackSafetyApprovalRef, 'emergencyAmbulance.fallbackSafetyApprovalRef');
  } else {
    requireReference(emergency.routesDisabledEvidenceRef, 'emergencyAmbulance.routesDisabledEvidenceRef');
  }
}

async function validateEvidence(input, { checkoutSha = currentGitSha() } = {}) {
  const root = requiredObject(input, 'evidence');
  scanSensitiveData(root);
  if (requiredString(root.schema, 'schema', 120) !== 'carepoint.release-market-readiness-evidence/v1') throw new Error('Unsupported market-readiness evidence schema.');
  requireBoolean(root.approved, 'approved', true);
  if (requiredString(root.overallStatus, 'overallStatus', 40) !== 'PASS') throw new Error('overallStatus must be PASS for accepted market-readiness evidence.');
  requireBoolean(root.sensitiveDataIncluded, 'sensitiveDataIncluded', false);

  const release = requiredObject(root.release, 'release');
  const sourceSha = requireFullSha(release.sourceSha, 'release.sourceSha');
  if (sourceSha !== checkoutSha.toLowerCase()) throw new Error(`release.sourceSha ${sourceSha} does not match checkout ${checkoutSha}.`);
  requiredString(release.releaseVersion, 'release.releaseVersion', 100);
  requireDigest(release.rcEvidenceDigest, 'release.rcEvidenceDigest');
  requireReference(release.rcEvidenceRef, 'release.rcEvidenceRef');

  const environment = requiredObject(root.environment, 'environment');
  requiredString(environment.id, 'environment.id', 120);
  const environmentClassification = requireEnum(environment.classification, 'environment.classification', ENVIRONMENTS);

  const dependencies = indexedByField(root.dependencies, 'dependencies', 'id', DEPENDENCIES);
  for (const id of DEPENDENCIES) {
    const dependency = dependencies.get(id);
    if (requiredString(dependency.status, `dependencies.${id}.status`, 40) !== 'PASS') throw new Error(`${id} must be PASS before R9 acceptance.`);
    requireReference(dependency.evidenceRef, `dependencies.${id}.evidenceRef`);
  }

  const scope = requiredObject(root.scope, 'scope');
  requiredString(scope.jurisdiction, 'scope.jurisdiction', 120);
  requireReference(scope.launchEntityApprovalRef, 'scope.launchEntityApprovalRef');
  requireReference(scope.activationDecisionRef, 'scope.activationDecisionRef');
  for (const key of ['telemedicineEnabled', 'emergencyAmbulanceEnabled', 'paymentsEnabled', 'insuranceClaimsEnabled', 'fhirSmartEnabled', 'communicationsEnabled']) {
    requireBoolean(scope[key], `scope.${key}`);
  }
  requireReference(scope.interoperabilityObligationDecisionRef, 'scope.interoperabilityObligationDecisionRef');
  requireReference(scope.providerPolicyVersionRef, 'scope.providerPolicyVersionRef');
  requireReference(scope.privacyPolicyVersionRef, 'scope.privacyPolicyVersionRef');

  validateDecisionBoundaries(root);

  const controls = indexedByField(root.controls, 'controls', 'id', CONTROL_DEFINITIONS.map(({ id }) => id));
  let passCount = 0;
  let notApplicableCount = 0;
  let latestControlEpoch = 0;
  for (const definition of CONTROL_DEFINITIONS) {
    const item = controls.get(definition.id);
    const applicability = requireEnum(item.applicability, `controls.${definition.id}.applicability`, APPLICABILITY);
    const status = requireEnum(item.status, `controls.${definition.id}.status`, CONTROL_STATUS);
    const shouldApply = definition.when(root);
    if (shouldApply) {
      if (applicability !== 'APPLICABLE') throw new Error(`${definition.id} is mandatory for the declared launch scope.`);
      if (status !== 'PASS') throw new Error(`${definition.id} must PASS for accepted market readiness; got ${status}.`);
      requireReference(item.ownerRoleRef, `controls.${definition.id}.ownerRoleRef`);
      requireReference(item.evidenceRef, `controls.${definition.id}.evidenceRef`);
      const accepted = requireTimestamp(item.acceptedAt, `controls.${definition.id}.acceptedAt`);
      latestControlEpoch = Math.max(latestControlEpoch, accepted.epoch);
      passCount += 1;
    } else {
      if (applicability !== 'NOT_APPLICABLE' || status !== 'NOT_APPLICABLE') throw new Error(`${definition.id} must be NOT_APPLICABLE for the disabled launch capability.`);
      requireReference(item.notApplicableRationaleRef, `controls.${definition.id}.notApplicableRationaleRef`);
      requireReference(item.notApplicableApprovalRef, `controls.${definition.id}.notApplicableApprovalRef`);
      notApplicableCount += 1;
    }
  }

  const blockers = indexedByField(root.blockingIssues, 'blockingIssues', 'id', BLOCKING_ISSUES);
  for (const id of BLOCKING_ISSUES) {
    const blocker = blockers.get(id);
    const status = requireEnum(blocker.status, `blockingIssues.${id}.status`, BLOCKER_STATUS);
    requireReference(blocker.evidenceRef, `blockingIssues.${id}.evidenceRef`);
    if (status === 'FORMALLY_ACCEPTED') {
      requireReference(blocker.acceptanceAuthorityRef, `blockingIssues.${id}.acceptanceAuthorityRef`);
      requireReference(blocker.residualRiskRef, `blockingIssues.${id}.residualRiskRef`);
      requireTimestamp(blocker.reviewBy, `blockingIssues.${id}.reviewBy`);
    }
  }

  if (!Array.isArray(root.waivers)) throw new Error('waivers must be an array.');
  for (const [index, raw] of root.waivers.entries()) {
    const waiver = requiredObject(raw, `waivers[${index}]`);
    requireReference(waiver.ref, `waivers[${index}].ref`);
    requireEnum(waiver.status, `waivers[${index}].status`, WAIVER_STATUS);
    requireReference(waiver.authorityRef, `waivers[${index}].authorityRef`);
    requireReference(waiver.ownerRef, `waivers[${index}].ownerRef`);
    requireReference(waiver.residualRiskRef, `waivers[${index}].residualRiskRef`);
    requireTimestamp(waiver.reviewBy, `waivers[${index}].reviewBy`);
  }

  const approvals = indexedByField(root.approvals, 'approvals', 'role', APPROVAL_ROLES);
  let latestApprovalEpoch = 0;
  for (const role of APPROVAL_ROLES) {
    const approval = approvals.get(role);
    if (requiredString(approval.decision, `approvals.${role}.decision`, 40) !== 'APPROVE') throw new Error(`${role} approval must APPROVE.`);
    requireReference(approval.approverRef, `approvals.${role}.approverRef`);
    requireReference(approval.evidenceRef, `approvals.${role}.evidenceRef`);
    const approvedAt = requireTimestamp(approval.approvedAt, `approvals.${role}.approvedAt`);
    latestApprovalEpoch = Math.max(latestApprovalEpoch, approvedAt.epoch);
  }

  requireReference(root.finalDecisionRef, 'finalDecisionRef');
  const acceptedAt = requireTimestamp(root.acceptedAt, 'acceptedAt');
  if (acceptedAt.epoch < latestControlEpoch) throw new Error('acceptedAt cannot predate the latest applicable R9 control acceptance.');
  if (acceptedAt.epoch < latestApprovalEpoch) throw new Error('acceptedAt cannot predate required R9 approvals.');

  return {
    schema: root.schema,
    approved: true,
    overallStatus: 'PASS',
    sourceSha,
    environmentClassification,
    jurisdiction: scope.jurisdiction,
    requiredControlCount: CONTROL_DEFINITIONS.length,
    passCount,
    notApplicableCount,
    dependencyCount: DEPENDENCIES.length,
    blockingIssueCount: BLOCKING_ISSUES.length,
    approvalCount: APPROVAL_ROLES.length,
    waiverCount: root.waivers.length,
    telemedicineDecision: root.telemedicine.decision,
    emergencyAmbulanceDecision: root.emergencyAmbulance.decision,
    acceptedAt: acceptedAt.value,
  };
}

function validateTemplate(input) {
  const root = requiredObject(input, 'template');
  scanSensitiveData(root);
  if (requiredString(root.schema, 'template.schema', 120) !== 'carepoint.release-market-readiness-evidence/v1') throw new Error('Unsupported market-readiness template schema.');
  requireBoolean(root.approved, 'template.approved', false);
  if (requiredString(root.overallStatus, 'template.overallStatus', 40) !== 'BLOCKED') throw new Error('Template overallStatus must remain BLOCKED.');
  requireBoolean(root.sensitiveDataIncluded, 'template.sensitiveDataIncluded', false);
  indexedByField(root.dependencies, 'template.dependencies', 'id', DEPENDENCIES);
  indexedByField(root.controls, 'template.controls', 'id', CONTROL_DEFINITIONS.map(({ id }) => id));
  indexedByField(root.blockingIssues, 'template.blockingIssues', 'id', BLOCKING_ISSUES);
  indexedByField(root.approvals, 'template.approvals', 'role', APPROVAL_ROLES);
  return {
    schema: root.schema,
    requiredControlCount: CONTROL_DEFINITIONS.length,
    dependencyCount: DEPENDENCIES.length,
    blockingIssueCount: BLOCKING_ISSUES.length,
    approvalCount: APPROVAL_ROLES.length,
    productionAcceptance: false,
  };
}

function buildControl(definition, root, acceptedAt) {
  if (definition.when(root)) {
    return {
      id: definition.id,
      applicability: 'APPLICABLE',
      status: 'PASS',
      ownerRoleRef: `owner:${definition.id}`,
      evidenceRef: `evidence:${definition.id}`,
      acceptedAt,
    };
  }
  return {
    id: definition.id,
    applicability: 'NOT_APPLICABLE',
    status: 'NOT_APPLICABLE',
    notApplicableRationaleRef: `decision:${definition.id}-not-applicable`,
    notApplicableApprovalRef: `approval:${definition.id}-not-applicable`,
  };
}

function makeSyntheticEvidence(checkoutSha) {
  const acceptedAt = '2026-01-01T10:00:00Z';
  const approvedAt = '2026-01-01T11:00:00Z';
  const root = {
    schema: 'carepoint.release-market-readiness-evidence/v1',
    approved: true,
    overallStatus: 'PASS',
    sensitiveDataIncluded: false,
    release: {
      sourceSha: checkoutSha,
      releaseVersion: 'synthetic-self-test',
      rcEvidenceDigest: `sha256:${'a'.repeat(64)}`,
      rcEvidenceRef: 'evidence:rc',
    },
    environment: { id: 'synthetic-prod-equivalent', classification: 'production-equivalent' },
    dependencies: DEPENDENCIES.map((id) => ({ id, status: 'PASS', evidenceRef: `evidence:${id.toLowerCase()}` })),
    scope: {
      jurisdiction: 'KSA-synthetic',
      launchEntityApprovalRef: 'approval:launch-entity',
      activationDecisionRef: 'approval:launch-scope',
      telemedicineEnabled: true,
      emergencyAmbulanceEnabled: true,
      paymentsEnabled: true,
      insuranceClaimsEnabled: true,
      fhirSmartEnabled: true,
      communicationsEnabled: true,
      interoperabilityObligationDecisionRef: 'decision:interoperability',
      providerPolicyVersionRef: 'policy:provider-v1',
      privacyPolicyVersionRef: 'policy:privacy-v1',
    },
    telemedicine: {
      decision: 'ENABLED',
      decisionRef: 'approval:telemedicine',
      recordingEnabled: false,
      recordingDisabledEvidenceRef: 'evidence:recording-disabled',
    },
    emergencyAmbulance: {
      decision: 'ENABLED',
      decisionRef: 'approval:emergency',
      licensedOperatorApprovalRef: 'approval:licensed-operator',
      localApprovalRef: 'approval:local-emergency',
      support24x7EvidenceRef: 'evidence:24x7',
      serviceAreaApprovalRef: 'approval:service-area',
      fallbackSafetyApprovalRef: 'approval:fallback-safety',
    },
    controls: [],
    blockingIssues: BLOCKING_ISSUES.map((id) => ({ id, status: 'CLOSED', evidenceRef: `issue:${id.slice(1)}-closed` })),
    waivers: [],
    approvals: APPROVAL_ROLES.map((role) => ({
      role,
      decision: 'APPROVE',
      approverRef: `approver:${role.toLowerCase().replaceAll('/', '-').replaceAll(' ', '-')}`,
      evidenceRef: `approval:${role.toLowerCase().replaceAll('/', '-').replaceAll(' ', '-')}`,
      approvedAt,
    })),
    finalDecisionRef: 'decision:r9-final',
    acceptedAt: '2026-01-01T12:00:00Z',
  };
  root.controls = CONTROL_DEFINITIONS.map((definition) => buildControl(definition, root, acceptedAt));
  return root;
}

function refreshControlApplicability(root, prefix) {
  for (const definition of CONTROL_DEFINITIONS.filter(({ id }) => id.startsWith(prefix))) {
    const index = root.controls.findIndex(({ id }) => id === definition.id);
    root.controls[index] = buildControl(definition, root, '2026-01-01T10:00:00Z');
  }
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
  if (result.passCount + result.notApplicableCount !== CONTROL_DEFINITIONS.length || result.overallStatus !== 'PASS') throw new Error('Synthetic PASS evidence did not validate as expected.');

  await expectReject('wrong source SHA', (value) => { value.release.sourceSha = 'd'.repeat(40); }, checkoutSha);
  await expectReject('failed inherited gate', (value) => { value.dependencies[0].status = 'BLOCKED'; }, checkoutSha);
  await expectReject('missing R9 control', (value) => { value.controls.pop(); }, checkoutSha);
  await expectReject('blocked mandatory R9 control', (value) => { value.controls[0].status = 'BLOCKED'; }, checkoutSha);
  await expectReject('open R9 blocker', (value) => { value.blockingIssues[0].status = 'OPEN'; }, checkoutSha);
  await expectReject('emergency enabled without licensed operator approval', (value) => { delete value.emergencyAmbulance.licensedOperatorApprovalRef; }, checkoutSha);
  await expectReject('recording enabled without dedicated approvals', (value) => {
    value.telemedicine.recordingEnabled = true;
    delete value.telemedicine.recordingDisabledEvidenceRef;
  }, checkoutSha);
  await expectReject('missing approval authority', (value) => { value.approvals.pop(); }, checkoutSha);
  await expectReject('credential-like public evidence', (value) => { value.finalDecisionRef = 'https://user:password@example.invalid/evidence'; }, checkoutSha);

  const disabledTelemedicine = makeSyntheticEvidence(checkoutSha);
  disabledTelemedicine.scope.telemedicineEnabled = false;
  disabledTelemedicine.telemedicine.decision = 'DISABLED';
  disabledTelemedicine.telemedicine.decisionRef = 'decision:telemedicine-disabled';
  refreshControlApplicability(disabledTelemedicine, 'R9-TEL-');
  const telemedicineResult = await validateEvidence(disabledTelemedicine, { checkoutSha });
  if (telemedicineResult.passCount + telemedicineResult.notApplicableCount !== CONTROL_DEFINITIONS.length) throw new Error('Disabled telemedicine applicability did not validate.');

  const disabledEmergency = makeSyntheticEvidence(checkoutSha);
  disabledEmergency.scope.emergencyAmbulanceEnabled = false;
  disabledEmergency.emergencyAmbulance = {
    decision: 'DISABLED',
    decisionRef: 'decision:emergency-disabled',
    routesDisabledEvidenceRef: 'evidence:emergency-routes-disabled',
  };
  refreshControlApplicability(disabledEmergency, 'R9-EMS-');
  const emergencyResult = await validateEvidence(disabledEmergency, { checkoutSha });
  if (emergencyResult.passCount + emergencyResult.notApplicableCount !== CONTROL_DEFINITIONS.length) throw new Error('Disabled emergency applicability did not validate.');

  console.log(`Release market-readiness evidence contract self-test passed (${CONTROL_DEFINITIONS.length} controls, ${APPROVAL_ROLES.length} approval roles).`);
}

async function contractEvidence(templatePath, outputPath) {
  const scriptPath = fileURLToPath(import.meta.url);
  const [scriptContent, templateContent] = await Promise.all([readFile(scriptPath), readFile(templatePath)]);
  const template = JSON.parse(templateContent.toString('utf8'));
  const summary = validateTemplate(template);
  const evidence = {
    schema: 'carepoint.release-market-readiness-contract/v1',
    sourceSha: currentGitSha(),
    evidenceSchema: summary.schema,
    productionAcceptance: false,
    legalApprovalExecuted: false,
    clinicalSafetyApprovalExecuted: false,
    requiredControlCount: CONTROL_DEFINITIONS.length,
    requiredDependencies: DEPENDENCIES,
    requiredBlockingIssues: BLOCKING_ISSUES,
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
