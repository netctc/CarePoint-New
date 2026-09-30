import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';

const FULL_GIT_SHA = /^[0-9a-f]{40}$/i;
const CANONICAL_SOURCE_BRANCH = 'release/release-1-integration-go-live-readiness';
const TARGET_BRANCH = 'main';
const SCHEMA = 'carepoint.release-promotion-policy-evidence/v1';
const PASS = 'PASS';
const CHECK_STATUSES = ['PASS', 'FAIL', 'PENDING', 'BLOCKED'];
const REQUIRED_CHECKS = [
  'node',
  'flutter',
  'Repository Security Gate',
  'CodeQL SAST (javascript-typescript)',
  'CodeQL',
  'PostgreSQL 16 Backup Restore Drill',
  'fhir',
  'evidence',
  'R3 infrastructure evidence contract',
  'R4 external-provider evidence contract',
  'R5 signed mobile release evidence contract',
  'R6 promotion policy evidence contract',
  'R7 UAT evidence contract',
  'R8 performance harness contract',
  'R8 resilience rehearsal contract',
  'R9 market readiness evidence contract',
  'R10 deployment rehearsal contract',
];
const VERIFICATION_TESTS = [
  'directPushDenied',
  'failingRequiredCheckBlocksMerge',
  'approvalRequired',
  'forcePushDenied',
  'deletionDenied',
  'passingApprovedPullRequestPath',
];
const SENSITIVE_KEYS = new Set([
  'password', 'passphrase', 'clientsecret', 'apikey', 'accesstoken', 'refreshtoken',
  'privatekey', 'authorization', 'cookie', 'databaseurl', 'connectionstring',
  'patientid', 'patientname', 'mrn', 'nationalid', 'dateofbirth', 'dob', 'phivalue',
]);
const SENSITIVE_VALUE_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/i,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  /https?:\/\/[^\s/@:]+:[^\s/@]+@/i,
  /[?&](?:token|access_token|api_key|apikey|secret|password)=([^&\s]+)/i,
];

function currentGitSha() {
  const value = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim().toLowerCase();
  if (!FULL_GIT_SHA.test(value)) throw new Error('Unable to resolve current full Git SHA.');
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
  if (result.length > maxLength || /[\r\n\0]/.test(result)) throw new Error(`${label} must be one line and <= ${maxLength} characters.`);
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

function requireInteger(value, label, minimum = 0) {
  if (!Number.isInteger(value) || value < minimum) throw new Error(`${label} must be an integer >= ${minimum}.`);
  return value;
}

function requireEnum(value, label, allowed) {
  const result = requiredString(value, label, 120);
  if (!allowed.includes(result)) throw new Error(`${label} must be one of: ${allowed.join(', ')}.`);
  return result;
}

function requireFullSha(value, label) {
  const result = requiredString(value, label, 40).toLowerCase();
  if (!FULL_GIT_SHA.test(result)) throw new Error(`${label} must be a full 40-hex Git SHA.`);
  return result;
}

function requireTimestamp(value, label) {
  const result = requiredString(value, label, 80);
  if (!Number.isFinite(Date.parse(result))) throw new Error(`${label} must be an ISO-compatible timestamp.`);
  return result;
}

function scanSensitiveData(value, trail = 'evidence') {
  if (Array.isArray(value)) {
    value.forEach((child, index) => scanSensitiveData(child, `${trail}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (SENSITIVE_KEYS.has(normalized)) throw new Error(`Sensitive/PHI-like key ${trail}.${key} is not allowed.`);
      scanSensitiveData(child, `${trail}.${key}`);
    }
    return;
  }
  if (typeof value === 'string') {
    for (const pattern of SENSITIVE_VALUE_PATTERNS) {
      if (pattern.test(value)) throw new Error(`Credential-like value detected at ${trail}.`);
    }
  }
}

function validateRelease(root, { accepted, checkoutSha }) {
  const release = requiredObject(root.release, 'release');
  const sourceSha = requireFullSha(release.sourceSha, 'release.sourceSha');
  if (requiredString(release.sourceBranch, 'release.sourceBranch', 150) !== CANONICAL_SOURCE_BRANCH) {
    throw new Error(`release.sourceBranch must be ${CANONICAL_SOURCE_BRANCH}.`);
  }
  if (requiredString(release.targetBranch, 'release.targetBranch', 100) !== TARGET_BRANCH) {
    throw new Error(`release.targetBranch must be ${TARGET_BRANCH}.`);
  }
  requireReference(release.releaseCandidateEvidenceRef, 'release.releaseCandidateEvidenceRef');
  if (accepted && sourceSha !== checkoutSha.toLowerCase()) {
    throw new Error(`release.sourceSha ${sourceSha} does not match checkout ${checkoutSha}.`);
  }
  return sourceSha;
}

function validateBranchProtection(value, label, accepted) {
  const branch = requiredObject(value, label);
  requireBoolean(branch.protected, `${label}.protected`, accepted ? true : undefined);
  const mechanism = requireEnum(branch.mechanism, `${label}.mechanism`, ['RULESET', 'BRANCH_PROTECTION', 'PENDING']);
  requireReference(branch.configurationEvidenceRef, `${label}.configurationEvidenceRef`);
  if (accepted && mechanism === 'PENDING') throw new Error(`${label}.mechanism cannot be PENDING for accepted evidence.`);
}

function validateRepositoryProtection(root, accepted) {
  const protection = requiredObject(root.repositoryProtection, 'repositoryProtection');
  validateBranchProtection(protection.main, 'repositoryProtection.main', accepted);
  validateBranchProtection(protection.release, 'repositoryProtection.release', accepted);
  requireReference(protection.rulesetOrProtectionSnapshotRef, 'repositoryProtection.rulesetOrProtectionSnapshotRef');
}

function validatePolicy(root, accepted) {
  const policy = requiredObject(root.policy, 'policy');
  requireBoolean(policy.pullRequestRequired, 'policy.pullRequestRequired', accepted ? true : undefined);
  requireBoolean(policy.directPushAllowed, 'policy.directPushAllowed', accepted ? false : undefined);
  requireInteger(policy.minimumApprovals, 'policy.minimumApprovals', accepted ? 1 : 0);
  requireBoolean(policy.dismissStaleApprovals, 'policy.dismissStaleApprovals', accepted ? true : undefined);
  requireBoolean(policy.requireConversationResolution, 'policy.requireConversationResolution', accepted ? true : undefined);
  requireBoolean(policy.allowForcePushes, 'policy.allowForcePushes', accepted ? false : undefined);
  requireBoolean(policy.allowDeletions, 'policy.allowDeletions', accepted ? false : undefined);
  const bypass = requireEnum(policy.adminBypassPolicy, 'policy.adminBypassPolicy', ['DENY_BY_DEFAULT', 'BREAK_GLASS_RECORDED', 'PENDING']);
  requireReference(policy.policyApprovalRef, 'policy.policyApprovalRef');
  if (accepted && bypass === 'PENDING') throw new Error('policy.adminBypassPolicy cannot be PENDING for accepted evidence.');
  if (accepted && bypass === 'BREAK_GLASS_RECORDED') {
    requireReference(policy.breakGlassAuthorityRef, 'policy.breakGlassAuthorityRef');
    requireReference(policy.breakGlassAuditProcedureRef, 'policy.breakGlassAuditProcedureRef');
  }
}

function validateRequiredChecks(value, accepted) {
  if (!Array.isArray(value)) throw new Error('requiredChecks must be an array.');
  const checks = new Map();
  for (const [index, raw] of value.entries()) {
    const item = requiredObject(raw, `requiredChecks[${index}]`);
    const name = requiredString(item.name, `requiredChecks[${index}].name`, 160);
    if (checks.has(name)) throw new Error(`Duplicate required check: ${name}.`);
    const status = requireEnum(item.status, `requiredChecks[${index}].status`, CHECK_STATUSES);
    requireReference(item.evidenceRef, `requiredChecks[${index}].evidenceRef`);
    checks.set(name, status);
  }
  const missing = REQUIRED_CHECKS.filter((name) => !checks.has(name));
  if (missing.length) throw new Error(`Missing mandatory promotion checks: ${missing.join(', ')}.`);
  if (accepted) {
    for (const name of REQUIRED_CHECKS) {
      if (checks.get(name) !== PASS) throw new Error(`Mandatory promotion check ${name} must be PASS.`);
    }
  }
  return checks;
}

function validateSecurity(root, accepted, checks) {
  const security = requiredObject(root.security, 'security');
  requireBoolean(security.independentCodeQLRequired, 'security.independentCodeQLRequired', true);
  const codeqlStatus = requireEnum(security.independentCodeQLStatus, 'security.independentCodeQLStatus', CHECK_STATUSES);
  requireInteger(security.unresolvedCriticalOrHighFindings, 'security.unresolvedCriticalOrHighFindings', 0);
  if (requiredString(security.blockingIssue, 'security.blockingIssue', 40) !== '#124') {
    throw new Error('security.blockingIssue must be #124.');
  }
  const disposition = requireEnum(security.blockerDisposition, 'security.blockerDisposition', ['OPEN', 'CLOSED', 'FORMALLY_ACCEPTED']);
  requireReference(security.dispositionEvidenceRef, 'security.dispositionEvidenceRef');
  if (accepted) {
    if (codeqlStatus !== PASS || checks.get('CodeQL') !== PASS) throw new Error('Independent CodeQL check must PASS for accepted promotion evidence.');
    if (security.unresolvedCriticalOrHighFindings !== 0) throw new Error('No unresolved Critical/High security findings are allowed.');
    if (!['CLOSED', 'FORMALLY_ACCEPTED'].includes(disposition)) throw new Error('#124 must be CLOSED or FORMALLY_ACCEPTED.');
    if (disposition === 'FORMALLY_ACCEPTED') {
      requireReference(security.acceptanceAuthorityRef, 'security.acceptanceAuthorityRef');
      requireReference(security.residualRiskRef, 'security.residualRiskRef');
      requireTimestamp(security.reviewBy, 'security.reviewBy');
    }
  }
}

function validateVerificationTests(root, accepted) {
  const tests = requiredObject(root.verificationTests, 'verificationTests');
  for (const name of VERIFICATION_TESTS) {
    const item = requiredObject(tests[name], `verificationTests.${name}`);
    const status = requireEnum(item.status, `verificationTests.${name}.status`, CHECK_STATUSES);
    requireReference(item.evidenceRef, `verificationTests.${name}.evidenceRef`);
    if (accepted && status !== PASS) throw new Error(`verificationTests.${name} must PASS.`);
  }
}

function validateAuthorization(root, accepted) {
  const authorization = requiredObject(root.promotionAuthorization, 'promotionAuthorization');
  requireBoolean(authorization.authorized, 'promotionAuthorization.authorized', accepted);
  if (requiredString(authorization.authorityRole, 'promotionAuthorization.authorityRole', 120) !== 'Release Authority') {
    throw new Error('promotionAuthorization.authorityRole must be Release Authority.');
  }
  requireReference(authorization.approvalRef, 'promotionAuthorization.approvalRef');
  if (accepted) requireTimestamp(authorization.approvedAt, 'promotionAuthorization.approvedAt');
}

function validateEvidence(input, { accepted, checkoutSha = currentGitSha() }) {
  const root = requiredObject(input, 'evidence');
  scanSensitiveData(root);
  if (requiredString(root.schema, 'schema', 120) !== SCHEMA) throw new Error(`schema must be ${SCHEMA}.`);
  requireBoolean(root.approved, 'approved', accepted);
  const expectedStatus = accepted ? PASS : 'BLOCKED';
  if (requiredString(root.overallStatus, 'overallStatus', 40) !== expectedStatus) throw new Error(`overallStatus must be ${expectedStatus}.`);
  requireBoolean(root.sensitiveDataIncluded, 'sensitiveDataIncluded', false);

  const sourceSha = validateRelease(root, { accepted, checkoutSha });
  validateRepositoryProtection(root, accepted);
  validatePolicy(root, accepted);
  const checks = validateRequiredChecks(root.requiredChecks, accepted);
  validateSecurity(root, accepted, checks);
  validateVerificationTests(root, accepted);
  validateAuthorization(root, accepted);

  return {
    schema: SCHEMA,
    approved: accepted,
    overallStatus: expectedStatus,
    sourceSha,
    sourceBranch: CANONICAL_SOURCE_BRANCH,
    targetBranch: TARGET_BRANCH,
    requiredCheckCount: REQUIRED_CHECKS.length,
    promotionAuthorized: accepted,
    repositoryProtectionApplied: accepted,
    codeqlStatus: checks.get('CodeQL'),
  };
}

function validateAcceptedEvidence(input, options = {}) {
  return validateEvidence(input, { accepted: true, ...options });
}

function validateBlockedTemplate(input, options = {}) {
  return validateEvidence(input, { accepted: false, ...options });
}

function buildAcceptedFixture(sha) {
  const check = (name) => ({ name, status: 'PASS', evidenceRef: `fixture:${name}` });
  const test = () => ({ status: 'PASS', evidenceRef: 'fixture:verification' });
  return {
    schema: SCHEMA,
    approved: true,
    overallStatus: 'PASS',
    sensitiveDataIncluded: false,
    release: {
      sourceSha: sha,
      sourceBranch: CANONICAL_SOURCE_BRANCH,
      targetBranch: TARGET_BRANCH,
      releaseCandidateEvidenceRef: 'fixture:rc-evidence',
    },
    repositoryProtection: {
      main: { protected: true, mechanism: 'RULESET', configurationEvidenceRef: 'fixture:main-ruleset' },
      release: { protected: true, mechanism: 'RULESET', configurationEvidenceRef: 'fixture:release-ruleset' },
      rulesetOrProtectionSnapshotRef: 'fixture:settings-snapshot',
    },
    policy: {
      pullRequestRequired: true,
      directPushAllowed: false,
      minimumApprovals: 1,
      dismissStaleApprovals: true,
      requireConversationResolution: true,
      allowForcePushes: false,
      allowDeletions: false,
      adminBypassPolicy: 'DENY_BY_DEFAULT',
      policyApprovalRef: 'fixture:policy-approval',
    },
    requiredChecks: REQUIRED_CHECKS.map(check),
    security: {
      independentCodeQLRequired: true,
      independentCodeQLStatus: 'PASS',
      unresolvedCriticalOrHighFindings: 0,
      blockingIssue: '#124',
      blockerDisposition: 'CLOSED',
      dispositionEvidenceRef: 'fixture:issue-124-closed',
    },
    verificationTests: Object.fromEntries(VERIFICATION_TESTS.map((name) => [name, test()])),
    promotionAuthorization: {
      authorized: true,
      authorityRole: 'Release Authority',
      approvalRef: 'fixture:release-authority',
      approvedAt: '2026-09-10T00:00:00Z',
    },
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function expectFailure(label, fixture, mutate, sha) {
  const candidate = clone(fixture);
  mutate(candidate);
  let failed = false;
  try {
    validateAcceptedEvidence(candidate, { checkoutSha: sha });
  } catch {
    failed = true;
  }
  if (!failed) throw new Error(`Self-test expected failure: ${label}.`);
}

function selfTest() {
  const sha = currentGitSha();
  const fixture = buildAcceptedFixture(sha);
  validateAcceptedEvidence(fixture, { checkoutSha: sha });
  expectFailure('direct push allowed', fixture, (x) => { x.policy.directPushAllowed = true; }, sha);
  expectFailure('main not protected', fixture, (x) => { x.repositoryProtection.main.protected = false; }, sha);
  expectFailure('no approvals', fixture, (x) => { x.policy.minimumApprovals = 0; }, sha);
  expectFailure('stale approvals not dismissed', fixture, (x) => { x.policy.dismissStaleApprovals = false; }, sha);
  expectFailure('independent CodeQL failed', fixture, (x) => {
    x.security.independentCodeQLStatus = 'FAIL';
    x.requiredChecks.find((item) => item.name === 'CodeQL').status = 'FAIL';
  }, sha);
  expectFailure('high security findings remain', fixture, (x) => { x.security.unresolvedCriticalOrHighFindings = 1; }, sha);
  expectFailure('R8 performance check missing', fixture, (x) => {
    x.requiredChecks = x.requiredChecks.filter((item) => item.name !== 'R8 performance harness contract');
  }, sha);
  expectFailure('R10 deployment check missing', fixture, (x) => {
    x.requiredChecks = x.requiredChecks.filter((item) => item.name !== 'R10 deployment rehearsal contract');
  }, sha);
  expectFailure('failing check blocking test not proven', fixture, (x) => { x.verificationTests.failingRequiredCheckBlocksMerge.status = 'FAIL'; }, sha);
  expectFailure('wrong source SHA', fixture, (x) => { x.release.sourceSha = '0'.repeat(40); }, sha);
  console.log(JSON.stringify({ ok: true, schema: SCHEMA, requiredChecks: REQUIRED_CHECKS, verificationTests: VERIFICATION_TESTS }));
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function writeContractEvidence(templatePath, outputPath) {
  const raw = await readFile(templatePath, 'utf8');
  const template = JSON.parse(raw);
  const validated = validateBlockedTemplate(template);
  const output = {
    schema: 'carepoint.release-promotion-policy-contract-evidence/v1',
    generatedAt: new Date().toISOString(),
    sourceSha: currentGitSha(),
    templateSha256: `sha256:${sha256(raw)}`,
    template: validated,
    repositoryProtectionApplied: false,
    productionPromotionAuthorized: false,
    codeqlIndependentCheckRequired: true,
    blockingIssue: '#124',
    workflowPurpose: 'contract-validation-only',
  };
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(output));
}

async function main() {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === '--self-test') {
    selfTest();
    return;
  }
  if (mode === '--validate' && args.length === 1) {
    console.log(JSON.stringify(validateAcceptedEvidence(await readJson(args[0]))));
    return;
  }
  if (mode === '--validate-template' && args.length === 1) {
    console.log(JSON.stringify(validateBlockedTemplate(await readJson(args[0]))));
    return;
  }
  if (mode === '--contract-evidence' && args.length === 2) {
    await writeContractEvidence(args[0], args[1]);
    return;
  }
  throw new Error('Usage: --self-test | --validate <json> | --validate-template <json> | --contract-evidence <template.json> <output.json>');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
