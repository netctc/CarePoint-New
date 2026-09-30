import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';

const FULL_GIT_SHA = /^[0-9a-f]{40}$/i;
const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/i;
const ENVIRONMENT_CLASSIFICATIONS = new Set(['production-equivalent', 'production']);
const CASE_STATUS = new Set(['PASS', 'FAIL', 'BLOCKED', 'NOT_APPLICABLE']);
const APPLICABILITY = new Set(['APPLICABLE', 'NOT_APPLICABLE']);
const DEFECT_SEVERITY = new Set(['P0', 'P1', 'P2', 'P3']);
const DEFECT_STATE = new Set(['OPEN', 'CLOSED', 'ACCEPTED']);

const CASE_GROUPS = {
  Patient: [
    'UAT-PAT-001', 'UAT-PAT-002', 'UAT-PAT-003', 'UAT-PAT-004', 'UAT-PAT-005', 'UAT-PAT-006',
    'UAT-PAT-007', 'UAT-PAT-008', 'UAT-PAT-009', 'UAT-PAT-010', 'UAT-PAT-011', 'UAT-PAT-012',
    'UAT-PAT-013', 'UAT-PAT-014', 'UAT-PAT-015', 'UAT-PAT-016', 'UAT-PAT-017', 'UAT-PAT-018',
  ],
  Doctor: [
    'UAT-DOC-001', 'UAT-DOC-002', 'UAT-DOC-003', 'UAT-DOC-004', 'UAT-DOC-005', 'UAT-DOC-006',
    'UAT-DOC-007', 'UAT-DOC-008', 'UAT-DOC-009', 'UAT-DOC-010', 'UAT-DOC-011', 'UAT-DOC-012',
    'UAT-DOC-013', 'UAT-DOC-014',
  ],
  OtherProvider: [
    'UAT-OTH-001', 'UAT-OTH-002', 'UAT-OTH-003', 'UAT-OTH-004', 'UAT-OTH-005', 'UAT-OTH-006',
    'UAT-OTH-007', 'UAT-OTH-008', 'UAT-OTH-009',
  ],
  Admin: [
    'UAT-ADM-001', 'UAT-ADM-002', 'UAT-ADM-003', 'UAT-ADM-004', 'UAT-ADM-005', 'UAT-ADM-006',
    'UAT-ADM-007', 'UAT-ADM-008', 'UAT-ADM-009', 'UAT-ADM-010', 'UAT-ADM-011',
  ],
  CrossCutting: [
    'UAT-X-001', 'UAT-X-002', 'UAT-X-003', 'UAT-X-004', 'UAT-X-005', 'UAT-X-006',
    'UAT-X-007', 'UAT-X-008', 'UAT-X-009', 'UAT-X-010', 'UAT-X-011', 'UAT-X-012',
  ],
  Web05: ['UAT-WEB05-001'],
};

const ALL_CASE_IDS = Object.values(CASE_GROUPS).flat();
const JOURNEY_SIGNOFFS = ['Patient', 'Doctor', 'Other Provider', 'Admin'];
const APPROVAL_ROLES = ['UAT Lead', 'Product', 'Clinical', 'Operations', 'Security/Privacy'];

const CONDITIONAL_CASES = new Map([
  ['UAT-PAT-010', 'paymentsEnabled'],
  ['UAT-ADM-009', 'paymentsEnabled'],
  ['UAT-PAT-012', 'telemedicineEnabled'],
  ['UAT-DOC-009', 'telemedicineEnabled'],
  ['UAT-ADM-008', 'telemedicineEnabled'],
  ['UAT-X-008', 'telemedicineEnabled'],
  ['UAT-PAT-013', 'homeVisitEnabled'],
  ['UAT-OTH-006', 'homeVisitEnabled'],
  ['UAT-PAT-014', 'medicalTransportEnabled'],
  ['UAT-OTH-007', 'medicalTransportEnabled'],
  ['UAT-PAT-015', 'emergencyAmbulanceEnabled'],
  ['UAT-PAT-017', 'messagingEnabled'],
  ['UAT-DOC-013', 'messagingEnabled'],
]);

const FORBIDDEN_KEYS = new Set([
  'password', 'passphrase', 'clientsecret', 'apikey', 'accesstoken', 'refreshtoken', 'privatekey',
  'authorization', 'cookie', 'mfasecret', 'totpsecret', 'patientid', 'patientname', 'mrn', 'nationalid',
  'dateofbirth', 'dob', 'phivalue', 'rawrequest', 'requestbody', 'cardnumber', 'pan', 'cvv', 'credentialnumber',
]);

const SENSITIVE_VALUE_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/i,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  /https?:\/\/[^\s/@:]+:[^\s/@]+@/i,
  /[?&](?:token|access_token|api_key|apikey|secret|password)=([^&\s]+)/i,
  /\b(?:password|passphrase|client_secret|api_key|apikey|access_token|refresh_token)\s*[:=]\s*\S+/i,
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

function requireEnum(value, label, allowed) {
  const result = requiredString(value, label, 80);
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
  const parsed = Date.parse(result);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be an ISO-compatible timestamp.`);
  return { value: result, epoch: parsed };
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
  for (const [index, raw] of value.entries()) {
    const item = requiredObject(raw, `${label}[${index}]`);
    const id = requiredString(item.id, `${label}[${index}].id`, 100);
    if (map.has(id)) throw new Error(`${label} contains duplicate id ${id}.`);
    map.set(id, item);
  }
  const expected = new Set(expectedIds);
  const missing = expectedIds.filter((id) => !map.has(id));
  const unknown = [...map.keys()].filter((id) => !expected.has(id));
  if (missing.length || unknown.length) {
    throw new Error(`${label} ID mismatch; missing=[${missing.join(', ')}] unknown=[${unknown.join(', ')}].`);
  }
  return map;
}

function indexedByField(value, label, field, expectedValues) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  const map = new Map();
  for (const [index, raw] of value.entries()) {
    const item = requiredObject(raw, `${label}[${index}]`);
    const key = requiredString(item[field], `${label}[${index}].${field}`, 100);
    if (map.has(key)) throw new Error(`${label} contains duplicate ${field} ${key}.`);
    map.set(key, item);
  }
  const expected = new Set(expectedValues);
  const missing = expectedValues.filter((item) => !map.has(item));
  const unknown = [...map.keys()].filter((item) => !expected.has(item));
  if (missing.length || unknown.length) throw new Error(`${label} ${field} mismatch; missing=[${missing.join(', ')}] unknown=[${unknown.join(', ')}].`);
  return map;
}

function expectedApplicability(caseId, scope) {
  const scopeKey = CONDITIONAL_CASES.get(caseId);
  return scopeKey ? scope[scopeKey] : true;
}

async function validateEvidence(input, { checkoutSha = currentGitSha() } = {}) {
  const root = requiredObject(input, 'evidence');
  scanSensitiveData(root);

  if (requiredString(root.schema, 'schema', 100) !== 'carepoint.release-uat-evidence/v1') throw new Error('Unsupported UAT evidence schema.');
  requireBoolean(root.approved, 'approved', true);
  if (requiredString(root.overallStatus, 'overallStatus', 40) !== 'PASS') throw new Error('overallStatus must be PASS for accepted UAT evidence.');
  requireBoolean(root.sensitiveDataIncluded, 'sensitiveDataIncluded', false);
  requireBoolean(root.syntheticDataOnly, 'syntheticDataOnly', true);

  const release = requiredObject(root.release, 'release');
  const sourceSha = requireFullSha(release.sourceSha, 'release.sourceSha');
  if (sourceSha !== checkoutSha.toLowerCase()) throw new Error(`release.sourceSha ${sourceSha} does not match checkout ${checkoutSha}.`);
  requiredString(release.releaseVersion, 'release.releaseVersion', 100);
  requireDigest(release.rcEvidenceDigest, 'release.rcEvidenceDigest');
  requireReference(release.rcEvidenceRef, 'release.rcEvidenceRef');

  const environment = requiredObject(root.environment, 'environment');
  requiredString(environment.id, 'environment.id', 120);
  const classification = requireEnum(environment.classification, 'environment.classification', ENVIRONMENT_CLASSIFICATIONS);
  requireReference(environment.infrastructureAcceptanceRef, 'environment.infrastructureAcceptanceRef');
  requireReference(environment.externalIntegrationAcceptanceRef, 'environment.externalIntegrationAcceptanceRef');
  requireReference(environment.mobileAcceptanceRef, 'environment.mobileAcceptanceRef');

  const scope = requiredObject(root.scope, 'scope');
  requiredString(scope.jurisdiction, 'scope.jurisdiction', 120);
  requireReference(scope.activationDecisionRef, 'scope.activationDecisionRef');
  for (const key of ['paymentsEnabled', 'telemedicineEnabled', 'homeVisitEnabled', 'medicalTransportEnabled', 'emergencyAmbulanceEnabled', 'messagingEnabled']) {
    requireBoolean(scope[key], `scope.${key}`);
  }

  const cases = indexedById(root.cases, 'cases', ALL_CASE_IDS);
  let passCount = 0;
  let notApplicableCount = 0;
  let latestExecutionEpoch = 0;

  for (const caseId of ALL_CASE_IDS) {
    const item = cases.get(caseId);
    const applicability = requireEnum(item.applicability, `cases.${caseId}.applicability`, APPLICABILITY);
    const status = requireEnum(item.status, `cases.${caseId}.status`, CASE_STATUS);
    const shouldApply = expectedApplicability(caseId, scope);

    if (shouldApply) {
      if (applicability !== 'APPLICABLE') throw new Error(`${caseId} is mandatory for the declared launch scope.`);
      if (status !== 'PASS') throw new Error(`${caseId} must PASS for accepted UAT evidence; got ${status}.`);
      const executed = requireTimestamp(item.executedAt, `cases.${caseId}.executedAt`);
      latestExecutionEpoch = Math.max(latestExecutionEpoch, executed.epoch);
      requireReference(item.testerRef, `cases.${caseId}.testerRef`);
      requireReference(item.evidenceRef, `cases.${caseId}.evidenceRef`);
      passCount += 1;
    } else {
      if (applicability !== 'NOT_APPLICABLE' || status !== 'NOT_APPLICABLE') throw new Error(`${caseId} must be NOT_APPLICABLE because its launch capability is disabled.`);
      requireReference(item.notApplicableRationaleRef, `cases.${caseId}.notApplicableRationaleRef`);
      requireReference(item.notApplicableApprovalRef, `cases.${caseId}.notApplicableApprovalRef`);
      notApplicableCount += 1;
    }
  }

  if (!Array.isArray(root.defects)) throw new Error('defects must be an array.');
  let residualDefectCount = 0;
  for (const [index, raw] of root.defects.entries()) {
    const defect = requiredObject(raw, `defects[${index}]`);
    requireReference(defect.ref, `defects[${index}].ref`);
    const severity = requireEnum(defect.severity, `defects[${index}].severity`, DEFECT_SEVERITY);
    const state = requireEnum(defect.state, `defects[${index}].state`, DEFECT_STATE);
    if ((severity === 'P0' || severity === 'P1') && state !== 'CLOSED') throw new Error(`${defect.ref} is an unresolved ${severity} release-blocking UAT defect.`);
    if (state !== 'CLOSED') {
      requireReference(defect.dispositionRef, `defects[${index}].dispositionRef`);
      requireReference(defect.ownerRef, `defects[${index}].ownerRef`);
      requireTimestamp(defect.targetDate, `defects[${index}].targetDate`);
      residualDefectCount += 1;
    }
  }

  const journeySignoffs = indexedByField(root.journeySignoffs, 'journeySignoffs', 'journey', JOURNEY_SIGNOFFS);
  let latestApprovalEpoch = 0;
  for (const journey of JOURNEY_SIGNOFFS) {
    const item = journeySignoffs.get(journey);
    if (requiredString(item.decision, `journeySignoffs.${journey}.decision`, 40) !== 'APPROVE') throw new Error(`${journey} journey sign-off must APPROVE.`);
    requireReference(item.approverRef, `journeySignoffs.${journey}.approverRef`);
    requireReference(item.evidenceRef, `journeySignoffs.${journey}.evidenceRef`);
    const approvedAt = requireTimestamp(item.approvedAt, `journeySignoffs.${journey}.approvedAt`);
    latestApprovalEpoch = Math.max(latestApprovalEpoch, approvedAt.epoch);
  }

  const approvals = indexedByField(root.approvals, 'approvals', 'role', APPROVAL_ROLES);
  for (const role of APPROVAL_ROLES) {
    const item = approvals.get(role);
    if (requiredString(item.decision, `approvals.${role}.decision`, 40) !== 'APPROVE') throw new Error(`${role} approval must APPROVE.`);
    requireReference(item.approverRef, `approvals.${role}.approverRef`);
    requireReference(item.evidenceRef, `approvals.${role}.evidenceRef`);
    const approvedAt = requireTimestamp(item.approvedAt, `approvals.${role}.approvedAt`);
    latestApprovalEpoch = Math.max(latestApprovalEpoch, approvedAt.epoch);
  }

  requireReference(root.finalEvidenceRef, 'finalEvidenceRef');
  const acceptedAt = requireTimestamp(root.acceptedAt, 'acceptedAt');
  if (acceptedAt.epoch < latestExecutionEpoch) throw new Error('acceptedAt cannot predate the latest applicable UAT execution.');
  if (acceptedAt.epoch < latestApprovalEpoch) throw new Error('acceptedAt cannot predate required UAT approvals.');

  return {
    schema: root.schema,
    approved: true,
    overallStatus: 'PASS',
    sourceSha,
    environmentClassification: classification,
    jurisdiction: scope.jurisdiction,
    requiredCaseCount: ALL_CASE_IDS.length,
    passCount,
    notApplicableCount,
    residualDefectCount,
    journeySignoffCount: JOURNEY_SIGNOFFS.length,
    approvalCount: APPROVAL_ROLES.length,
    acceptedAt: acceptedAt.value,
  };
}

function validateTemplate(input) {
  const root = requiredObject(input, 'template');
  scanSensitiveData(root);
  if (requiredString(root.schema, 'template.schema', 100) !== 'carepoint.release-uat-evidence/v1') throw new Error('Unsupported UAT template schema.');
  requireBoolean(root.approved, 'template.approved', false);
  if (requiredString(root.overallStatus, 'template.overallStatus', 40) !== 'BLOCKED') throw new Error('Template overallStatus must remain BLOCKED.');
  requireBoolean(root.sensitiveDataIncluded, 'template.sensitiveDataIncluded', false);
  requireBoolean(root.syntheticDataOnly, 'template.syntheticDataOnly', true);
  indexedById(root.cases, 'template.cases', ALL_CASE_IDS);
  indexedByField(root.journeySignoffs, 'template.journeySignoffs', 'journey', JOURNEY_SIGNOFFS);
  indexedByField(root.approvals, 'template.approvals', 'role', APPROVAL_ROLES);
  return {
    schema: root.schema,
    requiredCaseCount: ALL_CASE_IDS.length,
    conditionalCaseCount: CONDITIONAL_CASES.size,
    journeySignoffs: JOURNEY_SIGNOFFS.length,
    approvals: APPROVAL_ROLES.length,
    productionAcceptance: false,
  };
}

function makeSyntheticEvidence(checkoutSha) {
  const executedAt = '2026-01-01T10:00:00Z';
  const approvedAt = '2026-01-01T11:00:00Z';
  return {
    schema: 'carepoint.release-uat-evidence/v1',
    approved: true,
    overallStatus: 'PASS',
    sensitiveDataIncluded: false,
    syntheticDataOnly: true,
    release: {
      sourceSha: checkoutSha,
      releaseVersion: 'synthetic-self-test',
      rcEvidenceDigest: `sha256:${'a'.repeat(64)}`,
      rcEvidenceRef: 'evidence:rc',
    },
    environment: {
      id: 'synthetic-prod-equivalent',
      classification: 'production-equivalent',
      infrastructureAcceptanceRef: 'evidence:r3',
      externalIntegrationAcceptanceRef: 'evidence:r4',
      mobileAcceptanceRef: 'evidence:r5',
    },
    scope: {
      jurisdiction: 'KSA-synthetic',
      activationDecisionRef: 'decision:scope',
      paymentsEnabled: true,
      telemedicineEnabled: true,
      homeVisitEnabled: true,
      medicalTransportEnabled: true,
      emergencyAmbulanceEnabled: true,
      messagingEnabled: true,
    },
    cases: ALL_CASE_IDS.map((id) => ({
      id,
      applicability: 'APPLICABLE',
      status: 'PASS',
      executedAt,
      testerRef: `tester:${id}`,
      evidenceRef: `evidence:${id}`,
    })),
    defects: [],
    journeySignoffs: JOURNEY_SIGNOFFS.map((journey) => ({
      journey,
      decision: 'APPROVE',
      approverRef: `approver:${journey.toLowerCase().replaceAll(' ', '-')}`,
      evidenceRef: `signoff:${journey.toLowerCase().replaceAll(' ', '-')}`,
      approvedAt,
    })),
    approvals: APPROVAL_ROLES.map((role) => ({
      role,
      decision: 'APPROVE',
      approverRef: `approver:${role.toLowerCase().replaceAll('/', '-').replaceAll(' ', '-')}`,
      evidenceRef: `approval:${role.toLowerCase().replaceAll('/', '-').replaceAll(' ', '-')}`,
      approvedAt,
    })),
    finalEvidenceRef: 'evidence:uat-final',
    acceptedAt: '2026-01-01T12:00:00Z',
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
  if (result.passCount !== ALL_CASE_IDS.length || result.overallStatus !== 'PASS') throw new Error('Synthetic PASS UAT evidence did not validate as expected.');

  await expectReject('wrong source SHA', (value) => { value.release.sourceSha = 'd'.repeat(40); }, checkoutSha);
  await expectReject('non-production-equivalent environment', (value) => { value.environment.classification = 'test'; }, checkoutSha);
  await expectReject('missing required UAT case', (value) => { value.cases.pop(); }, checkoutSha);
  await expectReject('blocked mandatory UAT case', (value) => { value.cases[0].status = 'BLOCKED'; }, checkoutSha);
  await expectReject('mandatory case marked not applicable', (value) => {
    value.cases[0].applicability = 'NOT_APPLICABLE';
    value.cases[0].status = 'NOT_APPLICABLE';
    value.cases[0].notApplicableRationaleRef = 'decision:no';
    value.cases[0].notApplicableApprovalRef = 'approval:no';
  }, checkoutSha);
  await expectReject('open P0 defect', (value) => {
    value.defects.push({ ref: 'issue:critical', severity: 'P0', state: 'OPEN', dispositionRef: 'decision:none', ownerRef: 'owner:test', targetDate: '2026-02-01' });
  }, checkoutSha);
  await expectReject('missing journey sign-off', (value) => { value.journeySignoffs.pop(); }, checkoutSha);
  await expectReject('missing approval', (value) => { value.approvals.pop(); }, checkoutSha);
  await expectReject('not approved', (value) => { value.approved = false; }, checkoutSha);
  await expectReject('credential-like evidence value', (value) => { value.finalEvidenceRef = 'https://user:password@example.invalid/evidence'; }, checkoutSha);

  const disabledEmergency = makeSyntheticEvidence(checkoutSha);
  disabledEmergency.scope.emergencyAmbulanceEnabled = false;
  const emergencyCase = disabledEmergency.cases.find((item) => item.id === 'UAT-PAT-015');
  emergencyCase.applicability = 'NOT_APPLICABLE';
  emergencyCase.status = 'NOT_APPLICABLE';
  delete emergencyCase.executedAt;
  delete emergencyCase.testerRef;
  delete emergencyCase.evidenceRef;
  emergencyCase.notApplicableRationaleRef = 'decision:emergency-disabled';
  emergencyCase.notApplicableApprovalRef = 'approval:emergency-disabled';
  const disabledResult = await validateEvidence(disabledEmergency, { checkoutSha });
  if (disabledResult.notApplicableCount !== 1) throw new Error('Disabled emergency UAT case did not validate as NOT_APPLICABLE.');

  console.log(`Release UAT evidence contract self-test passed (${ALL_CASE_IDS.length} cases, ${CONDITIONAL_CASES.size} launch-scope conditional cases).`);
}

async function contractEvidence(templatePath, outputPath) {
  const scriptPath = fileURLToPath(import.meta.url);
  const [scriptContent, templateContent] = await Promise.all([readFile(scriptPath), readFile(templatePath)]);
  const template = JSON.parse(templateContent.toString('utf8'));
  const templateSummary = validateTemplate(template);
  const evidence = {
    schema: 'carepoint.release-uat-contract/v1',
    sourceSha: currentGitSha(),
    evidenceSchema: templateSummary.schema,
    productionAcceptance: false,
    requiredCaseCount: ALL_CASE_IDS.length,
    conditionalCaseCount: CONDITIONAL_CASES.size,
    requiredJourneySignoffs: JOURNEY_SIGNOFFS,
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
