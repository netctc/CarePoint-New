import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const FULL_GIT_SHA = /^[0-9a-f]{40}$/i;
const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/i;
const ENVIRONMENT_CLASSIFICATIONS = new Set(["production-equivalent", "production"]);
const APPLICABILITY = new Set(["APPLICABLE", "NOT_APPLICABLE"]);
const SCENARIO_STATUS = new Set(["PASS", "FAIL", "BLOCKED", "NOT_APPLICABLE"]);
const MAX_RPO_MINUTES = 15;
const MAX_RTO_MINUTES = 120;

const FORBIDDEN_KEYS = new Set([
  "password",
  "passphrase",
  "clientsecret",
  "apikey",
  "accesstoken",
  "refreshtoken",
  "privatekey",
  "authorization",
  "cookie",
  "connectionstring",
  "databaseurl",
  "patientid",
  "patientname",
  "mrn",
  "nationalid",
  "dateofbirth",
  "dob",
  "requestbody",
  "rawrequest",
]);

const SENSITIVE_VALUE_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/i,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  /https?:\/\/[^\s/@:]+:[^\s/@]+@/i,
  /[?&](?:token|access_token|api_key|apikey|secret|password)=([^&\s]+)/i,
];

const SCENARIOS = [
  {
    id: "notification-provider-outage",
    when: (root) => root.scope.notificationsEnabled,
    assertions: [
      "unaffectedReadsAvailable",
      "durableWorkRetained",
      "boundedRetryObserved",
      "deliveredOnceAfterRecovery",
      "terminalFailureAuditedWithoutSensitiveData",
    ],
  },
  {
    id: "notification-worker-lease-recovery",
    when: (root) => root.scope.notificationsEnabled,
    assertions: ["leasedWorkRecovered", "noLostDurableJobs", "noDuplicateDurableJobs"],
  },
  {
    id: "psp-timeout-retry-webhook-replay",
    when: (root) => root.scope.paymentsEnabled,
    assertions: [
      "sameIdempotencyKeySafe",
      "replayedWebhookSafe",
      "noDuplicateCharge",
      "noDuplicateFinancialTransition",
      "noFalseSuccess",
      "reconciliationPossible",
    ],
  },
  {
    id: "redis-loss-failover",
    when: () => true,
    assertions: ["safeDegradationObserved", "recoveryWindowMeasured", "noDuplicateCriticalSideEffect", "noRetryStorm"],
  },
  {
    id: "postgres-primary-failover",
    when: () => true,
    assertions: ["writeIntegrityPreserved", "noDoubleBooking", "failoverRecoveryMeasured"],
  },
  {
    id: "postgres-replica-lag",
    when: (root) => root.topology.postgresReadReplicas,
    assertions: ["lagEffectMeasured", "criticalWriteIntegrityPreserved", "staleReadBehaviorDocumented"],
  },
  {
    id: "postgres-pitr-restore",
    when: () => true,
    assertions: ["recoveryPointMeasured", "schemaIntegrityVerified", "criticalReadWriteVerified", "operationsRunbookUsable"],
  },
  {
    id: "telehealth-provider-network-outage",
    when: (root) => root.scope.telehealthEnabled,
    assertions: [
      "realProviderPathExercised",
      "failedJoinNotShownActive",
      "noCrossAppointmentLeakage",
      "recoveryWindowMeasured",
    ],
  },
  {
    id: "otlp-collector-outage",
    when: () => true,
    assertions: ["applicationSafetyIndependent", "exporterFailureObservable", "restoredTelemetryObserved", "sanitizedEvidence"],
  },
  {
    id: "critical-workflow-failure-safety",
    when: () => true,
    assertions: ["bookingCapacitySafe", "clinicalWritesUnambiguous", "unaffectedReadsAvailable"],
  },
];

function command(commandName, args) {
  return execFileSync(commandName, args, { encoding: "utf8" }).trim();
}

function currentGitSha() {
  const value = command("git", ["rev-parse", "HEAD"]).toLowerCase();
  if (!FULL_GIT_SHA.test(value)) throw new Error("Unable to resolve a full current Git SHA.");
  return value;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function requiredObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value;
}

function requiredString(value, label, maxLength = 500) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} must be a non-empty string.`);
  const result = value.trim();
  if (result.length > maxLength || /[\r\n\0]/.test(result)) throw new Error(`${label} must be one line and at most ${maxLength} characters.`);
  return result;
}

function requireReference(value, label) {
  return requiredString(value, label, 500);
}

function requireBoolean(value, label, expected) {
  if (typeof value !== "boolean") throw new Error(`${label} must be boolean.`);
  if (typeof expected === "boolean" && value !== expected) throw new Error(`${label} must be ${expected}.`);
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
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`${label} must be a non-negative number.`);
  return value;
}

function scanSensitiveData(value, trail = "evidence") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanSensitiveData(item, `${trail}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (FORBIDDEN_KEYS.has(normalizedKey)) throw new Error(`Sensitive/PHI-like key ${trail}.${key} is not allowed.`);
      scanSensitiveData(child, `${trail}.${key}`);
    }
    return;
  }
  if (typeof value === "string") {
    for (const pattern of SENSITIVE_VALUE_PATTERNS) {
      if (pattern.test(value)) throw new Error(`Sensitive credential-like value detected at ${trail}.`);
    }
  }
}

function scenarioMap(value) {
  if (!Array.isArray(value)) throw new Error("scenarios must be an array.");
  const map = new Map();
  for (const item of value) {
    const scenario = requiredObject(item, "scenario");
    const id = requiredString(scenario.id, "scenario.id", 100);
    if (map.has(id)) throw new Error(`Duplicate scenario ${id}.`);
    map.set(id, scenario);
  }
  const expected = new Set(SCENARIOS.map((item) => item.id));
  for (const id of map.keys()) if (!expected.has(id)) throw new Error(`Unexpected resilience scenario ${id}.`);
  for (const id of expected) if (!map.has(id)) throw new Error(`Missing required resilience scenario record ${id}.`);
  return map;
}

function validateScenario(root, definition, scenario) {
  if (!APPLICABILITY.has(scenario.applicability)) throw new Error(`${definition.id}.applicability is invalid.`);
  if (!SCENARIO_STATUS.has(scenario.status)) throw new Error(`${definition.id}.status is invalid.`);
  const required = definition.when(root);

  if (!required) {
    if (scenario.applicability !== "NOT_APPLICABLE" || scenario.status !== "NOT_APPLICABLE") {
      throw new Error(`${definition.id} must be NOT_APPLICABLE for the approved scope/topology profile.`);
    }
    requireReference(scenario.notApplicableRationaleRef, `${definition.id}.notApplicableRationaleRef`);
    requireReference(scenario.notApplicableApprovalRef, `${definition.id}.notApplicableApprovalRef`);
    return { id: definition.id, applicable: false, status: "NOT_APPLICABLE" };
  }

  if (scenario.applicability !== "APPLICABLE") throw new Error(`${definition.id} is mandatory for the approved scope/topology profile.`);
  if (scenario.status !== "PASS") throw new Error(`${definition.id} must PASS for final resilience acceptance.`);

  const startedAt = requireTimestamp(scenario.startedAt, `${definition.id}.startedAt`);
  const completedAt = requireTimestamp(scenario.completedAt, `${definition.id}.completedAt`);
  if (Date.parse(completedAt) < Date.parse(startedAt)) throw new Error(`${definition.id}.completedAt cannot precede startedAt.`);
  requireReference(scenario.faultExecutionRef, `${definition.id}.faultExecutionRef`);
  requireReference(scenario.expectedSafeBehaviorRef, `${definition.id}.expectedSafeBehaviorRef`);
  requireReference(scenario.actualBehaviorRef, `${definition.id}.actualBehaviorRef`);
  requireReference(scenario.observationsRef, `${definition.id}.observationsRef`);
  requireReference(scenario.recoveryRef, `${definition.id}.recoveryRef`);
  const measurements = requiredObject(scenario.measurements, `${definition.id}.measurements`);
  requireNonNegativeNumber(measurements.recoverySeconds, `${definition.id}.measurements.recoverySeconds`);
  requireReference(measurements.metricsRef, `${definition.id}.measurements.metricsRef`);

  const assertions = requiredObject(scenario.assertions, `${definition.id}.assertions`);
  const requiredAssertions = [...definition.assertions];
  if (definition.id === "critical-workflow-failure-safety") {
    if (root.scope.paymentsEnabled) requiredAssertions.push("paymentStateRequiresProviderEvidence");
    if (root.scope.emergencyEnabled) requiredAssertions.push("emergencyDispatchNotFalselySuccessful");
  }
  for (const assertion of requiredAssertions) requireBoolean(assertions[assertion], `${definition.id}.assertions.${assertion}`, true);

  return {
    id: definition.id,
    applicable: true,
    status: scenario.status,
    recoverySeconds: measurements.recoverySeconds,
  };
}

function validateContinuity(root) {
  const continuity = requiredObject(root.continuity, "continuity");
  if (continuity.pitrScenarioId !== "postgres-pitr-restore") throw new Error("continuity.pitrScenarioId must be postgres-pitr-restore.");
  const incidentDeclaredAt = requireTimestamp(continuity.incidentDeclaredAt, "continuity.incidentDeclaredAt");
  const recoveryPointReferenceAt = requireTimestamp(continuity.recoveryPointReferenceAt, "continuity.recoveryPointReferenceAt");
  const recoveredDataThroughAt = requireTimestamp(continuity.recoveredDataThroughAt, "continuity.recoveredDataThroughAt");
  const acceptedHealthyAt = requireTimestamp(continuity.acceptedHealthyAt, "continuity.acceptedHealthyAt");
  if (Date.parse(acceptedHealthyAt) < Date.parse(incidentDeclaredAt)) throw new Error("continuity.acceptedHealthyAt cannot precede incidentDeclaredAt.");

  const computedRpoMinutes = Math.max(0, (Date.parse(recoveryPointReferenceAt) - Date.parse(recoveredDataThroughAt)) / 60000);
  const computedRtoMinutes = (Date.parse(acceptedHealthyAt) - Date.parse(incidentDeclaredAt)) / 60000;
  const statedRpoMinutes = requireNonNegativeNumber(continuity.rpoMinutes, "continuity.rpoMinutes");
  const statedRtoMinutes = requireNonNegativeNumber(continuity.rtoMinutes, "continuity.rtoMinutes");
  if (Math.abs(statedRpoMinutes - computedRpoMinutes) > 0.1) throw new Error("continuity.rpoMinutes does not match the supplied recovery timestamps.");
  if (Math.abs(statedRtoMinutes - computedRtoMinutes) > 0.1) throw new Error("continuity.rtoMinutes does not match the supplied recovery timestamps.");
  if (computedRpoMinutes > MAX_RPO_MINUTES) throw new Error(`Measured RPO exceeds ${MAX_RPO_MINUTES} minutes.`);
  if (computedRtoMinutes > MAX_RTO_MINUTES) throw new Error(`Measured RTO exceeds ${MAX_RTO_MINUTES} minutes.`);

  requireReference(continuity.pitrEvidenceRef, "continuity.pitrEvidenceRef");
  requireReference(continuity.integrityEvidenceRef, "continuity.integrityEvidenceRef");
  requireReference(continuity.runbookRef, "continuity.runbookRef");
  requireReference(continuity.handoffRef, "continuity.handoffRef");
  requireReference(continuity.operatorRef, "continuity.operatorRef");
  return { rpoMinutes: computedRpoMinutes, rtoMinutes: computedRtoMinutes };
}

async function validateEvidence(evidence) {
  const root = requiredObject(evidence, "evidence");
  scanSensitiveData(root);
  if (root.schema !== "carepoint.release-resilience-evidence/v1") throw new Error("Unsupported resilience evidence schema.");
  requireBoolean(root.sensitiveDataIncluded, "sensitiveDataIncluded", false);

  const release = requiredObject(root.release, "release");
  const sourceSha = requireFullSha(release.sourceSha, "release.sourceSha");
  const checkoutSha = currentGitSha();
  if (sourceSha !== checkoutSha) throw new Error(`release.sourceSha ${sourceSha} does not match checkout ${checkoutSha}.`);
  requireDigest(release.artifactDigest, "release.artifactDigest");
  requireReference(release.releaseVersion, "release.releaseVersion");
  requireReference(release.buildEvidenceRef, "release.buildEvidenceRef");

  const environment = requiredObject(root.environment, "environment");
  if (!ENVIRONMENT_CLASSIFICATIONS.has(environment.classification)) throw new Error("environment.classification must be production-equivalent or production.");
  requireReference(environment.id, "environment.id");
  requireReference(environment.topologyEvidenceRef, "environment.topologyEvidenceRef");
  requireReference(environment.providerProfileRef, "environment.providerProfileRef");
  requireReference(environment.scopeApprovalRef, "environment.scopeApprovalRef");

  const scope = requiredObject(root.scope, "scope");
  for (const key of ["notificationsEnabled", "paymentsEnabled", "telehealthEnabled", "emergencyEnabled"]) requireBoolean(scope[key], `scope.${key}`);
  const topology = requiredObject(root.topology, "topology");
  requireBoolean(topology.postgresReadReplicas, "topology.postgresReadReplicas");

  const execution = requiredObject(root.execution, "execution");
  requireReference(execution.exerciseId, "execution.exerciseId");
  const executionStartedAt = requireTimestamp(execution.startedAt, "execution.startedAt");
  const executionCompletedAt = requireTimestamp(execution.completedAt, "execution.completedAt");
  if (Date.parse(executionCompletedAt) < Date.parse(executionStartedAt)) throw new Error("execution.completedAt cannot precede execution.startedAt.");
  requireReference(execution.operatorRef, "execution.operatorRef");
  if (environment.classification === "production") {
    requireBoolean(execution.productionFaultInjectionApproved, "execution.productionFaultInjectionApproved", true);
    requireReference(execution.changeApprovalRef, "execution.changeApprovalRef");
  } else {
    requireBoolean(execution.isolatedEnvironment, "execution.isolatedEnvironment", true);
    requireReference(execution.isolationEvidenceRef, "execution.isolationEvidenceRef");
  }

  const rootForPredicates = { ...root, scope, topology };
  const scenarios = scenarioMap(root.scenarios);
  const scenarioResults = SCENARIOS.map((definition) => validateScenario(rootForPredicates, definition, scenarios.get(definition.id)));

  const continuity = validateContinuity(root);
  const observability = requiredObject(root.observability, "observability");
  requireReference(observability.dashboardRef, "observability.dashboardRef");
  requireReference(observability.alertEvidenceRef, "observability.alertEvidenceRef");
  requireReference(observability.traceCorrelationRef, "observability.traceCorrelationRef");
  requireReference(observability.exporterFailureRef, "observability.exporterFailureRef");
  requireBoolean(observability.sanitized, "observability.sanitized", true);

  const approvals = requiredObject(root.approvals, "approvals");
  for (const role of ["operations", "sre", "database", "security", "product"]) requireBoolean(approvals[role], `approvals.${role}`, true);
  requireBoolean(approvals.clinicalRequired, "approvals.clinicalRequired");
  if (approvals.clinicalRequired) requireBoolean(approvals.clinical, "approvals.clinical", true);
  requireBoolean(approvals.accepted, "approvals.accepted", true);
  requireReference(approvals.approvalRef, "approvals.approvalRef");

  return {
    schema: "carepoint.release-resilience-validation/v1",
    valid: true,
    sourceSha,
    artifactDigest: release.artifactDigest,
    environmentClassification: environment.classification,
    scenarios: scenarioResults,
    rpoMinutes: continuity.rpoMinutes,
    rtoMinutes: continuity.rtoMinutes,
    validatedAt: new Date().toISOString(),
    note: "Contract validation proves evidence completeness/consistency only; it does not execute failure injection, failover or PITR.",
  };
}

function validateDraft(plan) {
  const root = requiredObject(plan, "plan");
  scanSensitiveData(root);
  if (root.schema !== "carepoint.release-resilience-plan/v1") throw new Error("Unsupported resilience plan schema.");
  requireBoolean(root.approved, "approved", false);
  requireBoolean(root.sensitiveDataIncluded, "sensitiveDataIncluded", false);
  requireReference(root.note, "note");
  if (!Array.isArray(root.scenarioCatalog)) throw new Error("scenarioCatalog must be an array.");
  const ids = root.scenarioCatalog.map((item) => {
    const scenario = requiredObject(item, "scenarioCatalog item");
    const id = requiredString(scenario.id, "scenarioCatalog.id", 100);
    requireBoolean(scenario.enabled, `${id}.enabled`, false);
    requireReference(scenario.ownerRole, `${id}.ownerRole`);
    requireReference(scenario.executionRunbookRef, `${id}.executionRunbookRef`);
    requireReference(scenario.evidenceOwnerRef, `${id}.evidenceOwnerRef`);
    return id;
  });
  const expected = SCENARIOS.map((item) => item.id).sort();
  const actual = [...new Set(ids)].sort();
  if (ids.length !== actual.length || JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("Draft scenario catalog must contain every mandatory resilience scenario exactly once.");
  return { schema: "carepoint.release-resilience-plan-validation/v1", valid: true, scenarioCount: actual.length };
}

async function contractEvidence(planPath) {
  const planBytes = await readFile(path.resolve(process.cwd(), planPath));
  const plan = JSON.parse(planBytes.toString("utf8"));
  const draft = validateDraft(plan);
  const scriptBytes = await readFile(new URL(import.meta.url));
  return {
    schema: "carepoint.release-resilience-contract/v1",
    sourceSha: currentGitSha(),
    scriptSha256: sha256(scriptBytes),
    planSha256: sha256(planBytes),
    scenarioCount: draft.scenarioCount,
    scenarioIds: SCENARIOS.map((item) => item.id),
    continuityGates: { maxRpoMinutes: MAX_RPO_MINUTES, maxRtoMinutes: MAX_RTO_MINUTES },
    safety: {
      destructiveExecutionInWorkflow: false,
      productionExecutionRequiresExplicitChangeApproval: true,
      publicEvidenceMustExcludeSecretsAndPhi: true,
    },
    note: "This immutable contract artifact validates the rehearsal evidence schema only. It does not execute faults or establish #90 acceptance.",
  };
}

function fixtureScenario(definition, applicable = true) {
  if (!applicable) {
    return {
      id: definition.id,
      applicability: "NOT_APPLICABLE",
      status: "NOT_APPLICABLE",
      notApplicableRationaleRef: `evidence://${definition.id}/rationale`,
      notApplicableApprovalRef: `evidence://${definition.id}/approval`,
    };
  }
  const assertions = Object.fromEntries(definition.assertions.map((key) => [key, true]));
  if (definition.id === "critical-workflow-failure-safety") {
    assertions.paymentStateRequiresProviderEvidence = true;
    assertions.emergencyDispatchNotFalselySuccessful = true;
  }
  return {
    id: definition.id,
    applicability: "APPLICABLE",
    status: "PASS",
    startedAt: "2026-01-01T00:00:00Z",
    completedAt: "2026-01-01T00:02:00Z",
    faultExecutionRef: `evidence://${definition.id}/fault`,
    expectedSafeBehaviorRef: `evidence://${definition.id}/expected`,
    actualBehaviorRef: `evidence://${definition.id}/actual`,
    observationsRef: `evidence://${definition.id}/observations`,
    recoveryRef: `evidence://${definition.id}/recovery`,
    measurements: { recoverySeconds: 120, metricsRef: `evidence://${definition.id}/metrics` },
    assertions,
  };
}

function validFixture() {
  const sourceSha = currentGitSha();
  return {
    schema: "carepoint.release-resilience-evidence/v1",
    sensitiveDataIncluded: false,
    release: {
      sourceSha,
      artifactDigest: `sha256:${"a".repeat(64)}`,
      releaseVersion: "release-1-self-test",
      buildEvidenceRef: "evidence://release/build",
    },
    environment: {
      id: "synthetic-production-equivalent",
      classification: "production-equivalent",
      topologyEvidenceRef: "evidence://environment/topology",
      providerProfileRef: "evidence://environment/providers",
      scopeApprovalRef: "evidence://environment/scope",
    },
    scope: { notificationsEnabled: true, paymentsEnabled: true, telehealthEnabled: true, emergencyEnabled: true },
    topology: { postgresReadReplicas: true },
    execution: {
      exerciseId: "synthetic-self-test",
      startedAt: "2026-01-01T00:00:00Z",
      completedAt: "2026-01-01T00:40:00Z",
      operatorRef: "evidence://operator",
      isolatedEnvironment: true,
      isolationEvidenceRef: "evidence://environment/isolation",
    },
    scenarios: SCENARIOS.map((definition) => fixtureScenario(definition, true)),
    continuity: {
      pitrScenarioId: "postgres-pitr-restore",
      incidentDeclaredAt: "2026-01-01T00:00:00Z",
      recoveryPointReferenceAt: "2026-01-01T00:05:00Z",
      recoveredDataThroughAt: "2026-01-01T00:00:00Z",
      acceptedHealthyAt: "2026-01-01T00:40:00Z",
      rpoMinutes: 5,
      rtoMinutes: 40,
      pitrEvidenceRef: "evidence://continuity/pitr",
      integrityEvidenceRef: "evidence://continuity/integrity",
      runbookRef: "evidence://continuity/runbook",
      handoffRef: "evidence://continuity/handoff",
      operatorRef: "evidence://continuity/operator",
    },
    observability: {
      dashboardRef: "evidence://observability/dashboard",
      alertEvidenceRef: "evidence://observability/alerts",
      traceCorrelationRef: "evidence://observability/traces",
      exporterFailureRef: "evidence://observability/exporter",
      sanitized: true,
    },
    approvals: {
      operations: true,
      sre: true,
      database: true,
      security: true,
      product: true,
      clinicalRequired: true,
      clinical: true,
      accepted: true,
      approvalRef: "evidence://approvals/final",
    },
  };
}

async function expectRejected(label, mutate) {
  const fixture = structuredClone(validFixture());
  mutate(fixture);
  try {
    await validateEvidence(fixture);
  } catch {
    return;
  }
  throw new Error(`Self-test expected rejection: ${label}.`);
}

async function selfTest() {
  await validateEvidence(validFixture());
  await expectRejected("wrong SHA", (fixture) => { fixture.release.sourceSha = "1".repeat(40); });
  await expectRejected("missing scenario", (fixture) => { fixture.scenarios.pop(); });
  await expectRejected("failed assertion", (fixture) => {
    fixture.scenarios.find((item) => item.id === "redis-loss-failover").assertions.noRetryStorm = false;
  });
  await expectRejected("RPO ceiling", (fixture) => {
    fixture.continuity.recoveredDataThroughAt = "2025-12-31T23:40:00Z";
    fixture.continuity.rpoMinutes = 25;
  });
  await expectRejected("RTO ceiling", (fixture) => {
    fixture.continuity.acceptedHealthyAt = "2026-01-01T02:10:00Z";
    fixture.continuity.rtoMinutes = 130;
  });
  await expectRejected("sensitive evidence", (fixture) => { fixture.password = "should-not-appear"; });
  await expectRejected("required scenario marked N/A", (fixture) => {
    const scenario = fixture.scenarios.find((item) => item.id === "redis-loss-failover");
    scenario.applicability = "NOT_APPLICABLE";
    scenario.status = "NOT_APPLICABLE";
    scenario.notApplicableRationaleRef = "evidence://rationale";
    scenario.notApplicableApprovalRef = "evidence://approval";
  });

  const conditional = validFixture();
  conditional.scope.telehealthEnabled = false;
  const telehealthIndex = conditional.scenarios.findIndex((item) => item.id === "telehealth-provider-network-outage");
  conditional.scenarios[telehealthIndex] = fixtureScenario(SCENARIOS.find((item) => item.id === "telehealth-provider-network-outage"), false);
  await validateEvidence(conditional);

  const production = validFixture();
  production.environment.classification = "production";
  delete production.execution.isolatedEnvironment;
  delete production.execution.isolationEvidenceRef;
  await expectRejected("production without explicit approval", (fixture) => {
    fixture.environment.classification = "production";
    delete fixture.execution.isolatedEnvironment;
    delete fixture.execution.isolationEvidenceRef;
  });
  production.execution.productionFaultInjectionApproved = true;
  production.execution.changeApprovalRef = "evidence://change/approved";
  await validateEvidence(production);

  process.stdout.write("Release 1 resilience evidence contract self-test PASS\n");
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--self-test") return selfTest();
  if (args.length === 2 && args[0] === "--validate-draft") {
    const plan = JSON.parse(await readFile(path.resolve(process.cwd(), args[1]), "utf8"));
    const result = validateDraft(plan);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (args.length === 3 && args[0] === "--contract-out") {
    const result = await contractEvidence(args[1]);
    await writeFile(path.resolve(process.cwd(), args[2]), `${JSON.stringify(result, null, 2)}\n`, "utf8");
    process.stdout.write(`Wrote resilience contract evidence to ${args[2]}\n`);
    return;
  }
  if (args.length === 4 && args[0] === "--validate" && args[2] === "--out") {
    const evidence = JSON.parse(await readFile(path.resolve(process.cwd(), args[1]), "utf8"));
    const result = await validateEvidence(evidence);
    await writeFile(path.resolve(process.cwd(), args[3]), `${JSON.stringify(result, null, 2)}\n`, "utf8");
    process.stdout.write(`Validated resilience evidence and wrote ${args[3]}\n`);
    return;
  }
  throw new Error("Usage: --self-test | --validate-draft <plan.json> | --contract-out <plan.json> <out.json> | --validate <evidence.json> --out <out.json>");
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
