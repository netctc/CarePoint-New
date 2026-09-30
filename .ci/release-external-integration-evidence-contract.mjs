import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';

const FULL_GIT_SHA = /^[0-9a-f]{40}$/i;
const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/i;
const ENVIRONMENT_CLASSIFICATIONS = new Set(['production-equivalent', 'production']);
const DISPOSITIONS = new Set(['ENABLED', 'DISABLED']);
const STATUSES = new Set(['PASS', 'FAIL', 'BLOCKED', 'NOT_APPLICABLE']);
const CHANNELS = ['PUSH', 'SMS', 'EMAIL'];
const BASE_APPROVAL_ROLES = ['Operations', 'Security', 'Privacy', 'Product'];

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
  'webhooksecret',
  'signingsecret',
  'patientid',
  'patientname',
  'mrn',
  'nationalid',
  'dateofbirth',
  'dob',
  'cardnumber',
  'pan',
  'cvv',
  'cvc',
  'rawrequest',
  'rawresponse',
  'requestbody',
  'responsebody',
  'phivalue',
]);

const SENSITIVE_VALUE_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/i,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  /https?:\/\/[^\s/@:]+:[^\s/@]+@/i,
  /[?&](?:token|access_token|api_key|apikey|secret|password|signature)=([^&\s]+)/i,
  /\b(?:password|passphrase|client_secret|api_key|apikey|access_token|refresh_token|webhook_secret)\s*[:=]\s*\S+/i,
];

const COMMON_ASSERTIONS = [
  'realProviderPathExercised',
  'mockFallbackRejected',
  'secretDeliveryApproved',
  'endpointTrustValidated',
  'boundedTimeoutObserved',
  'providerResponseBounded',
  'safeFailureStateObserved',
  'phiCredentialLeakageReviewPassed',
  'observabilitySanitized',
  'operationalOwnershipConfirmed',
];

const INTEGRATIONS = [
  {
    id: 'livekit',
    when: (root) => root.scope.telemedicineEnabled,
    assertions: [
      'roomCreateTerminateProven',
      'patientDoctorAuthorizedJoinProven',
      'unauthorizedRoomJoinRejected',
      'realAndroidIosMediaProven',
      'cameraMicrophonePermissionStatesProven',
      'turnFallbackRestrictiveNetworkProven',
      'webhookAuthenticityProven',
      'webhookReplayRejected',
      'consentReadinessEnforced',
      'sessionTerminationProven',
      'recordingPolicyEnforced',
    ],
  },
  {
    id: 'psp-acquirer',
    when: (root) => root.scope.paymentsEnabled,
    assertions: [
      'paymentIntentProven',
      'hostedActionOriginTrustProven',
      'successFailureCancelProven',
      'timeoutNoDuplicateChargeProven',
      'webhookCallbackAuthenticityProven',
      'duplicateWebhookRetryIdempotent',
      'refundProven',
      'overRefundPrevented',
      'noPanCvvPersistenceProven',
      'settlementReconciliationProven',
    ],
  },
  {
    id: 'insurance-eligibility-prior-auth',
    when: (root) => root.scope.insuranceEnabled,
    assertions: [
      'eligibleScenarioProven',
      'ineligibleScenarioProven',
      'coverageLimitNormalizationProven',
      'payerTimeoutSafeProven',
      'duplicateRetrySafe',
      'upstreamResponseExposureBounded',
    ],
  },
  {
    id: 'claims-eob-remittance',
    when: (root) => root.scope.claimsEnabled,
    assertions: [
      'claimSubmissionProven',
      'duplicateSubmissionIdempotent',
      'acceptedPendingAdjudicatedDeniedProven',
      'eobAmountsConsistencyProven',
      'reworkFlowProven',
      'paidRemittanceReferenceProven',
      'invalidPayerResponseRejected',
      'payerTimeoutRetrySafe',
      'authorizedReconciliationProven',
    ],
  },
  {
    id: 'notifications',
    when: (root) => root.scope.pushEnabled || root.scope.smsEnabled || root.scope.emailEnabled,
    assertions: [
      'enabledChannelDeliveryProven',
      'invalidDestinationHandled',
      'preferencesOptOutProven',
      'retryBackoffDeadLetterProven',
      'phiNeutralProviderPayloadProven',
      'appointmentConfirmationStatusReminderProven',
    ],
  },
  {
    id: 'dicom-pacs',
    when: (root) => root.scope.dicomEnabled,
    assertions: [
      'studySeriesInstanceRoundTripProven',
      'invalidUidRejected',
      'offDomainReferenceRejected',
      'directBrowserBypassPrevented',
      'proxyCareTeamAuthorizationProven',
      'authorizedClinicalVisibilityProven',
      'providerOutageInvalidResponseSafe',
      'phiUrlLoggingMinimized',
    ],
  },
  {
    id: 'clamav',
    when: (root) => root.scope.clinicalUploadsEnabled,
    assertions: [
      'cleanFileAccepted',
      'eicarRejected',
      'scannerUnavailableFailsClosed',
      'scannerTimeoutFailsClosed',
      'unexpectedResponseFailsClosed',
      'signatureFreshnessMonitoringProven',
      'representativeMaxSizeScanProven',
    ],
  },
  {
    id: 'maps-routing',
    when: (root) => root.scope.mapsRoutingEnabled,
    assertions: [
      'addressCoordinateBehaviorProven',
      'routeEtaBehaviorProven',
      'homeVisitCoverageIntegrationProven',
      'locationMinimizationReviewPassed',
      'providerDataTermsApproved',
      'emergencyDispatchNotBlockedByNonessentialMapFailure',
    ],
  },
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

function scanSensitiveData(value, trail = 'evidence') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanSensitiveData(item, `${trail}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (FORBIDDEN_KEYS.has(normalizedKey)) throw new Error(`Sensitive/PHI/payment-like key ${trail}.${key} is not allowed.`);
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

function indexedIntegrations(value) {
  if (!Array.isArray(value)) throw new Error('integrations must be an array.');
  const map = new Map();
  const expected = new Set(INTEGRATIONS.map((item) => item.id));
  for (const item of value) {
    const record = requiredObject(item, 'integration');
    const id = requiredString(record.id, 'integration.id', 100);
    if (!expected.has(id)) throw new Error(`Unexpected integration ${id}.`);
    if (map.has(id)) throw new Error(`Duplicate integration ${id}.`);
    map.set(id, record);
  }
  for (const id of expected) if (!map.has(id)) throw new Error(`Missing required integration record ${id}.`);
  return map;
}

function requireAssertionMap(record, definition) {
  const assertions = requiredObject(record.assertions, `${definition.id}.assertions`);
  for (const name of [...COMMON_ASSERTIONS, ...definition.assertions]) {
    requireBoolean(assertions[name], `${definition.id}.assertions.${name}`, true);
  }
}

function validateNotificationChannels(root, record) {
  const expected = new Set([
    ...(root.scope.pushEnabled ? ['PUSH'] : []),
    ...(root.scope.smsEnabled ? ['SMS'] : []),
    ...(root.scope.emailEnabled ? ['EMAIL'] : []),
  ]);
  if (!Array.isArray(record.enabledChannels)) throw new Error('notifications.enabledChannels must be an array.');
  const actual = new Set(record.enabledChannels.map((value, index) => requiredString(value, `notifications.enabledChannels[${index}]`, 20)));
  for (const value of actual) if (!CHANNELS.includes(value)) throw new Error(`Unexpected notification channel ${value}.`);
  if (actual.size !== record.enabledChannels.length) throw new Error('notifications.enabledChannels must not contain duplicates.');
  if (actual.size !== expected.size || [...expected].some((value) => !actual.has(value))) throw new Error('notifications.enabledChannels must exactly match the approved launch scope.');
  const evidence = requiredObject(record.channelEvidence, 'notifications.channelEvidence');
  for (const channel of expected) requireReference(evidence[channel], `notifications.channelEvidence.${channel}`);
  for (const channel of CHANNELS) {
    if (!expected.has(channel) && evidence[channel] != null) throw new Error(`notifications.channelEvidence.${channel} must be absent when the channel is disabled.`);
  }
}

function validateIntegration(root, definition, record) {
  if (!DISPOSITIONS.has(record.disposition)) throw new Error(`${definition.id}.disposition is invalid.`);
  if (!STATUSES.has(record.status)) throw new Error(`${definition.id}.status is invalid.`);
  const required = definition.when(root);
  requireReference(record.scopeDecisionRef, `${definition.id}.scopeDecisionRef`);
  requireReference(record.scopeApprovalRef, `${definition.id}.scopeApprovalRef`);

  if (!required) {
    if (record.disposition !== 'DISABLED' || record.status !== 'NOT_APPLICABLE') {
      throw new Error(`${definition.id} must be DISABLED/NOT_APPLICABLE for the approved launch scope.`);
    }
    requireReference(record.deferredRationaleRef, `${definition.id}.deferredRationaleRef`);
    requireReference(record.deferredApprovalRef, `${definition.id}.deferredApprovalRef`);
    for (const forbidden of ['providerAccountRef', 'endpointClass', 'successEvidenceRef', 'failureEvidenceRef']) {
      if (record[forbidden] != null) throw new Error(`${definition.id}.${forbidden} must be absent when disabled.`);
    }
    return { id: definition.id, enabled: false, status: 'NOT_APPLICABLE' };
  }

  if (record.disposition !== 'ENABLED') throw new Error(`${definition.id} must be ENABLED for the approved launch scope.`);
  if (record.status !== 'PASS') throw new Error(`${definition.id} must PASS for final R4 acceptance.`);
  if (record.providerMode !== 'REAL') throw new Error(`${definition.id}.providerMode must be REAL.`);
  requireReference(record.providerAccountRef, `${definition.id}.providerAccountRef`);
  requireReference(record.endpointClass, `${definition.id}.endpointClass`);
  requireReference(record.secretDeliveryEvidenceRef, `${definition.id}.secretDeliveryEvidenceRef`);
  requireReference(record.dataGovernanceEvidenceRef, `${definition.id}.dataGovernanceEvidenceRef`);
  requireReference(record.privacyApprovalRef, `${definition.id}.privacyApprovalRef`);
  requireReference(record.residencyEvidenceRef, `${definition.id}.residencyEvidenceRef`);
  requireReference(record.ownerRef, `${definition.id}.ownerRef`);
  requireReference(record.escalationRef, `${definition.id}.escalationRef`);
  requireReference(record.successEvidenceRef, `${definition.id}.successEvidenceRef`);
  requireReference(record.failureEvidenceRef, `${definition.id}.failureEvidenceRef`);
  requireReference(record.observabilityEvidenceRef, `${definition.id}.observabilityEvidenceRef`);
  requireReference(record.revalidationRef, `${definition.id}.revalidationRef`);
  const startedAt = requireTimestamp(record.startedAt, `${definition.id}.startedAt`);
  const completedAt = requireTimestamp(record.completedAt, `${definition.id}.completedAt`);
  if (Date.parse(completedAt) < Date.parse(startedAt)) throw new Error(`${definition.id}.completedAt cannot precede startedAt.`);
  requireTimestamp(record.revalidateBy, `${definition.id}.revalidateBy`);

  requireBoolean(record.certificationRequired, `${definition.id}.certificationRequired`);
  requireReference(record.certificationDecisionRef, `${definition.id}.certificationDecisionRef`);
  if (record.certificationRequired) requireReference(record.certificationEvidenceRef, `${definition.id}.certificationEvidenceRef`);
  else if (record.certificationEvidenceRef != null) requireReference(record.certificationEvidenceRef, `${definition.id}.certificationEvidenceRef`);

  requireAssertionMap(record, definition);
  if (definition.id === 'notifications') validateNotificationChannels(root, record);
  if (definition.id === 'livekit') {
    requireBoolean(record.recordingEnabled, 'livekit.recordingEnabled');
    if (record.recordingEnabled) requireReference(record.recordingApprovalRef, 'livekit.recordingApprovalRef');
  }
  if (definition.id === 'psp-acquirer' && root.scope.providerPayoutsEnabled) {
    requireBoolean(record.assertions.providerPayoutFlowProven, 'psp-acquirer.assertions.providerPayoutFlowProven', true);
  }
  if (definition.id === 'insurance-eligibility-prior-auth' && root.scope.priorAuthorizationEnabled) {
    requireBoolean(record.assertions.priorAuthorizationLifecycleProven, 'insurance-eligibility-prior-auth.assertions.priorAuthorizationLifecycleProven', true);
  }

  return { id: definition.id, enabled: true, status: 'PASS' };
}

function requiredApprovalRoles(root) {
  const roles = [...BASE_APPROVAL_ROLES];
  if (root.scope.paymentsEnabled || root.scope.insuranceEnabled || root.scope.claimsEnabled) roles.push('Finance');
  if (root.scope.telemedicineEnabled || root.scope.dicomEnabled || root.scope.clinicalUploadsEnabled || root.scope.mapsRoutingEnabled) roles.push('Clinical');
  return roles;
}

function validateApprovals(root) {
  if (!Array.isArray(root.approvals)) throw new Error('approvals must be an array.');
  const requiredRoles = requiredApprovalRoles(root);
  const allowed = new Set(requiredRoles);
  const map = new Map();
  for (const item of root.approvals) {
    const approval = requiredObject(item, 'approval');
    const role = requiredString(approval.role, 'approval.role', 80);
    if (!allowed.has(role)) throw new Error(`Unexpected approval role ${role} for this launch scope.`);
    if (map.has(role)) throw new Error(`Duplicate approval role ${role}.`);
    map.set(role, approval);
  }
  for (const role of requiredRoles) {
    const approval = map.get(role);
    if (!approval) throw new Error(`Missing required ${role} approval.`);
    if (approval.decision !== 'APPROVE') throw new Error(`${role} approval decision must be APPROVE.`);
    requireReference(approval.approverRef, `${role}.approverRef`);
    requireReference(approval.evidenceRef, `${role}.evidenceRef`);
    requireTimestamp(approval.approvedAt, `${role}.approvedAt`);
  }
  return requiredRoles;
}

export async function validateEvidence(evidence, { checkoutSha = currentGitSha() } = {}) {
  const root = requiredObject(evidence, 'evidence');
  scanSensitiveData(root);
  if (root.schema !== 'carepoint.release-external-integration-evidence/v1') throw new Error('Unsupported R4 evidence schema.');
  requireBoolean(root.approved, 'approved', true);
  requireBoolean(root.sensitiveDataIncluded, 'sensitiveDataIncluded', false);
  if (root.overallStatus !== 'PASS') throw new Error('overallStatus must be PASS for final R4 acceptance.');

  const release = requiredObject(root.release, 'release');
  const sourceSha = requireFullSha(release.sourceSha, 'release.sourceSha');
  const normalizedCheckout = requireFullSha(checkoutSha, 'checkoutSha');
  if (sourceSha !== normalizedCheckout) throw new Error(`release.sourceSha ${sourceSha} does not match checkout ${normalizedCheckout}.`);
  requireReference(release.releaseVersion, 'release.releaseVersion');
  requireDigest(release.apiArtifactDigest, 'release.apiArtifactDigest');
  requireDigest(release.adminArtifactDigest, 'release.adminArtifactDigest');
  requireReference(release.rcEvidenceRef, 'release.rcEvidenceRef');
  requireReference(release.infrastructureEvidenceRef, 'release.infrastructureEvidenceRef');

  const environment = requiredObject(root.environment, 'environment');
  if (!ENVIRONMENT_CLASSIFICATIONS.has(environment.classification)) throw new Error('environment.classification must be production-equivalent or production.');
  requireReference(environment.id, 'environment.id');
  requireReference(environment.topologyEvidenceRef, 'environment.topologyEvidenceRef');
  requireReference(environment.providerScopeApprovalRef, 'environment.providerScopeApprovalRef');
  if (environment.classification === 'production') requireBoolean(environment.productionValidationApproved, 'environment.productionValidationApproved', true);

  const scope = requiredObject(root.scope, 'scope');
  for (const key of [
    'telemedicineEnabled',
    'paymentsEnabled',
    'providerPayoutsEnabled',
    'insuranceEnabled',
    'priorAuthorizationEnabled',
    'claimsEnabled',
    'pushEnabled',
    'smsEnabled',
    'emailEnabled',
    'dicomEnabled',
    'clinicalUploadsEnabled',
    'mapsRoutingEnabled',
  ]) requireBoolean(scope[key], `scope.${key}`);
  requireReference(scope.launchScopeDecisionRef, 'scope.launchScopeDecisionRef');
  requireReference(scope.marketProfileRef, 'scope.marketProfileRef');
  if (scope.providerPayoutsEnabled && !scope.paymentsEnabled) throw new Error('providerPayoutsEnabled requires paymentsEnabled.');
  if (scope.priorAuthorizationEnabled && !scope.insuranceEnabled) throw new Error('priorAuthorizationEnabled requires insuranceEnabled.');

  const integrations = indexedIntegrations(root.integrations);
  const results = INTEGRATIONS.map((definition) => validateIntegration(root, definition, integrations.get(definition.id)));
  const approvalRoles = validateApprovals(root);
  requireReference(root.crossIntegrationFailureEvidenceRef, 'crossIntegrationFailureEvidenceRef');
  requireReference(root.finalEvidenceRef, 'finalEvidenceRef');
  requireTimestamp(root.acceptedAt, 'acceptedAt');

  return {
    schema: root.schema,
    sourceSha,
    environmentId: environment.id,
    classification: environment.classification,
    enabledIntegrations: results.filter((item) => item.enabled).map((item) => item.id),
    disabledIntegrations: results.filter((item) => !item.enabled).map((item) => item.id),
    approvalRoles,
    overallStatus: 'PASS',
    productionAcceptance: true,
  };
}

function validateTemplate(template) {
  const root = requiredObject(template, 'template');
  scanSensitiveData(root);
  if (root.schema !== 'carepoint.release-external-integration-evidence/v1') throw new Error('Template uses an unsupported R4 evidence schema.');
  requireBoolean(root.approved, 'template.approved', false);
  requireBoolean(root.sensitiveDataIncluded, 'template.sensitiveDataIncluded', false);
  if (root.overallStatus !== 'DRAFT') throw new Error('Template overallStatus must remain DRAFT.');
  const integrations = indexedIntegrations(root.integrations);
  if (!Array.isArray(root.approvals)) throw new Error('Template approvals must be an array.');
  const roles = root.approvals.map((item) => requiredString(requiredObject(item, 'template approval').role, 'template approval.role', 80));
  for (const role of [...BASE_APPROVAL_ROLES, 'Finance', 'Clinical']) if (!roles.includes(role)) throw new Error(`Template must include ${role} approval placeholder.`);
  return {
    schema: root.schema,
    integrations: integrations.size,
    approvalPlaceholders: roles.length,
    productionAcceptance: false,
  };
}

function makeSyntheticEvidence(checkoutSha) {
  const root = {
    schema: 'carepoint.release-external-integration-evidence/v1',
    approved: true,
    sensitiveDataIncluded: false,
    overallStatus: 'PASS',
    release: {
      sourceSha: checkoutSha,
      releaseVersion: 'synthetic-self-test',
      apiArtifactDigest: `sha256:${'a'.repeat(64)}`,
      adminArtifactDigest: `sha256:${'b'.repeat(64)}`,
      rcEvidenceRef: 'evidence:rc',
      infrastructureEvidenceRef: 'evidence:r3',
    },
    environment: {
      id: 'synthetic-production-equivalent',
      classification: 'production-equivalent',
      topologyEvidenceRef: 'evidence:topology',
      providerScopeApprovalRef: 'approval:provider-scope',
      productionValidationApproved: false,
    },
    scope: {
      telemedicineEnabled: true,
      paymentsEnabled: true,
      providerPayoutsEnabled: true,
      insuranceEnabled: true,
      priorAuthorizationEnabled: true,
      claimsEnabled: true,
      pushEnabled: true,
      smsEnabled: true,
      emailEnabled: true,
      dicomEnabled: true,
      clinicalUploadsEnabled: true,
      mapsRoutingEnabled: true,
      launchScopeDecisionRef: 'approval:launch-scope',
      marketProfileRef: 'evidence:market-profile',
    },
    integrations: [],
    approvals: [],
    crossIntegrationFailureEvidenceRef: 'evidence:cross-provider-failures',
    finalEvidenceRef: 'evidence:r4-final',
    acceptedAt: '2026-01-01T02:00:00Z',
  };

  root.integrations = INTEGRATIONS.map((definition) => {
    const assertions = Object.fromEntries([...COMMON_ASSERTIONS, ...definition.assertions].map((name) => [name, true]));
    const record = {
      id: definition.id,
      disposition: 'ENABLED',
      status: 'PASS',
      scopeDecisionRef: `scope:${definition.id}`,
      scopeApprovalRef: `approval:scope:${definition.id}`,
      providerMode: 'REAL',
      providerAccountRef: `provider:${definition.id}`,
      endpointClass: `${definition.id}-service`,
      secretDeliveryEvidenceRef: `evidence:secret:${definition.id}`,
      dataGovernanceEvidenceRef: `evidence:data-governance:${definition.id}`,
      privacyApprovalRef: `approval:privacy:${definition.id}`,
      residencyEvidenceRef: `evidence:residency:${definition.id}`,
      ownerRef: `owner:${definition.id}`,
      escalationRef: `escalation:${definition.id}`,
      successEvidenceRef: `evidence:success:${definition.id}`,
      failureEvidenceRef: `evidence:failure:${definition.id}`,
      observabilityEvidenceRef: `evidence:observability:${definition.id}`,
      revalidationRef: `revalidation:${definition.id}`,
      startedAt: '2026-01-01T00:00:00Z',
      completedAt: '2026-01-01T01:00:00Z',
      revalidateBy: '2026-02-01T00:00:00Z',
      certificationRequired: false,
      certificationDecisionRef: `decision:certification:${definition.id}`,
      assertions,
    };
    if (definition.id === 'notifications') {
      record.enabledChannels = ['PUSH', 'SMS', 'EMAIL'];
      record.channelEvidence = { PUSH: 'evidence:push', SMS: 'evidence:sms', EMAIL: 'evidence:email' };
    }
    if (definition.id === 'livekit') record.recordingEnabled = false;
    if (definition.id === 'psp-acquirer') record.assertions.providerPayoutFlowProven = true;
    if (definition.id === 'insurance-eligibility-prior-auth') record.assertions.priorAuthorizationLifecycleProven = true;
    return record;
  });

  root.approvals = requiredApprovalRoles(root).map((role) => ({
    role,
    decision: 'APPROVE',
    approverRef: `approver:${role.toLowerCase()}`,
    evidenceRef: `approval-evidence:${role.toLowerCase()}`,
    approvedAt: '2026-01-01T01:30:00Z',
  }));
  return root;
}

async function expectReject(label, mutator, checkoutSha) {
  const value = makeSyntheticEvidence(checkoutSha);
  mutator(value);
  let rejected = false;
  try {
    await validateEvidence(value, { checkoutSha });
  } catch (_) {
    rejected = true;
  }
  if (!rejected) throw new Error(`Self-test expected rejection: ${label}`);
}

async function selfTest() {
  const checkoutSha = 'c'.repeat(40);
  const result = await validateEvidence(makeSyntheticEvidence(checkoutSha), { checkoutSha });
  if (result.overallStatus !== 'PASS' || result.enabledIntegrations.length !== INTEGRATIONS.length) throw new Error('Synthetic PASS evidence did not validate.');

  await expectReject('wrong source SHA', (value) => { value.release.sourceSha = 'd'.repeat(40); }, checkoutSha);
  await expectReject('mock provider enabled', (value) => { value.integrations[0].providerMode = 'MOCK'; }, checkoutSha);
  await expectReject('required integration disabled', (value) => { value.integrations[1].disposition = 'DISABLED'; value.integrations[1].status = 'NOT_APPLICABLE'; }, checkoutSha);
  await expectReject('failed E2E integration', (value) => { value.integrations[2].status = 'FAIL'; }, checkoutSha);
  await expectReject('failed integration assertion', (value) => { value.integrations[3].assertions.duplicateSubmissionIdempotent = false; }, checkoutSha);
  await expectReject('notification channel mismatch', (value) => { value.integrations[4].enabledChannels = ['PUSH']; }, checkoutSha);
  await expectReject('missing finance approval', (value) => { value.approvals = value.approvals.filter((item) => item.role !== 'Finance'); }, checkoutSha);
  await expectReject('credential-like public evidence', (value) => { value.finalEvidenceRef = 'https://user:password@example.invalid/r4'; }, checkoutSha);
  await expectReject('unapproved final record', (value) => { value.approved = false; }, checkoutSha);

  const optional = makeSyntheticEvidence(checkoutSha);
  optional.scope.dicomEnabled = false;
  const dicom = optional.integrations.find((item) => item.id === 'dicom-pacs');
  for (const key of Object.keys(dicom)) delete dicom[key];
  Object.assign(dicom, {
    id: 'dicom-pacs',
    disposition: 'DISABLED',
    status: 'NOT_APPLICABLE',
    scopeDecisionRef: 'scope:dicom-disabled',
    scopeApprovalRef: 'approval:scope:dicom-disabled',
    deferredRationaleRef: 'decision:dicom-not-launch-enabled',
    deferredApprovalRef: 'approval:dicom-not-launch-enabled',
  });
  await validateEvidence(optional, { checkoutSha });

  console.log(`Release external-integration evidence contract self-test passed (${INTEGRATIONS.length} integration families).`);
}

async function contractEvidence(templatePath, outputPath) {
  const scriptPath = fileURLToPath(import.meta.url);
  const [scriptContent, templateContent] = await Promise.all([readFile(scriptPath), readFile(templatePath)]);
  const template = JSON.parse(templateContent.toString('utf8'));
  const summary = validateTemplate(template);
  const evidence = {
    schema: 'carepoint.release-external-integration-contract/v1',
    sourceSha: currentGitSha(),
    evidenceSchema: summary.schema,
    integrationFamilies: INTEGRATIONS.map((item) => item.id),
    baseApprovalRoles: BASE_APPROVAL_ROLES,
    productionAcceptance: false,
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
