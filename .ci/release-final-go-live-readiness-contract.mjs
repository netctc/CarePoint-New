import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const FULL_SHA = /^[0-9a-f]{40}$/i;
const SHA256 = /^sha256:[0-9a-f]{64}$/i;
const GATE_IDS = ["R3", "R4", "R5", "R6", "R7", "R8", "R9", "R10"];
const MOBILE_APPS = ["patient", "doctor", "provider"];
const APPROVAL_ROLES = [
  "Release Authority",
  "Operations",
  "SRE",
  "Security",
  "Database",
  "Privacy/Compliance",
  "Clinical Safety",
  "Product/Market",
];
const FORBIDDEN_KEYS = new Set([
  "password", "passphrase", "clientsecret", "apikey", "accesstoken", "refreshtoken",
  "privatekey", "authorization", "cookie", "connectionstring", "databaseurl",
  "patientid", "patientname", "mrn", "nationalid", "dateofbirth", "dob",
  "phivalue", "rawrequest", "requestbody", "cardnumber", "pan", "cvv",
]);
const SENSITIVE_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/i,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  /https?:\/\/[^\s/@:]+:[^\s/@]+@/i,
  /[?&](?:token|access_token|api_key|apikey|secret|password)=([^&\s]+)/i,
];
const PLACEHOLDER = /(TO-BE-SET|PENDING|PLACEHOLDER|EXAMPLE|<[^>]+>)/i;

function command(name, args) {
  return execFileSync(name, args, { encoding: "utf8" }).trim();
}
function currentGitSha() {
  const value = command("git", ["rev-parse", "HEAD"]).toLowerCase();
  if (!FULL_SHA.test(value)) throw new Error("Unable to resolve full Git SHA.");
  return value;
}
function requiredObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value;
}
function requiredString(value, label, max = 500) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} must be a non-empty string.`);
  const result = value.trim();
  if (result.length > max || /[\r\n\0]/.test(result)) throw new Error(`${label} must be one line and at most ${max} chars.`);
  return result;
}
function productionRef(value, label) {
  const result = requiredString(value, label, 500);
  if (PLACEHOLDER.test(result)) throw new Error(`${label} contains placeholder text.`);
  return result;
}
function fullSha(value, label) {
  const result = requiredString(value, label, 40).toLowerCase();
  if (!FULL_SHA.test(result) || /^0{40}$/.test(result)) throw new Error(`${label} must be a non-zero full Git SHA.`);
  return result;
}
function digest(value, label) {
  const result = requiredString(value, label, 80).toLowerCase();
  if (!SHA256.test(result) || /^sha256:0{64}$/.test(result)) throw new Error(`${label} must be a non-zero sha256 digest.`);
  return result;
}
function boolean(value, label, expected) {
  if (typeof value !== "boolean") throw new Error(`${label} must be boolean.`);
  if (typeof expected === "boolean" && value !== expected) throw new Error(`${label} must be ${expected}.`);
  return value;
}
function integer(value, label, min = 0) {
  if (!Number.isInteger(value) || value < min) throw new Error(`${label} must be an integer >= ${min}.`);
  return value;
}
function enumValue(value, label, allowed) {
  const result = requiredString(value, label, 100);
  if (!allowed.includes(result)) throw new Error(`${label} must be one of: ${allowed.join(", ")}.`);
  return result;
}
function timestamp(value, label) {
  const result = requiredString(value, label, 80);
  const epoch = Date.parse(result);
  if (!Number.isFinite(epoch)) throw new Error(`${label} must be an ISO-compatible timestamp.`);
  return { value: result, epoch };
}
function scanSensitive(value, trail = "evidence") {
  if (Array.isArray(value)) return value.forEach((item, i) => scanSensitive(item, `${trail}[${i}]`));
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (FORBIDDEN_KEYS.has(normalized)) throw new Error(`Sensitive/PHI-like key ${trail}.${key} is forbidden.`);
      scanSensitive(child, `${trail}.${key}`);
    }
    return;
  }
  if (typeof value === "string") {
    for (const pattern of SENSITIVE_PATTERNS) {
      if (pattern.test(value)) throw new Error(`Credential-like value detected at ${trail}.`);
    }
  }
}
function indexed(items, label, field, expected) {
  if (!Array.isArray(items)) throw new Error(`${label} must be an array.`);
  const map = new Map();
  for (const [i, raw] of items.entries()) {
    const item = requiredObject(raw, `${label}[${i}]`);
    const key = requiredString(item[field], `${label}[${i}].${field}`, 120);
    if (map.has(key)) throw new Error(`${label} contains duplicate ${field} ${key}.`);
    map.set(key, item);
  }
  const missing = expected.filter((key) => !map.has(key));
  const unknown = [...map.keys()].filter((key) => !expected.includes(key));
  if (missing.length || unknown.length) {
    throw new Error(`${label} mismatch; missing=[${missing.join(",")}] unknown=[${unknown.join(",")}].`);
  }
  return map;
}

export function validateTemplate(input) {
  const root = requiredObject(input, "template");
  scanSensitive(root);
  if (requiredString(root.schema, "schema", 120) !== "carepoint.release-go-live-readiness/v1") {
    throw new Error("Unsupported final go-live schema.");
  }
  boolean(root.approved, "approved", false);
  if (requiredString(root.overallStatus, "overallStatus", 40) !== "BLOCKED") throw new Error("Template must remain BLOCKED.");
  boolean(root.sensitiveDataIncluded, "sensitiveDataIncluded", false);
  const gates = indexed(root.gates, "gates", "id", GATE_IDS);
  for (const id of GATE_IDS) {
    if (requiredString(gates.get(id).status, `gates.${id}.status`, 40) !== "BLOCKED") {
      throw new Error(`Template gate ${id} must remain BLOCKED.`);
    }
  }
  const apps = indexed(root.mobileArtifacts, "mobileArtifacts", "app", MOBILE_APPS);
  for (const app of MOBILE_APPS) {
    for (const platform of ["android", "ios"]) {
      boolean(requiredObject(apps.get(app)[platform], `mobileArtifacts.${app}.${platform}`).signed, `mobileArtifacts.${app}.${platform}.signed`, false);
    }
  }
  const promotion = requiredObject(root.promotion, "promotion");
  boolean(promotion.authorized, "promotion.authorized", false);
  if (requiredString(promotion.finalDecision, "promotion.finalDecision", 40) !== "NO-GO") throw new Error("Template finalDecision must be NO-GO.");
  indexed(root.approvals, "approvals", "role", APPROVAL_ROLES);
  return {
    schema: root.schema,
    productionAcceptance: false,
    gateCount: GATE_IDS.length,
    mobileAppCount: MOBILE_APPS.length,
    approvalCount: APPROVAL_ROLES.length,
  };
}

export async function validateEvidence(input, { checkoutSha = currentGitSha() } = {}) {
  const root = requiredObject(input, "evidence");
  scanSensitive(root);
  if (requiredString(root.schema, "schema", 120) !== "carepoint.release-go-live-readiness/v1") throw new Error("Unsupported final go-live schema.");
  boolean(root.approved, "approved", true);
  if (requiredString(root.overallStatus, "overallStatus", 40) !== "GO") throw new Error("overallStatus must be GO.");
  boolean(root.sensitiveDataIncluded, "sensitiveDataIncluded", false);

  const release = requiredObject(root.release, "release");
  const sourceSha = fullSha(release.sourceSha, "release.sourceSha");
  if (sourceSha !== checkoutSha.toLowerCase()) throw new Error(`release.sourceSha ${sourceSha} does not match checkout ${checkoutSha}.`);
  requiredString(release.releaseVersion, "release.releaseVersion", 120);
  digest(release.rcEvidenceDigest, "release.rcEvidenceDigest");
  digest(release.apiArtifactDigest, "release.apiArtifactDigest");
  digest(release.adminArtifactDigest, "release.adminArtifactDigest");
  productionRef(release.rcEvidenceRef, "release.rcEvidenceRef");

  const environment = requiredObject(root.environment, "environment");
  requiredString(environment.id, "environment.id", 120);
  enumValue(environment.classification, "environment.classification", ["production-equivalent", "production"]);
  if (requiredString(environment.jurisdiction, "environment.jurisdiction", 40) !== "KSA") throw new Error("Final Release 1 jurisdiction must be KSA.");
  enumValue(environment.launchCloud, "environment.launchCloud", ["OCI", "GCP"]);
  productionRef(environment.evidenceRef, "environment.evidenceRef");

  let latestGateEpoch = 0;
  const gates = indexed(root.gates, "gates", "id", GATE_IDS);
  for (const id of GATE_IDS) {
    const gate = gates.get(id);
    if (requiredString(gate.status, `gates.${id}.status`, 40) !== "PASS") throw new Error(`${id} must PASS.`);
    const gateSha = fullSha(gate.sourceSha, `gates.${id}.sourceSha`);
    if (gateSha !== sourceSha) throw new Error(`${id} is bound to a different source SHA.`);
    productionRef(gate.contractEvidenceRef, `gates.${id}.contractEvidenceRef`);
    productionRef(gate.acceptanceEvidenceRef, `gates.${id}.acceptanceEvidenceRef`);
    productionRef(gate.authorityRef, `gates.${id}.authorityRef`);
    latestGateEpoch = Math.max(latestGateEpoch, timestamp(gate.acceptedAt, `gates.${id}.acceptedAt`).epoch);
  }

  const security = requiredObject(root.security, "security");
  if (requiredString(security.independentCodeQLStatus, "security.independentCodeQLStatus", 40) !== "PASS") throw new Error("Independent CodeQL must PASS.");
  integer(security.unresolvedCriticalHighFindings, "security.unresolvedCriticalHighFindings");
  if (security.unresolvedCriticalHighFindings !== 0) throw new Error("Critical/High findings must be zero or formally resolved before GO.");
  if (requiredString(security.securityOwnerDisposition, "security.securityOwnerDisposition", 40) !== "APPROVED") throw new Error("Security Owner disposition must be APPROVED.");
  if (requiredString(security.pentestStatus, "security.pentestStatus", 40) !== "PASS") throw new Error("External penetration/adversarial assessment must PASS.");
  productionRef(security.codeQLEvidenceRef, "security.codeQLEvidenceRef");
  productionRef(security.securityOwnerEvidenceRef, "security.securityOwnerEvidenceRef");
  productionRef(security.pentestEvidenceRef, "security.pentestEvidenceRef");

  const apps = indexed(root.mobileArtifacts, "mobileArtifacts", "app", MOBILE_APPS);
  for (const app of MOBILE_APPS) {
    const entry = apps.get(app);
    for (const platform of ["android", "ios"]) {
      const artifact = requiredObject(entry[platform], `mobileArtifacts.${app}.${platform}`);
      boolean(artifact.signed, `mobileArtifacts.${app}.${platform}.signed`, true);
      digest(artifact.digest, `mobileArtifacts.${app}.${platform}.digest`);
      productionRef(artifact.evidenceRef, `mobileArtifacts.${app}.${platform}.evidenceRef`);
    }
    productionRef(entry.deviceAcceptanceRef, `mobileArtifacts.${app}.deviceAcceptanceRef`);
  }

  const promotion = requiredObject(root.promotion, "promotion");
  boolean(promotion.authorized, "promotion.authorized", true);
  if (requiredString(promotion.sourceBranch, "promotion.sourceBranch", 120) !== "release/release-1-integration-go-live-readiness") {
    throw new Error("Unexpected promotion sourceBranch.");
  }
  if (requiredString(promotion.targetBranch, "promotion.targetBranch", 120) !== "main") throw new Error("Promotion targetBranch must be main.");
  if (requiredString(promotion.finalDecision, "promotion.finalDecision", 40) !== "GO") throw new Error("promotion.finalDecision must be GO.");
  productionRef(promotion.policyEvidenceRef, "promotion.policyEvidenceRef");
  productionRef(promotion.finalDecisionRef, "promotion.finalDecisionRef");

  let latestApprovalEpoch = 0;
  const approvals = indexed(root.approvals, "approvals", "role", APPROVAL_ROLES);
  for (const role of APPROVAL_ROLES) {
    const approval = approvals.get(role);
    if (requiredString(approval.decision, `approvals.${role}.decision`, 40) !== "APPROVE") throw new Error(`${role} must APPROVE.`);
    productionRef(approval.approverRef, `approvals.${role}.approverRef`);
    productionRef(approval.evidenceRef, `approvals.${role}.evidenceRef`);
    latestApprovalEpoch = Math.max(latestApprovalEpoch, timestamp(approval.approvedAt, `approvals.${role}.approvedAt`).epoch);
  }

  const accepted = timestamp(root.acceptedAt, "acceptedAt");
  if (accepted.epoch < latestGateEpoch) throw new Error("acceptedAt cannot predate the latest R3-R10 gate acceptance.");
  if (accepted.epoch < latestApprovalEpoch) throw new Error("acceptedAt cannot predate the latest final approval.");

  return {
    schema: root.schema,
    approved: true,
    overallStatus: "GO",
    sourceSha,
    releaseVersion: release.releaseVersion,
    launchCloud: environment.launchCloud,
    jurisdiction: environment.jurisdiction,
    gateCount: GATE_IDS.length,
    signedMobileArtifactCount: MOBILE_APPS.length * 2,
    approvalCount: APPROVAL_ROLES.length,
    independentCodeQLStatus: security.independentCodeQLStatus,
    pentestStatus: security.pentestStatus,
    acceptedAt: accepted.value,
  };
}

function makeSyntheticEvidence(checkoutSha) {
  const d = (ch) => `sha256:${ch.repeat(64)}`;
  const acceptedAt = "2026-01-01T12:00:00Z";
  return {
    schema: "carepoint.release-go-live-readiness/v1",
    approved: true,
    overallStatus: "GO",
    sensitiveDataIncluded: false,
    release: {
      sourceSha: checkoutSha,
      releaseVersion: "synthetic-rc",
      rcEvidenceDigest: d("a"),
      apiArtifactDigest: d("b"),
      adminArtifactDigest: d("c"),
      rcEvidenceRef: "restricted://synthetic/rc-evidence",
    },
    environment: {
      id: "synthetic-production-equivalent",
      classification: "production-equivalent",
      jurisdiction: "KSA",
      launchCloud: "OCI",
      evidenceRef: "restricted://synthetic/environment",
    },
    gates: GATE_IDS.map((id) => ({
      id,
      status: "PASS",
      sourceSha: checkoutSha,
      contractEvidenceRef: `github-actions://synthetic/${id}/contract`,
      acceptanceEvidenceRef: `restricted://synthetic/${id}/acceptance`,
      authorityRef: `approval://synthetic/${id}`,
      acceptedAt: "2026-01-01T10:00:00Z",
    })),
    security: {
      independentCodeQLStatus: "PASS",
      unresolvedCriticalHighFindings: 0,
      securityOwnerDisposition: "APPROVED",
      pentestStatus: "PASS",
      codeQLEvidenceRef: "github-check://synthetic/codeql",
      securityOwnerEvidenceRef: "approval://synthetic/security-owner",
      pentestEvidenceRef: "restricted://synthetic/pentest",
    },
    mobileArtifacts: MOBILE_APPS.map((app, index) => ({
      app,
      android: { signed: true, digest: d(String(index + 1)), evidenceRef: `restricted://synthetic/${app}/android` },
      ios: { signed: true, digest: d(String(index + 4)), evidenceRef: `restricted://synthetic/${app}/ios` },
      deviceAcceptanceRef: `restricted://synthetic/${app}/device-acceptance`,
    })),
    promotion: {
      authorized: true,
      sourceBranch: "release/release-1-integration-go-live-readiness",
      targetBranch: "main",
      finalDecision: "GO",
      policyEvidenceRef: "restricted://synthetic/promotion-policy",
      finalDecisionRef: "approval://synthetic/final-go",
    },
    approvals: APPROVAL_ROLES.map((role) => ({
      role,
      decision: "APPROVE",
      approverRef: `identity://synthetic/${role.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      evidenceRef: `approval://synthetic/${role.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      approvedAt: "2026-01-01T11:00:00Z",
    })),
    acceptedAt,
  };
}

async function selfTest() {
  const sha = currentGitSha();
  const good = makeSyntheticEvidence(sha);
  await validateEvidence(good, { checkoutSha: sha });
  const cases = [
    ["wrong SHA", (x) => { x.release.sourceSha = "1".repeat(40); }],
    ["blocked gate", (x) => { x.gates[0].status = "BLOCKED"; }],
    ["mixed gate SHA", (x) => { x.gates[1].sourceSha = "2".repeat(40); }],
    ["CodeQL failure", (x) => { x.security.independentCodeQLStatus = "FAIL"; }],
    ["unresolved High", (x) => { x.security.unresolvedCriticalHighFindings = 1; }],
    ["Security Owner pending", (x) => { x.security.securityOwnerDisposition = "PENDING"; }],
    ["pentest failure", (x) => { x.security.pentestStatus = "FAIL"; }],
    ["unsigned mobile", (x) => { x.mobileArtifacts[0].android.signed = false; }],
    ["zero artifact digest", (x) => { x.mobileArtifacts[0].ios.digest = `sha256:${"0".repeat(64)}`; }],
    ["missing approval", (x) => { x.approvals[0].decision = "PENDING"; }],
    ["not authorized", (x) => { x.promotion.authorized = false; }],
    ["placeholder evidence", (x) => { x.gates[0].acceptanceEvidenceRef = "PENDING"; }],
    ["early acceptedAt", (x) => { x.acceptedAt = "2025-12-31T00:00:00Z"; }],
    ["sensitive key", (x) => { x.environment.apiKey = "forbidden"; }],
  ];
  for (const [name, mutate] of cases) {
    const copy = structuredClone(good);
    mutate(copy);
    let rejected = false;
    try { await validateEvidence(copy, { checkoutSha: sha }); } catch { rejected = true; }
    if (!rejected) throw new Error(`Self-test negative case was not rejected: ${name}`);
  }
  console.log(JSON.stringify({ selfTest: "PASS", sourceSha: sha, negativeCases: cases.length }));
}

async function contractEvidence(templatePath, outPath) {
  const input = JSON.parse(await readFile(path.resolve(process.cwd(), templatePath), "utf8"));
  const validation = validateTemplate(input);
  const raw = JSON.stringify(input);
  const output = {
    ...validation,
    sourceSha: currentGitSha(),
    templateSha256: createHash("sha256").update(raw).digest("hex"),
    workflowPurpose: "contract-validation-only",
    productionAcceptance: false,
    externalApprovalsExecuted: false,
  };
  await writeFile(path.resolve(process.cwd(), outPath), `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(output));
}

async function main() {
  const [mode, value, outFlag, outPath] = process.argv.slice(2);
  if (mode === "--self-test") return selfTest();
  if (mode === "--validate-template") {
    if (!value) throw new Error("--validate-template requires a JSON path.");
    const input = JSON.parse(await readFile(path.resolve(process.cwd(), value), "utf8"));
    console.log(JSON.stringify(validateTemplate(input)));
    return;
  }
  if (mode === "--contract-evidence") {
    if (!value || !outFlag) throw new Error("--contract-evidence requires <template.json> <out.json>.");
    return contractEvidence(value, outFlag);
  }
  if (mode === "--validate") {
    if (!value || outFlag !== "--out" || !outPath) throw new Error("--validate requires <evidence.json> --out <validation.json>.");
    const input = JSON.parse(await readFile(path.resolve(process.cwd(), value), "utf8"));
    const result = await validateEvidence(input);
    await writeFile(path.resolve(process.cwd(), outPath), `${JSON.stringify(result, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(result));
    return;
  }
  throw new Error("Usage: --self-test | --validate-template <template.json> | --contract-evidence <template.json> <out.json> | --validate <evidence.json> --out <validation.json>");
}

main().catch((error) => {
  console.error(`Final go-live readiness contract failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
