import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { performance } from "node:perf_hooks";

const HARNESS_VERSION = "1.0.0";
const MODEL_SCHEMA = "carepoint.release-performance-model/v1";
const RESULT_SCHEMA = "carepoint.release-performance-result/v1";
const CONTRACT_SCHEMA = "carepoint.release-performance-harness-contract/v1";
const FULL_GIT_SHA = /^[0-9a-f]{40}$/i;
const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/i;
const RELEASE_VERSION = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,63}$/;
const REQUIRED_SCENARIO_KINDS = [
  "common-read",
  "search",
  "availability-read",
  "booking-race",
  "booking-lifecycle",
  "webhook-replay",
  "notification-event",
  "telehealth-start",
  "admin-read",
];
const REQUIRED_SCENARIO_SET = new Set(REQUIRED_SCENARIO_KINDS);
const MANDATORY_P95_MS = Object.freeze({ "common-read": 500, search: 800 });
const SENSITIVE_HEADER_NAMES = new Set([
  "authorization",
  "proxy-authorization",
  "x-api-key",
  "x-auth-token",
  "x-signature",
  "x-webhook-signature",
]);
const FORBIDDEN_PUBLIC_KEYS = new Set([
  "password",
  "passphrase",
  "clientsecret",
  "apikey",
  "accesstoken",
  "refreshtoken",
  "privatekey",
  "patientname",
  "mrn",
  "nationalid",
  "dateofbirth",
  "dob",
]);
const SECRET_VALUE_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/i,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  /https?:\/\/[^\s/@:]+:[^\s/@]+@/i,
  /[?&](?:token|access_token|api_key|apikey|secret|password)=([^&\s]+)/i,
];
const PENDING_MARKER = /(?:^|[-_\s])(pending|tbd|todo|replace|approve)(?:$|[-_\s])/i;
const RUNTIME_VARIABLES = new Set(["CAREPOINT_PERF_REQUEST_ID", "CAREPOINT_PERF_SEQUENCE"]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function currentGitSha() {
  const explicit = process.env.CAREPOINT_PERF_SOURCE_SHA?.trim();
  if (explicit && FULL_GIT_SHA.test(explicit)) return explicit.toLowerCase();
  try {
    const value = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim().toLowerCase();
    if (FULL_GIT_SHA.test(value)) return value;
  } catch {
    // Fall through to deterministic failure below.
  }
  throw new Error("Unable to resolve the exact full Git SHA. Run inside the checked-out repository or set CAREPOINT_PERF_SOURCE_SHA.");
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
  const result = requiredString(value, label, 500);
  if (PENDING_MARKER.test(result)) throw new Error(`${label} must be an approved evidence/reference value, not a pending placeholder.`);
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

function requireFiniteNumber(value, label, { min = -Infinity, max = Infinity, integer = false } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} must be a finite number.`);
  if (integer && !Number.isInteger(value)) throw new Error(`${label} must be an integer.`);
  if (value < min || value > max) throw new Error(`${label} must be between ${min} and ${max}.`);
  return value;
}

function scanPublicSafety(value, trail = "model") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanPublicSafety(item, `${trail}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (FORBIDDEN_PUBLIC_KEYS.has(normalized)) {
        throw new Error(`PHI/credential-like key ${trail}.${key} is not allowed in a versioned performance model/result.`);
      }
      scanPublicSafety(child, `${trail}.${key}`);
    }
    return;
  }
  if (typeof value === "string") {
    for (const pattern of SECRET_VALUE_PATTERNS) {
      if (pattern.test(value)) throw new Error(`Credential-like literal detected at ${trail}; use an environment placeholder instead.`);
    }
  }
}

function containsEnvironmentPlaceholder(value) {
  return typeof value === "string" && /\$\{[A-Z][A-Z0-9_]*\}/.test(value);
}

function validateRequestDraft(request, label) {
  const input = requiredObject(request, label);
  const method = requiredString(input.method, `${label}.method`, 12).toUpperCase();
  if (!["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"].includes(method)) throw new Error(`${label}.method is unsupported.`);
  const requestPath = requiredString(input.path, `${label}.path`, 1200);
  if (!(requestPath.startsWith("/") || /^\$\{[A-Z][A-Z0-9_]*\}$/.test(requestPath))) {
    throw new Error(`${label}.path must be a CarePoint-relative path, not an absolute URL.`);
  }
  if (requestPath.includes("://")) throw new Error(`${label}.path must not contain an absolute URL.`);

  if (input.headers !== undefined) {
    const headers = requiredObject(input.headers, `${label}.headers`);
    for (const [name, rawValue] of Object.entries(headers)) {
      const value = requiredString(rawValue, `${label}.headers.${name}`, 2000);
      if (SENSITIVE_HEADER_NAMES.has(name.toLowerCase()) && !containsEnvironmentPlaceholder(value)) {
        throw new Error(`${label}.headers.${name} must use an environment placeholder; literal sensitive headers are forbidden.`);
      }
    }
  }

  const statuses = input.expectedStatus;
  if (!Array.isArray(statuses) || statuses.length === 0 || statuses.some((status) => !Number.isInteger(status) || status < 100 || status > 599)) {
    throw new Error(`${label}.expectedStatus must be a non-empty array of HTTP status integers.`);
  }

  scanPublicSafety(input.body, `${label}.body`);
}

function validateDraftModel(model) {
  const root = requiredObject(model, "model");
  scanPublicSafety(root);
  if (root.schema !== MODEL_SCHEMA) throw new Error(`model.schema must be ${MODEL_SCHEMA}.`);
  if (typeof root.approved !== "boolean") throw new Error("model.approved must be boolean.");
  requiredString(root.approvedTrafficModelRef, "model.approvedTrafficModelRef", 500);
  requiredObject(root.environment, "model.environment");
  requiredObject(root.release, "model.release");
  requiredString(root.baseUrl, "model.baseUrl", 1000);

  if (!Array.isArray(root.scenarios) || root.scenarios.length === 0) throw new Error("model.scenarios must be a non-empty array.");
  const ids = new Set();
  const kinds = new Set();
  for (const [index, scenarioValue] of root.scenarios.entries()) {
    const scenario = requiredObject(scenarioValue, `model.scenarios[${index}]`);
    const id = requiredString(scenario.id, `model.scenarios[${index}].id`, 100);
    if (!/^[a-z0-9][a-z0-9._-]{0,99}$/i.test(id)) throw new Error(`Scenario id ${id} has an invalid format.`);
    if (ids.has(id)) throw new Error(`Duplicate scenario id: ${id}.`);
    ids.add(id);
    const kind = requiredString(scenario.kind, `model.scenarios[${index}].kind`, 80);
    if (!REQUIRED_SCENARIO_SET.has(kind)) throw new Error(`Unsupported Release 1 scenario kind: ${kind}.`);
    kinds.add(kind);
    if (typeof scenario.enabled !== "boolean") throw new Error(`model.scenarios[${index}].enabled must be boolean.`);
    if (!Array.isArray(scenario.requests) || scenario.requests.length === 0) throw new Error(`model.scenarios[${index}].requests must be non-empty.`);
    scenario.requests.forEach((request, requestIndex) => validateRequestDraft(request, `model.scenarios[${index}].requests[${requestIndex}]`));
  }

  const missing = REQUIRED_SCENARIO_KINDS.filter((kind) => !kinds.has(kind));
  if (missing.length > 0) throw new Error(`Draft model is missing required Release 1 scenario kinds: ${missing.join(", ")}.`);
  return { scenarioCount: root.scenarios.length, kinds: [...kinds].sort() };
}

function validateThresholds(thresholdsValue, label) {
  const thresholds = requiredObject(thresholdsValue, label);
  requireFiniteNumber(thresholds.maxErrorRate, `${label}.maxErrorRate`, { min: 0, max: 1 });
  requireFiniteNumber(thresholds.maxTimeoutRate, `${label}.maxTimeoutRate`, { min: 0, max: 1 });
  if (thresholds.minThroughputPerSecond !== undefined) {
    requireFiniteNumber(thresholds.minThroughputPerSecond, `${label}.minThroughputPerSecond`, { min: 0 });
  }
  if (thresholds.maxP99Ms !== undefined) requireFiniteNumber(thresholds.maxP99Ms, `${label}.maxP99Ms`, { min: 0 });
}

function validateLoad(loadValue, label) {
  const load = requiredObject(loadValue, label);
  if (!Array.isArray(load.stages) || load.stages.length === 0 || load.stages.length > 20) {
    throw new Error(`${label}.stages must contain 1..20 stages.`);
  }
  const safetyMaxConcurrency = Number(process.env.CAREPOINT_PERF_MAX_CONCURRENCY ?? "2000");
  if (!Number.isInteger(safetyMaxConcurrency) || safetyMaxConcurrency < 1) throw new Error("CAREPOINT_PERF_MAX_CONCURRENCY must be a positive integer when set.");
  for (const [index, stageValue] of load.stages.entries()) {
    const stage = requiredObject(stageValue, `${label}.stages[${index}]`);
    requireFiniteNumber(stage.durationSeconds, `${label}.stages[${index}].durationSeconds`, { min: 0.05, max: 3600 });
    requireFiniteNumber(stage.concurrency, `${label}.stages[${index}].concurrency`, { min: 1, max: safetyMaxConcurrency, integer: true });
  }
}

function validateReleaseModel(model, { allowLocal = false } = {}) {
  validateDraftModel(model);
  const root = model;
  if (root.approved !== true) throw new Error("Release performance execution requires model.approved=true.");
  requireReference(root.approvedTrafficModelRef, "model.approvedTrafficModelRef");

  const environment = requiredObject(root.environment, "model.environment");
  if (environment.classification !== "production-equivalent") {
    throw new Error("Release 1 harness refuses production traffic by default; environment.classification must be production-equivalent.");
  }
  requireReference(environment.id, "model.environment.id");
  requireReference(environment.topologyRef, "model.environment.topologyRef");
  requireReference(environment.evidenceRef, "model.environment.evidenceRef");

  const release = requiredObject(root.release, "model.release");
  const version = requiredString(release.version, "model.release.version", 64);
  if (!RELEASE_VERSION.test(version)) throw new Error("model.release.version has an invalid format.");
  const sourceSha = requireFullSha(release.sourceSha, "model.release.sourceSha");
  const checkoutSha = currentGitSha();
  if (sourceSha !== checkoutSha) throw new Error(`model.release.sourceSha ${sourceSha} does not match checked-out exact SHA ${checkoutSha}.`);
  requireReference(release.buildRef, "model.release.buildRef");
  requireDigest(release.artifactDigest, "model.release.artifactDigest");

  const baseUrlTemplate = requiredString(root.baseUrl, "model.baseUrl", 1000);
  const baseUrl = resolveTemplate(baseUrlTemplate, { requestId: "validation", sequence: 0 });
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error("model.baseUrl must resolve to an absolute URL.");
  }
  const local = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !(allowLocal && local && parsed.protocol === "http:")) {
    throw new Error("Release performance base URL must use HTTPS; plain HTTP is accepted only for internal local self-test.");
  }
  if (!allowLocal && local) throw new Error("Release performance execution cannot target localhost.");

  requireFiniteNumber(root.timeoutMs, "model.timeoutMs", { min: 100, max: 120000, integer: true });
  const observability = requiredObject(root.observability, "model.observability");
  requireReference(observability.otlpWindowRef, "model.observability.otlpWindowRef");
  requireReference(observability.saturationEvidenceRef, "model.observability.saturationEvidenceRef");
  requireReference(observability.autoscalingEvidenceRef, "model.observability.autoscalingEvidenceRef");

  const enabledKinds = new Set();
  for (const [index, scenario] of root.scenarios.entries()) {
    if (!scenario.enabled) continue;
    enabledKinds.add(scenario.kind);
    validateThresholds(scenario.thresholds, `model.scenarios[${index}].thresholds`);
    if (scenario.kind === "booking-race") {
      const race = requiredObject(scenario.race, `model.scenarios[${index}].race`);
      const safetyMaxConcurrency = Number(process.env.CAREPOINT_PERF_MAX_CONCURRENCY ?? "2000");
      requireFiniteNumber(race.attempts, `model.scenarios[${index}].race.attempts`, { min: 2, max: safetyMaxConcurrency, integer: true });
      requireFiniteNumber(race.expectedSuccesses, `model.scenarios[${index}].race.expectedSuccesses`, { min: 1, max: race.attempts, integer: true });
      if (!Array.isArray(race.successStatuses) || race.successStatuses.length === 0) throw new Error(`model.scenarios[${index}].race.successStatuses must be non-empty.`);
      if (!Array.isArray(race.rejectionStatuses) || race.rejectionStatuses.length === 0) throw new Error(`model.scenarios[${index}].race.rejectionStatuses must be non-empty.`);
      requireReference(scenario.integrityEvidenceRef, `model.scenarios[${index}].integrityEvidenceRef`);
    } else {
      validateLoad(scenario.load, `model.scenarios[${index}].load`);
    }

    if (scenario.kind === "webhook-replay") requireReference(scenario.idempotencyIntegrityEvidenceRef, `model.scenarios[${index}].idempotencyIntegrityEvidenceRef`);
    if (scenario.kind === "notification-event") requireReference(scenario.outboxEvidenceRef, `model.scenarios[${index}].outboxEvidenceRef`);
    if (scenario.kind === "telehealth-start") requireReference(scenario.providerCapacityEvidenceRef, `model.scenarios[${index}].providerCapacityEvidenceRef`);
  }
  const missingEnabled = REQUIRED_SCENARIO_KINDS.filter((kind) => !enabledKinds.has(kind));
  if (missingEnabled.length > 0) throw new Error(`Approved Release 1 model must enable all required scenario kinds: ${missingEnabled.join(", ")}.`);

  return { checkoutSha, baseUrl, version };
}

function resolveTemplate(value, runtime) {
  if (Array.isArray(value)) return value.map((item) => resolveTemplate(item, runtime));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, resolveTemplate(child, runtime)]));
  }
  if (typeof value !== "string") return value;
  return value.replace(/\$\{([A-Z][A-Z0-9_]*)\}/g, (_, name) => {
    if (RUNTIME_VARIABLES.has(name)) {
      if (name === "CAREPOINT_PERF_REQUEST_ID") return runtime.requestId;
      if (name === "CAREPOINT_PERF_SEQUENCE") return String(runtime.sequence);
    }
    const envValue = process.env[name];
    if (envValue === undefined || envValue === "") throw new Error(`Required performance environment variable ${name} is missing.`);
    return envValue;
  });
}

async function drainResponse(response) {
  if (!response.body) return;
  const reader = response.body.getReader();
  while (true) {
    const { done } = await reader.read();
    if (done) break;
  }
}

async function executeRequest(baseUrl, requestTemplate, timeoutMs, sequence) {
  const runtime = { requestId: randomUUID(), sequence };
  const request = resolveTemplate(requestTemplate, runtime);
  if (typeof request.path !== "string" || !request.path.startsWith("/") || request.path.includes("://")) {
    throw new Error("Resolved performance request path must remain a relative CarePoint API path.");
  }
  const url = new URL(request.path, baseUrl);
  const headers = { ...(request.headers ?? {}) };
  let body;
  if (request.body !== undefined) {
    if (typeof request.body === "string") body = request.body;
    else {
      body = JSON.stringify(request.body);
      if (!Object.keys(headers).some((name) => name.toLowerCase() === "content-type")) headers["content-type"] = "application/json";
    }
  }

  const started = performance.now();
  try {
    const response = await fetch(url, {
      method: request.method,
      headers,
      ...(body !== undefined ? { body } : {}),
      signal: AbortSignal.timeout(timeoutMs),
    });
    await drainResponse(response);
    const durationMs = performance.now() - started;
    const expected = request.expectedStatus.includes(response.status);
    return { durationMs, status: response.status, expected, timeout: false, networkError: false };
  } catch (error) {
    const durationMs = performance.now() - started;
    const timeout = error?.name === "TimeoutError" || error?.name === "AbortError";
    return { durationMs, status: null, expected: false, timeout, networkError: !timeout };
  }
}

function percentile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1);
  return Math.round(sorted[index] * 100) / 100;
}

function metricSummary(samples, elapsedSeconds) {
  const durations = samples.map((sample) => sample.durationMs);
  const total = samples.length;
  const errorCount = samples.filter((sample) => !sample.expected).length;
  const timeoutCount = samples.filter((sample) => sample.timeout).length;
  const networkErrorCount = samples.filter((sample) => sample.networkError).length;
  const statuses = {};
  for (const sample of samples) {
    const key = sample.status === null ? (sample.timeout ? "TIMEOUT" : "NETWORK_ERROR") : String(sample.status);
    statuses[key] = (statuses[key] ?? 0) + 1;
  }
  return {
    requests: total,
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    p99Ms: percentile(durations, 0.99),
    throughputPerSecond: elapsedSeconds > 0 ? Math.round((total / elapsedSeconds) * 100) / 100 : null,
    errorRate: total > 0 ? Math.round((errorCount / total) * 100000) / 100000 : null,
    timeoutRate: total > 0 ? Math.round((timeoutCount / total) * 100000) / 100000 : null,
    networkErrorCount,
    statuses,
  };
}

function thresholdEvaluation(kind, summary, thresholds) {
  const checks = [];
  if (Object.prototype.hasOwnProperty.call(MANDATORY_P95_MS, kind)) {
    const limit = MANDATORY_P95_MS[kind];
    checks.push({ name: `${kind}.source-p95`, operator: "<", limit, actual: summary.p95Ms, pass: summary.p95Ms !== null && summary.p95Ms < limit, sourceDerived: true });
  }
  checks.push({ name: `${kind}.approved-max-error-rate`, operator: "<=", limit: thresholds.maxErrorRate, actual: summary.errorRate, pass: summary.errorRate !== null && summary.errorRate <= thresholds.maxErrorRate, sourceDerived: false });
  checks.push({ name: `${kind}.approved-max-timeout-rate`, operator: "<=", limit: thresholds.maxTimeoutRate, actual: summary.timeoutRate, pass: summary.timeoutRate !== null && summary.timeoutRate <= thresholds.maxTimeoutRate, sourceDerived: false });
  if (thresholds.minThroughputPerSecond !== undefined) {
    checks.push({ name: `${kind}.approved-min-throughput`, operator: ">=", limit: thresholds.minThroughputPerSecond, actual: summary.throughputPerSecond, pass: summary.throughputPerSecond !== null && summary.throughputPerSecond >= thresholds.minThroughputPerSecond, sourceDerived: false });
  }
  if (thresholds.maxP99Ms !== undefined) {
    checks.push({ name: `${kind}.approved-max-p99`, operator: "<=", limit: thresholds.maxP99Ms, actual: summary.p99Ms, pass: summary.p99Ms !== null && summary.p99Ms <= thresholds.maxP99Ms, sourceDerived: false });
  }
  return checks;
}

async function runTimedScenario(baseUrl, scenario, timeoutMs) {
  const samples = [];
  const stageResults = [];
  let sequence = 0;
  const scenarioStarted = performance.now();
  for (const [stageIndex, stage] of scenario.load.stages.entries()) {
    const stageStarted = performance.now();
    const deadline = stageStarted + stage.durationSeconds * 1000;
    const workers = Array.from({ length: stage.concurrency }, async (_, workerIndex) => {
      let requestIndex = workerIndex % scenario.requests.length;
      while (performance.now() < deadline) {
        const template = scenario.requests[requestIndex % scenario.requests.length];
        const localSequence = sequence++;
        samples.push(await executeRequest(baseUrl, template, timeoutMs, localSequence));
        requestIndex += 1;
      }
    });
    await Promise.all(workers);
    const stageElapsedSeconds = (performance.now() - stageStarted) / 1000;
    stageResults.push({ stageIndex, configuredDurationSeconds: stage.durationSeconds, concurrency: stage.concurrency, observedDurationSeconds: Math.round(stageElapsedSeconds * 1000) / 1000 });
  }
  const elapsedSeconds = (performance.now() - scenarioStarted) / 1000;
  const summary = metricSummary(samples, elapsedSeconds);
  const checks = thresholdEvaluation(scenario.kind, summary, scenario.thresholds);
  return { id: scenario.id, kind: scenario.kind, profile: { mode: "staged-concurrency", stages: stageResults }, ...summary, checks, pass: checks.every((check) => check.pass) };
}

async function runBookingRace(baseUrl, scenario, timeoutMs) {
  const started = performance.now();
  const template = scenario.requests[0];
  const samples = await Promise.all(Array.from({ length: scenario.race.attempts }, (_, index) => executeRequest(baseUrl, template, timeoutMs, index)));
  const elapsedSeconds = (performance.now() - started) / 1000;
  const summary = metricSummary(samples, elapsedSeconds);
  const successSet = new Set(scenario.race.successStatuses);
  const rejectionSet = new Set(scenario.race.rejectionStatuses);
  const successCount = samples.filter((sample) => sample.status !== null && successSet.has(sample.status)).length;
  const unexpectedStatuses = samples.filter((sample) => sample.status !== null && !successSet.has(sample.status) && !rejectionSet.has(sample.status)).length;
  const raceCheck = {
    name: "booking-race.expected-success-count",
    operator: "==",
    limit: scenario.race.expectedSuccesses,
    actual: successCount,
    pass: successCount === scenario.race.expectedSuccesses && unexpectedStatuses === 0,
    sourceDerived: true,
  };
  const checks = [raceCheck, ...thresholdEvaluation(scenario.kind, summary, scenario.thresholds)];
  return {
    id: scenario.id,
    kind: scenario.kind,
    profile: { mode: "single-slot-race", attempts: scenario.race.attempts },
    ...summary,
    successCount,
    unexpectedStatuses,
    integrityEvidenceRef: scenario.integrityEvidenceRef,
    checks,
    pass: checks.every((check) => check.pass),
  };
}

async function runModel(model, options = {}) {
  const validated = validateReleaseModel(model, options);
  const enabledScenarios = model.scenarios.filter((scenario) => scenario.enabled);
  const results = [];
  const startedAt = new Date();
  for (const scenario of enabledScenarios) {
    const result = scenario.kind === "booking-race"
      ? await runBookingRace(validated.baseUrl, scenario, model.timeoutMs)
      : await runTimedScenario(validated.baseUrl, scenario, model.timeoutMs);
    if (scenario.kind === "webhook-replay") result.idempotencyIntegrityEvidenceRef = scenario.idempotencyIntegrityEvidenceRef;
    if (scenario.kind === "notification-event") result.outboxEvidenceRef = scenario.outboxEvidenceRef;
    if (scenario.kind === "telehealth-start") result.providerCapacityEvidenceRef = scenario.providerCapacityEvidenceRef;
    results.push(result);
  }
  const completedAt = new Date();
  const output = {
    schema: RESULT_SCHEMA,
    harnessVersion: HARNESS_VERSION,
    release: {
      version: validated.version,
      sourceSha: validated.checkoutSha,
      buildRef: model.release.buildRef,
      artifactDigest: model.release.artifactDigest,
    },
    approvedTrafficModelRef: model.approvedTrafficModelRef,
    environment: {
      id: model.environment.id,
      classification: model.environment.classification,
      topologyRef: model.environment.topologyRef,
      evidenceRef: model.environment.evidenceRef,
    },
    observability: model.observability,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    scenarios: results,
    pass: results.every((result) => result.pass),
    note: "Results intentionally exclude request URLs, request/response bodies, authorization material and PHI. Telehealth provider/media capacity remains external evidence referenced by the approved model.",
  };
  scanPublicSafety(output, "result");
  return output;
}

async function writeResult(output, outputDirectory) {
  const dir = path.resolve(process.cwd(), outputDirectory);
  await mkdir(dir, { recursive: true });
  const resultPath = path.join(dir, "performance-result.json");
  const json = `${JSON.stringify(output, null, 2)}\n`;
  await writeFile(resultPath, json, "utf8");
  const digest = sha256(Buffer.from(json));
  await writeFile(path.join(dir, "SHA256SUMS"), `${digest}  performance-result.json\n`, "utf8");
  return { resultPath, digest: `sha256:${digest}` };
}

async function contractEvidence(draftModelPath, outputPath) {
  const modelBytes = await readFile(path.resolve(process.cwd(), draftModelPath));
  const model = JSON.parse(modelBytes.toString("utf8"));
  const coverage = validateDraftModel(model);
  const scriptPath = path.resolve(process.cwd(), ".ci/release-performance-harness.mjs");
  const scriptBytes = await readFile(scriptPath);
  const evidence = {
    schema: CONTRACT_SCHEMA,
    harnessVersion: HARNESS_VERSION,
    sourceSha: currentGitSha(),
    requiredScenarioKinds: REQUIRED_SCENARIO_KINDS,
    mandatoryP95Ms: MANDATORY_P95_MS,
    draftModel: {
      path: draftModelPath,
      sha256: sha256(modelBytes),
      scenarioCount: coverage.scenarioCount,
      kinds: coverage.kinds,
      approved: model.approved,
    },
    harnessSha256: sha256(scriptBytes),
    generatedAt: new Date().toISOString(),
    note: "Contract evidence validates the versioned harness/catalog only. It is not target-load evidence and does not close #89.",
  };
  scanPublicSafety(evidence, "contractEvidence");
  await mkdir(path.dirname(path.resolve(process.cwd(), outputPath)), { recursive: true });
  await writeFile(path.resolve(process.cwd(), outputPath), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  return evidence;
}

async function startSelfTestServer() {
  let raceSuccesses = 0;
  const server = createServer(async (req, res) => {
    for await (const _ of req) {
      // Drain synthetic request body without retaining it.
    }
    if (req.url === "/slow-search") await new Promise((resolve) => setTimeout(resolve, 825));
    if (req.url === "/race") {
      raceSuccesses += 1;
      if (raceSuccesses === 1) {
        res.writeHead(201, { "content-type": "application/json" });
        res.end("{}\n");
      } else {
        res.writeHead(409, { "content-type": "application/json" });
        res.end("{}\n");
      }
      return;
    }
    const status = req.url === "/notify" ? 202 : req.url === "/webhook" ? 204 : 200;
    res.writeHead(status, { "content-type": "application/json" });
    res.end(status === 204 ? undefined : "{}\n");
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return { server, baseUrl: `http://127.0.0.1:${address.port}`, resetRace() { raceSuccesses = 0; } };
}

function selfTestModel(baseUrl, sourceSha, searchPath = "/search") {
  const normal = (id, kind, requestPath, expectedStatus = [200]) => ({
    id,
    kind,
    enabled: true,
    requests: [{ method: "GET", path: requestPath, expectedStatus }],
    load: { stages: [{ durationSeconds: 0.05, concurrency: 1 }] },
    thresholds: { maxErrorRate: 0, maxTimeoutRate: 0 },
    ...(kind === "webhook-replay" ? { idempotencyIntegrityEvidenceRef: "synthetic://webhook-integrity" } : {}),
    ...(kind === "notification-event" ? { outboxEvidenceRef: "synthetic://outbox" } : {}),
    ...(kind === "telehealth-start" ? { providerCapacityEvidenceRef: "synthetic://provider-capacity" } : {}),
  });
  return {
    schema: MODEL_SCHEMA,
    approved: true,
    approvedTrafficModelRef: "synthetic://approved-traffic-model",
    environment: { classification: "production-equivalent", id: "synthetic-self-test", topologyRef: "synthetic://topology", evidenceRef: "synthetic://environment" },
    release: { version: "1.0.0-selftest", sourceSha, buildRef: "synthetic://build", artifactDigest: `sha256:${"a".repeat(64)}` },
    baseUrl,
    timeoutMs: 3000,
    observability: { otlpWindowRef: "synthetic://otlp", saturationEvidenceRef: "synthetic://saturation", autoscalingEvidenceRef: "synthetic://autoscaling" },
    scenarios: [
      normal("common", "common-read", "/read"),
      normal("search", "search", searchPath),
      normal("availability", "availability-read", "/availability"),
      {
        id: "race",
        kind: "booking-race",
        enabled: true,
        requests: [{ method: "POST", path: "/race", body: { slotId: "synthetic", idempotencyKey: "${CAREPOINT_PERF_REQUEST_ID}" }, expectedStatus: [201, 409] }],
        race: { attempts: 6, expectedSuccesses: 1, successStatuses: [201], rejectionStatuses: [409] },
        thresholds: { maxErrorRate: 1, maxTimeoutRate: 0 },
        integrityEvidenceRef: "synthetic://booking-integrity",
      },
      normal("lifecycle", "booking-lifecycle", "/lifecycle"),
      normal("webhook", "webhook-replay", "/webhook", [204]),
      normal("notification", "notification-event", "/notify", [202]),
      normal("telehealth", "telehealth-start", "/telehealth"),
      normal("admin", "admin-read", "/admin"),
    ],
  };
}

async function selfTest() {
  const sourceSha = currentGitSha();
  const fixture = await startSelfTestServer();
  try {
    const good = await runModel(selfTestModel(fixture.baseUrl, sourceSha), { allowLocal: true });
    if (!good.pass) throw new Error("Expected synthetic performance model to pass.");
    fixture.resetRace();
    const slow = await runModel(selfTestModel(fixture.baseUrl, sourceSha, "/slow-search"), { allowLocal: true });
    const slowSearch = slow.scenarios.find((scenario) => scenario.kind === "search");
    if (!slowSearch || slowSearch.pass !== false || !slowSearch.checks.some((check) => check.sourceDerived && check.pass === false)) {
      throw new Error("Expected source-derived search p95 threshold self-test to fail.");
    }
    console.log(JSON.stringify({ selfTest: "PASS", harnessVersion: HARNESS_VERSION, sourceSha, requiredScenarioKinds: REQUIRED_SCENARIO_KINDS.length, mandatoryP95Ms: MANDATORY_P95_MS }));
  } finally {
    await new Promise((resolve) => fixture.server.close(resolve));
  }
}

function usage() {
  console.error("Usage: node .ci/release-performance-harness.mjs --self-test | --validate-draft <model.json> | --contract-out <draft-model.json> <output.json> | --run <approved-model.json> --out <directory>");
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--self-test") return selfTest();
  if (args.length === 2 && args[0] === "--validate-draft") {
    const model = JSON.parse(await readFile(path.resolve(process.cwd(), args[1]), "utf8"));
    const result = validateDraftModel(model);
    console.log(JSON.stringify({ draftValidation: "PASS", ...result }));
    return;
  }
  if (args.length === 3 && args[0] === "--contract-out") {
    const evidence = await contractEvidence(args[1], args[2]);
    console.log(JSON.stringify({ contractEvidence: "PASS", sourceSha: evidence.sourceSha, output: args[2] }));
    return;
  }
  if (args.length === 4 && args[0] === "--run" && args[2] === "--out") {
    if (process.env.CAREPOINT_PERF_EXECUTION_APPROVED !== "true") {
      throw new Error("Set CAREPOINT_PERF_EXECUTION_APPROVED=true only inside the approved production-equivalent performance window.");
    }
    const model = JSON.parse(await readFile(path.resolve(process.cwd(), args[1]), "utf8"));
    const output = await runModel(model);
    const written = await writeResult(output, args[3]);
    console.log(JSON.stringify({ performanceGate: output.pass ? "PASS" : "FAIL", result: written.resultPath, digest: written.digest }));
    if (!output.pass) process.exitCode = 1;
    return;
  }
  usage();
  process.exitCode = 2;
}

await main();
