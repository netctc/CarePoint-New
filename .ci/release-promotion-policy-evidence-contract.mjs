import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';

const FULL_GIT_SHA = /^[0-9a-f]{40}$/i;
const CANONICAL_SOURCE_BRANCH = 'release/release-1-integration-go-live-readiness';
const TARGET_BRANCH = 'main';
const SCHEMA = 'carepoint.release-promotion-policy-evidence/v1';
const PASS = 'PASS';
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
  'R7 UAT evidence contract',
  'R9 market readiness evidence contract',
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

function command(name, args) {
  return execFileSync(name, args, { encoding: 'utf8' }).trim();
}

function currentGitSha() {
  const value = command('git', ['rev-parse', 'HEAD']).toLowerCase();
  if (!FULL_GIT_SHA.test(value)) throw new Error('Unable to resolve current full Git SHA.');
  return value;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value;
}

function string(value, label, maxLength = 500) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} must be a non-empty string.`);
  const result = value.trim();
  if (result.length > maxLength || /[\r\n\0]/.test(result)) throw new Error(`${label} must be one line and <= ${maxLength} characters.`);
  return result;
}

function reference(value, label) {
  return string(value, label, 500);
}

function boolean(value, label, expected) {
  if (typeof value !== 'boolean') throw new Error(`${label} must be boolean.`);
  if (typeof expected === 'boolean' && value !== expected) throw new Error(`${label} must be ${expected}.`);
  return value;
}

function integer(value, label, minimum = 0) {
  if (!Number.isInteger(value) || value < minimum) throw new Error(`${label} must be an integer >= ${minimum}.`);
  return value;
}

function oneOf(value, label, allowed) {
  const result = string(value, label, 100);
  if (!allowed.includes(result)) throw new Error(`${label} must be one of: ${allowed.join(', ')}.`);
  return result;
}

function fullSha(value, label) {
  const result = string(value, label, 40).toLowerCase();
  if (!FULL_GIT_SHA.test(result)) throw new Error(`${label} must be a full 40-hex Git SHA.`);
  return result;
}

function timestamp(value, label) {
  const result = string(value, label, 80);
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

function validateBranches(root) {
  const release = object(root.release, 'release');
  if (string(release.sourceBranch, 'release.sourceBranch', 150) !== CANONICAL_SOURCE_BRANCH) {
    throw new Error(`release.sourceBranch must be ${CANONICAL_SOURCE_BRANCH}.`);
  }
  if (string(release.targetBranch, 'release.targetBranch', 100) !== TARGET_BRANCH) {
    throw new Error(`release.targetBranch must be ${TARGET_BRANCH}.`);
  }
}

function validateRequiredChecks(value, { accepted }) {
  if (!Array.isArray(value)) throw new Error('requiredChecks must be an array.');
  const seen = new Map();
  for (const [index, raw] of value.entries()) {
    const item = object(raw, `requiredChecks[${index}]`);
    const name = string(item.name, `requiredChecks[${index}].name`, 160);
    if (seen.has(name)) throw new Error(`Duplicate required check: ${name}.`);
    const status = oneOf(item.status, `requiredChecks[${index}].status`, ['PASS', 'FAIL', 'PENDING', 'BLOCKED']);
    reference(item.evidenceRef, `requiredChecks[${index}].evidenceRef`);
    seen.set(name, status);
  }
  const missing = REQUIRED_CHECKS.filter((name) => !seen.has(name));
  if (missing.length) throw new Error(`Missing mandatory promotion checks: ${missing.join(', ')}.`);
  if (accepted) {
    for (const name of REQUIRED_CHECKS) {
      if (seen.get(name) !== PASS) throw new Error(`Mandatory promotion check ${name} must be PASS.`);
    }
  }
  return seen;
}

function validateProtection(value, label, { accepted }) {
  const branch = object(value, label);
  boolean(branch.protected, `${label}.protected`, accepted ? true : undefined);
  oneOf(branch.mechanism, `${label}.mechanism`, ['RULESET', 'BRANCH_PROTECTION', 'PENDING']);
  reference(branch.configurationEvidenceRef, `${label}.configurationEvidenceRef`);
  if (accepted && branch.mechanism === 'PENDING') throw new Error(`${label}.mechanism cannot be PENDING for accepted evidence.`);
}

function validatePolicy(root, { accepted }) {
  const policy = object(root.policy, 'policy');
  boolean(policy.pullRequestRequired, 'policy.pullRequestRequired', accepted ? true : undefined);
  boolean(policy.directPushAllowed, 'policy.directPushAllowed', accepted ? false : undefined);
  integer(policy.minimumApprovals, 'policy.minimumApprovals', accepted ? 1 : 0);
  boolean(policy.dismissStaleApprovals, 'policy.dismissStaleApprovals', accepted ? true : undefined);
  boolean(policy.requireConversationResolution, 'policy.requireConversationResolution', accepted ? true : undefined);
  boolean(policy.allowForcePushes, 'policy.allowForcePushes', accepted ? false : undefined);
  boolean(policy.allowDeletions, 'policy.allowDeletions', accepted ? false : undefined);
  const bypass = oneOf(policy.adminBypassPolicy, 'policy.adminBypassPolicy', ['DENY_BY_DEFAULT', 'BREAK_GLASS_RECORDED', 'PENDING']);
  reference(policy.policyApprovalRef, 'policy.policyApprovalRef');
  if (accepted && bypass === 'PENDING') throw new Error('policy.adminBypassPolicy cannot be PENDING for accepted evidence.');
  if (accepted && bypass === 'BREAK_GLASS_RECORDED') {
    reference(policy.breakGlassAuthorityRef, 'policy.breakGlassAuthorityRef');
    reference(policy.breakGlassAuditProcedureRef, 'policy.breakGlassAuditProcedureRef');
  }
}

function validateSecurity(root, { accepted }, checks) {
  const security = object(root.security, 'security');
  boolean(security.independentCodeQLRequired, 'security.independentCodeQLRequired', true);
  const codeqlStatus = oneOf(security.independentCodeQLStatus, 'security.independentCodeQLStatus', ['PASS', 'FAIL', 'PENDING', 'BLOCKED']);
  integer(security.unresolvedCriticalOrHighFindings, 'security.unresolvedCriticalOrHighFindings', 0);
  if (string(security.blockingIssue, 'security.blockingIssue', 40) !== '#124') throw new Error('security.blockingIssue must be #124.');
  const disposition = oneOf(security.blockerDisposition, 'security.blockerDisposition', ['OPEN', 'CLOSED', 'FORMALLY_ACCEPTED']);
  reference(security.dispositionEvidenceRef, 'security.dispositionEvidenceRef');
  if (accepted) {
    if (codeqlStatus !== PASS || checks.get('CodeQL') !== PASS) throw new Error('Independent CodeQL check must PASS for accepted promotion evidence.');
    if (security.unresolvedCriticalOrHighFindings !== 0) throw new Error('No unresolved Critical/High security findings are allowed.');
    if (!['CLOSED', 'FORMALLY_ACCEPTED'].includes(disposition)) throw new Error('#124 must be CLOSED or FORMALLY_ACCEPTED.');
    if (disposition === 'FORMALLY_ACCEPTED') {
      reference(security.acceptanceAuthorityRef, 'security.acceptanceAuthorityRef');
      reference(security.residualRiskRef, 'security.residualRiskRef');
      timestamp(security.reviewBy, 'security.reviewBy');
    }
  }
}

function validateVerificationTests(value, { accepted }) {
  const tests = object(value, 'verificationTests');
  for (const name of VERIFICATION_TESTS) {
    const item = object(tests[name], `verificationTests.${name}`);
    const status = oneOf(item.status, `verificationTests.${name}.status`, ['PASS', 'FAIL', 'PENDING', 'BLOCKED']);
    reference(item.evidenceRef, `verificationTests.${name}.evidenceRef`);
    if (accepted && status !== PASS) throw new Error(`verificationTests.${name} must PASS.`);
  }
}

function validateAcceptedEvidence(input, { checkoutSha = currentGitSha() } = {}) {
  const root = object(input, 'evidence');
  scanSensitiveData(root);
  if (string(root.schema, 'schema', 120) !== SCHEMA) throw new Error(`schema must be ${SCHEMA}.`);
  boolean(root.approved, 'approved', true);
  if (string(root.overallStatus, 'overallStatus', 40) !== PASS) throw new Error('overallStatus must be PASS.');
  boolean(root.sensitiveDataIncluded, 'sensitiveDataIncluded', false);
  validateBranches(root);

  const release = object(root.release, 'release');
  const sourceSha = fullSha(release.sourceSha, 'release.sourceSha');
  if (sourceSha !== checkoutSha.toLowerCase()) throw new Error(`release.sourceSha ${sourceSha} does not match checkout ${checkoutSha}.`);
  reference(release.releaseCandidateEvidenceRef, 'release.releaseCandidateEvidenceRef');

  const protection = object(root.repositoryProtection, 'repositoryProtection');
  validateProtection(protection.main, 'repositoryProtection.main', { accepted: true });
  validateProtection(protection.release, 'repositoryProtection.release', { accepted: true });
  reference(protection.rulesetOrProtectionSnapshotRef, 'repositoryProtection.rulesetOrProtectionSnapshotRef');

  validatePolicy(root, { accepted: true });
  const checks = validateRequiredChecks(root.requiredChecks, { accepted: true });
  validateSecurity(root, { accepted: true }, checks);
  validateVerificationTests(root.verificationTests, { accepted: true });

  const authorization = object(root.promotionAuthorization, 'promotionAuthorization');
  boolean(authorization.authorized, 'promotionAuthorization.authorized', true);
  if (string(authorization.authorityRole, 'promotionAuthorization.authorityRole', 120) !== 'Release Authority') {
    throw new Error('promotionAuthorization.authorityRole must be Release Authority.');
  }
  reference(authorization.approvalRef, 'promotionAuthorization.approvalRef');
  timestamp(authorization.approvedAt, 'promotionAuthorization.approvedAt');

  return {
    schema: SCHEMA,
    sourceSha,
    sourceBranch: CANONICAL_SOURCE_BRANCH,
    targetBranch: TARGET_BRANCH,
    requiredCheckCount: REQUIRED_CHECKS.length,
    promotionAuthorized: true,
    repositoryProtectionApplied: true,
  };
}

function validateBlockedTemplate(input) {
  const root = object(input, 'template');
  scanSensitiveData(root);
  if (string(root.schema, 'schema', 120) !== SCHEMA) throw new Error(`schema must be ${SCHEMA}.`);
  boolean(root.approved, 'approved', false);
  if (string(root.overallStatus, 'overallStatus', 40) !== 'BLOCKED') throw new Error('Template overallStatus must be BLOCKED.');
  boolean(root.sensitiveDataIncluded, 'sensitiveDataIncluded', false);
  validateBranches(root);

  const release = object(root.release, 'release');
  fullSha(release.sourceSha, 'release.sourceSha');
  reference(release.releaseCandidateEvidenceRef, 'release.releaseCandidateEvidenceRef');

  const protection = object(root.repositoryProtection, 'repositoryProtection');
  validateProtection(protection.main, 'repositoryProtection.main', { accepted: false });
  validateProtection(protection.release, 'repositoryProtection.release', { accepted: false });
  reference(protection.rulesetOrProtectionSnapshotRef, 'repositoryProtection.rulesetOrProtectionSnapshotRef');

  validatePolicy(root, { accepted: false });
  const checks = validateRequiredChecks(root.requiredChecks, { accepted: false });
  validateSecurity(root, { accepted: false }, checks);
  validateVerificationTests(root.verificationTests, { accepted: false });

  const authorization = object(root.promotionAuthorization, 'promotionAuthorization');
  boolean(authorization.authorized, 'promotionAuthorization.authorized', false);
  reference(authorization.approvalRef, 'promotionAuthorization.approvalRef');

  return {
    schema: SCHEMA,
    approved: false,
    overallStatus: 'BLOCKED',
    promotionAuthorized: false,
    repositoryProtectionApplied: false,
    requiredCheckCount: REQUIRED_CHECKS.length,
    codeqlStatus: checks.get('CodeQL'),
  };
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
  expectFailure('required check missing', fixture, (x) => { x.requiredChecks = x.requiredChecks.filter((item) => item.name !== 'fhir'); }, sha);
  expectFailure('failing check blocking test not proven', fixture, (x) => { x.verificationTests.failingRequiredCheckBlocksMerge.status = 'FAIL'; }, sha);
  expectFailure('wrong source SHA', fixture, (x) => { x.release.sourceSha = '0'.repeat(40); }, sha);
  console.log(JSON.stringify({ ok: true, schema: SCHEMA, requiredChecks: REQUIRED_CHECKS, verificationTests: VERIFICATION_TESTS }));
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
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
    const result = validateAcceptedEvidence(await readJson(args[0]));
    console.log(JSON.stringify(result));
    return;
  }
  if (mode === '--validate-template' && args.length === 1) {
    const result = validateBlockedTemplate(await readJson(args[0]));
    console.log(JSON.stringify(result));
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
