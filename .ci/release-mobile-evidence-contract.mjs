import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";

const FULL_GIT_SHA = /^[0-9a-f]{40}$/i;
const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/i;
const PACKAGE_ID = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*){2,}$/;
const APP_KEYS = ["patient-mobile", "doctor-mobile", "provider-mobile"];
const PLATFORMS = ["android", "ios"];
const STATUS = new Set(["PASS", "FAIL", "BLOCKED", "NOT_APPLICABLE"]);
const APPLICABILITY = new Set(["APPLICABLE", "NOT_APPLICABLE"]);
const APPROVAL_ROLES = ["MOBILE_ENGINEERING", "PRODUCT", "RELEASE_OPERATIONS", "SECURITY", "PRIVACY"];

const FORBIDDEN_KEYS = new Set([
  "password",
  "passphrase",
  "privatekey",
  "signingkey",
  "keystorepassword",
  "keypassword",
  "apikey",
  "clientsecret",
  "secret",
  "accesstoken",
  "refreshtoken",
  "devicetoken",
  "pushtoken",
  "authorization",
  "cookie",
  "patientid",
  "patientname",
  "mrn",
  "nationalid",
  "dateofbirth",
  "dob",
  "rawrequest",
  "requestbody",
]);

const SENSITIVE_VALUE_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/i,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  /https?:\/\/[^\s/@:]+:[^\s/@]+@/i,
  /[?&](?:token|access_token|api_key|apikey|secret|password)=([^&\s]+)/i,
];

const CONTROL_DEFINITIONS = [
  { id: "native-runners-committed", when: () => true },
  { id: "release-api-fail-closed", when: () => true },
  { id: "android-keystore-secure-storage", when: () => true },
  { id: "ios-keychain-secure-storage", when: () => true },
  { id: "token-logout-session-cleanup", when: () => true },
  { id: "app-switcher-sensitive-content", when: () => true },
  { id: "android-least-privilege-permissions", when: () => true },
  { id: "ios-usage-descriptions", when: () => true },
  { id: "ios-privacy-manifest", when: () => true },
  { id: "store-privacy-data-safety", when: () => true },
  { id: "telemedicine-native-media-lifecycle", when: (root) => root.scope.telemedicineEnabled },
  { id: "location-emergency-permission-fallback", when: (root) => root.scope.emergencyLocationEnabled },
  { id: "deep-link-hosted-payment-return", when: (root) => root.scope.hostedPaymentReturnEnabled },
  { id: "push-registration-rotation-logout", when: (root) => root.scope.pushEnabled },
  { id: "no-debug-test-endpoints-or-certificates", when: () => true },
  { id: "mobile-dependency-license-vulnerability-review", when: () => true },
  { id: "release-artifact-sha-traceability", when: () => true },
  { id: "english-release-smoke", when: () => true },
  { id: "arabic-rtl-release-smoke", when: () => true },
  { id: "accessibility-text-scaling-screen-reader", when: () => true },
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

function requiredArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
}

function requiredString(value, label, maxLength = 500) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} must be a non-empty string.`);
  const result = value.trim();
  if (result.length > maxLength || /[\r\n\0]/.test(result)) throw new Error(`${label} must be one line and at most ${maxLength} characters.`);
  return result;
}

function requiredBoolean(value, label, expected) {
  if (typeof value !== "boolean") throw new Error(`${label} must be boolean.`);
  if (typeof expected === "boolean" && value !== expected) throw new Error(`${label} must be ${expected}.`);
  return value;
}

function requiredPositiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer.`);
  return value;
}

function requireReference(value, label) {
  return requiredString(value, label, 500);
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

function requireProductionIdentity(value, label) {
  const result = requiredString(value, label, 180);
  if (!PACKAGE_ID.test(result)) throw new Error(`${label} must be a stable reverse-domain application identifier.`);
  const normalized = result.toLowerCase();
  if (normalized.includes("io.carepoint.validation") || normalized.includes("validation") || normalized.includes("debug") || normalized.includes("test")) {
    throw new Error(`${label} must not use a validation/debug/test identity.`);
  }
  return result;
}

function requireProductionApiUrl(value, label) {
  const result = requiredString(value, label, 500);
  let parsed;
  try {
    parsed = new URL(result);
  } catch {
    throw new Error(`${label} must be a valid URL.`);
  }
  if (parsed.protocol !== "https:") throw new Error(`${label} must use HTTPS.`);
  const host = parsed.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.endsWith(".localhost") ||
    host.endsWith(".invalid") ||
    host.includes("mobile-validation")
  ) {
    throw new Error(`${label} must not use a local or validation endpoint.`);
  }
  if (parsed.username || parsed.password) throw new Error(`${label} must not embed credentials.`);
  return result;
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

function keyedUniqueArray(value, key, expectedValues, label) {
  const items = requiredArray(value, label);
  const map = new Map();
  for (const item of items) {
    const object = requiredObject(item, `${label} item`);
    const id = requiredString(object[key], `${label}.${key}`, 120);
    if (map.has(id)) throw new Error(`Duplicate ${label} ${id}.`);
    map.set(id, object);
  }
  if (expectedValues) {
    for (const expected of expectedValues) if (!map.has(expected)) throw new Error(`Missing ${label} ${expected}.`);
    for (const actual of map.keys()) if (!expectedValues.includes(actual)) throw new Error(`Unexpected ${label} ${actual}.`);
  }
  return map;
}

function validateProfile(profile, app) {
  if (profile.app !== app) throw new Error(`Profile key mismatch for ${app}.`);
  requiredBoolean(profile.launchEnabled, `${app}.launchEnabled`, true);
  const androidApplicationId = requireProductionIdentity(profile.androidApplicationId, `${app}.androidApplicationId`);
  const iosBundleId = requireProductionIdentity(profile.iosBundleId, `${app}.iosBundleId`);
  requiredString(profile.displayName, `${app}.displayName`, 120);
  requireReference(profile.productDecisionRef, `${app}.productDecisionRef`);
  requireReference(profile.storeOwnershipRef, `${app}.storeOwnershipRef`);
  requireReference(profile.signingOwnershipRef, `${app}.signingOwnershipRef`);
  requiredPositiveInteger(profile.minimumAndroidApi, `${app}.minimumAndroidApi`);
  requiredString(profile.minimumIosVersion, `${app}.minimumIosVersion`, 40);
  requireReference(profile.supportedOsPolicyRef, `${app}.supportedOsPolicyRef`);
  if (profile.apiEnvironment !== "production") throw new Error(`${app}.apiEnvironment must be production for final release evidence.`);
  requireProductionApiUrl(profile.apiBaseUrl, `${app}.apiBaseUrl`);
  requireReference(profile.apiDomainApprovalRef, `${app}.apiDomainApprovalRef`);

  const deepLinks = requiredObject(profile.deepLinks, `${app}.deepLinks`);
  requiredBoolean(deepLinks.enabled, `${app}.deepLinks.enabled`);
  requireReference(deepLinks.decisionRef, `${app}.deepLinks.decisionRef`);
  if (deepLinks.enabled) {
    requireProductionApiUrl(deepLinks.httpsBase, `${app}.deepLinks.httpsBase`);
    requireReference(deepLinks.associationEvidenceRef, `${app}.deepLinks.associationEvidenceRef`);
  }

  const push = requiredObject(profile.push, `${app}.push`);
  requiredBoolean(push.enabled, `${app}.push.enabled`);
  requireReference(push.decisionRef, `${app}.push.decisionRef`);
  if (push.enabled) {
    requireReference(push.providerProfileRef, `${app}.push.providerProfileRef`);
    requireReference(push.platformConfigurationRef, `${app}.push.platformConfigurationRef`);
  }

  requiredBoolean(profile.telemedicineEnabled, `${app}.telemedicineEnabled`);
  requiredBoolean(profile.locationEmergencyEnabled, `${app}.locationEmergencyEnabled`);
  requiredBoolean(profile.hostedPaymentReturnEnabled, `${app}.hostedPaymentReturnEnabled`);
  if (app === "provider-mobile" && profile.telemedicineEnabled) throw new Error("provider-mobile cannot claim telemedicine acceptance in this Release 1 contract.");
  if (app !== "patient-mobile" && profile.locationEmergencyEnabled) throw new Error(`${app} cannot claim Patient emergency/location scope.`);
  if (app !== "patient-mobile" && profile.hostedPaymentReturnEnabled) throw new Error(`${app} cannot claim Patient hosted-payment return scope.`);

  return { androidApplicationId, iosBundleId };
}

function validateArtifact(artifact, profile, app, platform, sourceSha, seenDigests) {
  if (artifact.app !== app || artifact.platform !== platform) throw new Error(`Artifact identity mismatch for ${app}/${platform}.`);
  const expectedKind = platform === "android" ? "AAB" : "IPA";
  if (artifact.kind !== expectedKind) throw new Error(`${app}/${platform}.kind must be ${expectedKind}.`);
  const digest = requireDigest(artifact.digest, `${app}/${platform}.digest`);
  if (seenDigests.has(digest)) throw new Error(`Artifact digest ${digest} is duplicated.`);
  seenDigests.add(digest);
  requiredBoolean(artifact.signed, `${app}/${platform}.signed`, true);
  requiredBoolean(artifact.productionIdentity, `${app}/${platform}.productionIdentity`, true);
  requiredBoolean(artifact.debugBuild, `${app}/${platform}.debugBuild`, false);
  requiredBoolean(artifact.releaseShaEmbedded, `${app}/${platform}.releaseShaEmbedded`, true);
  if (requireFullSha(artifact.embeddedSourceSha, `${app}/${platform}.embeddedSourceSha`) !== sourceSha) {
    throw new Error(`${app}/${platform}.embeddedSourceSha must equal release.sourceSha.`);
  }
  const expectedIdentity = platform === "android" ? profile.androidApplicationId : profile.iosBundleId;
  if (artifact.applicationIdentity !== expectedIdentity) throw new Error(`${app}/${platform}.applicationIdentity must match the approved app profile.`);
  requireReference(artifact.buildEvidenceRef, `${app}/${platform}.buildEvidenceRef`);
  requireReference(artifact.signingEvidenceRef, `${app}/${platform}.signingEvidenceRef`);
  requireReference(artifact.binaryInspectionRef, `${app}/${platform}.binaryInspectionRef`);
  requireReference(artifact.artifactStoreRef, `${app}/${platform}.artifactStoreRef`);
  requireReference(artifact.releaseMetadataRef, `${app}/${platform}.releaseMetadataRef`);
  return digest;
}

function validateControls(root) {
  const expected = CONTROL_DEFINITIONS.map((item) => item.id);
  const controls = keyedUniqueArray(root.controls, "id", expected, "control");
  const summary = [];
  for (const definition of CONTROL_DEFINITIONS) {
    const control = controls.get(definition.id);
    if (!APPLICABILITY.has(control.applicability)) throw new Error(`${definition.id}.applicability is invalid.`);
    if (!STATUS.has(control.status)) throw new Error(`${definition.id}.status is invalid.`);
    const applicable = definition.when(root);
    if (applicable) {
      if (control.applicability !== "APPLICABLE" || control.status !== "PASS") throw new Error(`${definition.id} must be APPLICABLE/PASS.`);
      requireReference(control.evidenceRef, `${definition.id}.evidenceRef`);
      requireReference(control.ownerRoleRef, `${definition.id}.ownerRoleRef`);
      summary.push({ id: definition.id, status: "PASS" });
    } else {
      if (control.applicability !== "NOT_APPLICABLE" || control.status !== "NOT_APPLICABLE") throw new Error(`${definition.id} must be NOT_APPLICABLE.`);
      requireReference(control.notApplicableRationaleRef, `${definition.id}.notApplicableRationaleRef`);
      requireReference(control.notApplicableApprovalRef, `${definition.id}.notApplicableApprovalRef`);
      summary.push({ id: definition.id, status: "NOT_APPLICABLE" });
    }
  }
  return summary;
}

function deviceKey(app, platform) {
  return `${app}:${platform}`;
}

function validateDeviceMatrix(root, artifactsByKey) {
  const expected = APP_KEYS.flatMap((app) => PLATFORMS.map((platform) => deviceKey(app, platform)));
  const devices = requiredArray(root.deviceMatrix, "deviceMatrix");
  const map = new Map();
  for (const item of devices) {
    const record = requiredObject(item, "deviceMatrix item");
    const app = requiredString(record.app, "device.app", 80);
    const platform = requiredString(record.platform, "device.platform", 20);
    const key = deviceKey(app, platform);
    if (!expected.includes(key)) throw new Error(`Unexpected device matrix entry ${key}.`);
    if (map.has(key)) throw new Error(`Duplicate device matrix entry ${key}.`);
    map.set(key, record);
  }
  for (const key of expected) if (!map.has(key)) throw new Error(`Missing device matrix entry ${key}.`);

  for (const [key, record] of map) {
    const [app, platform] = key.split(":");
    if (record.status !== "PASS") throw new Error(`${key}.status must be PASS.`);
    requiredString(record.deviceFamily, `${key}.deviceFamily`, 120);
    requiredString(record.osVersion, `${key}.osVersion`, 80);
    requireReference(record.evidenceRef, `${key}.evidenceRef`);
    requireReference(record.testerRoleRef, `${key}.testerRoleRef`);
    const artifact = artifactsByKey.get(key);
    if (requireDigest(record.artifactDigest, `${key}.artifactDigest`) !== artifact.digest) throw new Error(`${key}.artifactDigest must match the signed release artifact.`);
    const scenarios = requiredObject(record.scenarios, `${key}.scenarios`);
    for (const scenario of ["loginSession", "primaryWorkflow", "offlineInterruption", "accessibilityBasics", "logoutSessionCleanup"]) {
      requiredBoolean(scenarios[scenario], `${key}.scenarios.${scenario}`, true);
    }
    const profile = root.appProfiles.find((item) => item.app === app);
    if ((app === "patient-mobile" || app === "doctor-mobile") && profile.telemedicineEnabled) requiredBoolean(scenarios.telemedicine, `${key}.scenarios.telemedicine`, true);
    if (app === "patient-mobile" && profile.locationEmergencyEnabled) requiredBoolean(scenarios.emergencyLocation, `${key}.scenarios.emergencyLocation`, true);
    if (app === "patient-mobile" && profile.hostedPaymentReturnEnabled) requiredBoolean(scenarios.hostedPaymentReturn, `${key}.scenarios.hostedPaymentReturn`, true);
    if (profile.push.enabled) requiredBoolean(scenarios.pushNotification, `${key}.scenarios.pushNotification`, true);
    if (app === "provider-mobile") requiredBoolean(scenarios.providerWorkQueueRoute, `${key}.scenarios.providerWorkQueueRoute`, true);
  }
  return map.size;
}

function validateApprovals(root) {
  const requiredRoles = [...APPROVAL_ROLES];
  if (root.scope.telemedicineEnabled || root.scope.emergencyLocationEnabled) requiredRoles.push("CLINICAL");
  const approvals = keyedUniqueArray(root.approvals, "role", requiredRoles, "approval");
  for (const role of requiredRoles) {
    const approval = approvals.get(role);
    if (approval.status !== "APPROVE") throw new Error(`${role} approval must be APPROVE.`);
    requireReference(approval.evidenceRef, `${role}.evidenceRef`);
    requireReference(approval.ownerRoleRef, `${role}.ownerRoleRef`);
  }
  return requiredRoles;
}

export function validateEvidence(evidence, options = {}) {
  const root = requiredObject(evidence, "evidence");
  scanSensitiveData(root);
  if (root.schema !== "carepoint.release-mobile-evidence/v1") throw new Error("Unsupported mobile release evidence schema.");
  if (root.overallStatus !== "PASS") throw new Error("overallStatus must be PASS for final acceptance.");
  requiredBoolean(root.approved, "approved", true);
  requiredBoolean(root.sensitiveDataIncluded, "sensitiveDataIncluded", false);

  const release = requiredObject(root.release, "release");
  const sourceSha = requireFullSha(release.sourceSha, "release.sourceSha");
  const checkoutSha = (options.checkoutSha || currentGitSha()).toLowerCase();
  if (sourceSha !== checkoutSha) throw new Error(`release.sourceSha ${sourceSha} does not match checkout ${checkoutSha}.`);
  requireReference(release.releaseVersion, "release.releaseVersion");
  requireDigest(release.apiArtifactDigest, "release.apiArtifactDigest");
  requireDigest(release.adminArtifactDigest, "release.adminArtifactDigest");
  requireReference(release.releaseCandidateEvidenceRef, "release.releaseCandidateEvidenceRef");
  requireReference(release.infrastructureEvidenceRef, "release.infrastructureEvidenceRef");
  requireReference(release.externalIntegrationEvidenceRef, "release.externalIntegrationEvidenceRef");

  const scope = requiredObject(root.scope, "scope");
  for (const key of ["telemedicineEnabled", "emergencyLocationEnabled", "hostedPaymentReturnEnabled", "pushEnabled"]) requiredBoolean(scope[key], `scope.${key}`);
  requireReference(scope.approvedLaunchScopeRef, "scope.approvedLaunchScopeRef");

  const profileMap = keyedUniqueArray(root.appProfiles, "app", APP_KEYS, "app profile");
  for (const app of APP_KEYS) validateProfile(profileMap.get(app), app);
  const profiles = APP_KEYS.map((app) => profileMap.get(app));
  if (scope.telemedicineEnabled !== profiles.some((profile) => profile.telemedicineEnabled)) throw new Error("scope.telemedicineEnabled must match app profile scope.");
  if (scope.emergencyLocationEnabled !== profiles.some((profile) => profile.locationEmergencyEnabled)) throw new Error("scope.emergencyLocationEnabled must match app profile scope.");
  if (scope.hostedPaymentReturnEnabled !== profiles.some((profile) => profile.hostedPaymentReturnEnabled)) throw new Error("scope.hostedPaymentReturnEnabled must match app profile scope.");
  if (scope.pushEnabled !== profiles.some((profile) => profile.push.enabled)) throw new Error("scope.pushEnabled must match app profile scope.");

  const artifacts = requiredArray(root.artifacts, "artifacts");
  const artifactMap = new Map();
  const seenDigests = new Set();
  for (const artifact of artifacts) {
    const object = requiredObject(artifact, "artifact");
    const app = requiredString(object.app, "artifact.app", 80);
    const platform = requiredString(object.platform, "artifact.platform", 20);
    const key = deviceKey(app, platform);
    if (!APP_KEYS.includes(app) || !PLATFORMS.includes(platform)) throw new Error(`Unexpected artifact ${key}.`);
    if (artifactMap.has(key)) throw new Error(`Duplicate artifact ${key}.`);
    const profile = profileMap.get(app);
    validateArtifact(object, profile, app, platform, sourceSha, seenDigests);
    artifactMap.set(key, object);
  }
  for (const app of APP_KEYS) for (const platform of PLATFORMS) if (!artifactMap.has(deviceKey(app, platform))) throw new Error(`Missing signed artifact ${app}/${platform}.`);
  if (artifactMap.size !== APP_KEYS.length * PLATFORMS.length) throw new Error("Exactly six signed mobile release artifacts are required.");

  const controls = validateControls(root);
  const deviceCount = validateDeviceMatrix(root, artifactMap);

  const localization = requiredObject(root.localization, "localization");
  requiredBoolean(localization.englishReleaseSmoke, "localization.englishReleaseSmoke", true);
  requiredBoolean(localization.arabicRtlReleaseSmoke, "localization.arabicRtlReleaseSmoke", true);
  requiredBoolean(localization.textScalingAccepted, "localization.textScalingAccepted", true);
  requiredBoolean(localization.screenReaderCriticalActionsAccepted, "localization.screenReaderCriticalActionsAccepted", true);
  requireReference(localization.evidenceRef, "localization.evidenceRef");

  const approvals = validateApprovals(root);
  requireReference(root.finalAcceptanceRef, "finalAcceptanceRef");

  return {
    schema: root.schema,
    sourceSha,
    apps: APP_KEYS.length,
    signedArtifacts: artifactMap.size,
    physicalDeviceRecords: deviceCount,
    controls,
    approvalRoles: approvals,
    productionReleaseEvidence: true,
  };
}

function makeValidSample(sha) {
  const profile = (app, index) => ({
    app,
    launchEnabled: true,
    androidApplicationId: `com.carepoint.release.${["patient", "doctor", "provider"][index]}`,
    iosBundleId: `com.carepoint.release.${["patient", "doctor", "provider"][index]}.ios`,
    displayName: ["CarePoint Patient", "CarePoint Doctor", "CarePoint Provider"][index],
    productDecisionRef: `evidence/product/${app}`,
    storeOwnershipRef: `evidence/store/${app}`,
    signingOwnershipRef: `evidence/signing-owner/${app}`,
    minimumAndroidApi: 1,
    minimumIosVersion: "1.0",
    supportedOsPolicyRef: `evidence/os-policy/${app}`,
    apiEnvironment: "production",
    apiBaseUrl: "https://api.release.carepoint.health/api/v1",
    apiDomainApprovalRef: "evidence/api-domain",
    deepLinks: {
      enabled: app === "patient-mobile",
      decisionRef: `evidence/deep-link-decision/${app}`,
      ...(app === "patient-mobile" ? { httpsBase: "https://links.release.carepoint.health", associationEvidenceRef: "evidence/deep-links/patient" } : {}),
    },
    push: {
      enabled: app === "patient-mobile",
      decisionRef: `evidence/push-decision/${app}`,
      ...(app === "patient-mobile" ? { providerProfileRef: "evidence/push/provider", platformConfigurationRef: "evidence/push/platforms" } : {}),
    },
    telemedicineEnabled: app === "patient-mobile" || app === "doctor-mobile",
    locationEmergencyEnabled: app === "patient-mobile",
    hostedPaymentReturnEnabled: app === "patient-mobile",
  });
  const appProfiles = APP_KEYS.map(profile);
  const artifacts = APP_KEYS.flatMap((app, appIndex) => PLATFORMS.map((platform, platformIndex) => {
    const digit = String((appIndex * 2 + platformIndex + 1) % 10);
    const selected = appProfiles[appIndex];
    return {
      app,
      platform,
      kind: platform === "android" ? "AAB" : "IPA",
      digest: `sha256:${digit.repeat(64)}`,
      signed: true,
      productionIdentity: true,
      debugBuild: false,
      releaseShaEmbedded: true,
      embeddedSourceSha: sha,
      applicationIdentity: platform === "android" ? selected.androidApplicationId : selected.iosBundleId,
      buildEvidenceRef: `evidence/build/${app}/${platform}`,
      signingEvidenceRef: `evidence/signing/${app}/${platform}`,
      binaryInspectionRef: `evidence/binary/${app}/${platform}`,
      artifactStoreRef: `evidence/artifact-store/${app}/${platform}`,
      releaseMetadataRef: `evidence/release-metadata/${app}/${platform}`,
    };
  }));
  const controls = CONTROL_DEFINITIONS.map((definition) => ({
    id: definition.id,
    applicability: "APPLICABLE",
    status: "PASS",
    evidenceRef: `evidence/control/${definition.id}`,
    ownerRoleRef: `owner/control/${definition.id}`,
  }));
  const deviceMatrix = APP_KEYS.flatMap((app) => PLATFORMS.map((platform) => {
    const selectedProfile = appProfiles.find((item) => item.app === app);
    const artifact = artifacts.find((item) => item.app === app && item.platform === platform);
    return {
      app,
      platform,
      status: "PASS",
      deviceFamily: `${platform}-representative-device`,
      osVersion: "approved-supported-version",
      artifactDigest: artifact.digest,
      evidenceRef: `evidence/device/${app}/${platform}`,
      testerRoleRef: "role/mobile-uat",
      scenarios: {
        loginSession: true,
        primaryWorkflow: true,
        offlineInterruption: true,
        accessibilityBasics: true,
        logoutSessionCleanup: true,
        ...(((app === "patient-mobile" || app === "doctor-mobile") && selectedProfile.telemedicineEnabled) ? { telemedicine: true } : {}),
        ...(app === "patient-mobile" && selectedProfile.locationEmergencyEnabled ? { emergencyLocation: true } : {}),
        ...(app === "patient-mobile" && selectedProfile.hostedPaymentReturnEnabled ? { hostedPaymentReturn: true } : {}),
        ...(selectedProfile.push.enabled ? { pushNotification: true } : {}),
        ...(app === "provider-mobile" ? { providerWorkQueueRoute: true } : {}),
      },
    };
  }));
  const approvalRoles = [...APPROVAL_ROLES, "CLINICAL"];
  return {
    schema: "carepoint.release-mobile-evidence/v1",
    overallStatus: "PASS",
    approved: true,
    sensitiveDataIncluded: false,
    release: {
      sourceSha: sha,
      releaseVersion: "R1-self-test",
      apiArtifactDigest: `sha256:${"a".repeat(64)}`,
      adminArtifactDigest: `sha256:${"b".repeat(64)}`,
      releaseCandidateEvidenceRef: "evidence/rc",
      infrastructureEvidenceRef: "evidence/r3",
      externalIntegrationEvidenceRef: "evidence/r4",
    },
    scope: {
      telemedicineEnabled: true,
      emergencyLocationEnabled: true,
      hostedPaymentReturnEnabled: true,
      pushEnabled: true,
      approvedLaunchScopeRef: "evidence/launch-scope",
    },
    appProfiles,
    artifacts,
    controls,
    deviceMatrix,
    localization: {
      englishReleaseSmoke: true,
      arabicRtlReleaseSmoke: true,
      textScalingAccepted: true,
      screenReaderCriticalActionsAccepted: true,
      evidenceRef: "evidence/localization-accessibility",
    },
    approvals: approvalRoles.map((role) => ({ role, status: "APPROVE", evidenceRef: `evidence/approval/${role}`, ownerRoleRef: `owner/${role}` })),
    finalAcceptanceRef: "evidence/final-mobile-acceptance",
  };
}

function expectReject(label, mutate) {
  const sha = "a".repeat(40);
  const sample = makeValidSample(sha);
  mutate(sample);
  let rejected = false;
  try {
    validateEvidence(sample, { checkoutSha: sha });
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error(`Self-test expected rejection: ${label}`);
}

function selfTest() {
  const sha = "a".repeat(40);
  validateEvidence(makeValidSample(sha), { checkoutSha: sha });
  expectReject("validation namespace", (sample) => { sample.appProfiles[0].androidApplicationId = "io.carepoint.validation.patient"; });
  expectReject("unsigned artifact", (sample) => { sample.artifacts[0].signed = false; });
  expectReject("debug artifact", (sample) => { sample.artifacts[0].debugBuild = true; });
  expectReject("wrong embedded SHA", (sample) => { sample.artifacts[0].embeddedSourceSha = "b".repeat(40); });
  expectReject("missing Arabic RTL", (sample) => { sample.localization.arabicRtlReleaseSmoke = false; });
  expectReject("missing physical device row", (sample) => { sample.deviceMatrix.pop(); });
  expectReject("missing high-risk device scenario", (sample) => { delete sample.deviceMatrix[0].scenarios.telemedicine; });
  expectReject("local validation API", (sample) => { sample.appProfiles[0].apiBaseUrl = "https://mobile-validation.invalid/api/v1"; });
  expectReject("secret-like public key", (sample) => { sample.approvals[0].apiKey = "not-allowed"; });
  expectReject("missing clinical approval", (sample) => { sample.approvals = sample.approvals.filter((item) => item.role !== "CLINICAL"); });
  return { ok: true, schema: "carepoint.release-mobile-evidence/v1", checks: 11 };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function checkTemplate(path) {
  const template = requiredObject(await readJson(path), "template");
  scanSensitiveData(template);
  if (template.schema !== "carepoint.release-mobile-evidence/v1") throw new Error("Template schema is incorrect.");
  if (template.overallStatus !== "DRAFT") throw new Error("Template must remain DRAFT.");
  requiredBoolean(template.approved, "template.approved", false);
  requiredBoolean(template.sensitiveDataIncluded, "template.sensitiveDataIncluded", false);
  if (!Array.isArray(template.appProfiles) || template.appProfiles.length !== 3) throw new Error("Template must enumerate three app profiles.");
  if (!Array.isArray(template.artifacts) || template.artifacts.length !== 6) throw new Error("Template must enumerate six platform artifacts.");
  if (!Array.isArray(template.deviceMatrix) || template.deviceMatrix.length !== 6) throw new Error("Template must enumerate six physical-device records.");
  return { ok: true, status: "DRAFT", productionReleaseEvidence: false };
}

async function fingerprint(templatePath, outputPath) {
  const sourceSha = currentGitSha();
  const validatorBytes = await readFile(process.argv[1]);
  const templateBytes = await readFile(templatePath);
  const result = {
    schema: "carepoint.mobile-release-contract-fingerprint/v1",
    sourceSha,
    validatorSha256: `sha256:${sha256(validatorBytes)}`,
    templateSha256: `sha256:${sha256(templateBytes)}`,
    productionReleaseEvidence: false,
  };
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

async function main() {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === "--self-test") {
    console.log(JSON.stringify(selfTest()));
    return;
  }
  if (mode === "--check-template") {
    if (args.length !== 1) throw new Error("Usage: --check-template <path>");
    console.log(JSON.stringify(await checkTemplate(args[0])));
    return;
  }
  if (mode === "--validate") {
    if (args.length !== 1) throw new Error("Usage: --validate <evidence.json>");
    console.log(JSON.stringify(validateEvidence(await readJson(args[0]))));
    return;
  }
  if (mode === "--fingerprint") {
    if (args.length !== 2) throw new Error("Usage: --fingerprint <template.json> <output.json>");
    console.log(JSON.stringify(await fingerprint(args[0], args[1])));
    return;
  }
  throw new Error("Use --self-test, --check-template, --validate or --fingerprint.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
