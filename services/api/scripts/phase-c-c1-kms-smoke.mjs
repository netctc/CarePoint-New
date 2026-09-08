const base = process.env.CAREPOINT_API_URL || process.env.CAREPOINT_API_BASE || "http://127.0.0.1:4000/api/v1";

function assert(ok, message) {
  if (!ok) throw new Error(message);
}

async function expectFailure(fn, pattern, label) {
  let failure;
  try {
    await fn();
  } catch (error) {
    failure = error;
  }
  assert(failure, `${label} unexpectedly succeeded.`);
  assert(pattern.test(String(failure?.message ?? failure)), `${label} failed for the wrong reason: ${failure}`);
}

const readinessResponse = await fetch(`${base}/health/ready`, { headers: { accept: "application/json" } });
const readiness = await readinessResponse.json().catch(() => ({}));
assert(readinessResponse.ok, `C1 runtime readiness failed ${readinessResponse.status}: ${JSON.stringify(readiness)}`);
assert(readiness.dependencies?.kms === true, "C1 readiness does not expose a successful KMS dependency state.");
assert(readiness.kms?.required === false, "C1 local/test runtime unexpectedly requires AWS KMS.");

const module = await import("../dist/infrastructure/security/kms-readiness.service.js");
const KmsReadinessService = module.KmsReadinessService ?? module.default?.KmsReadinessService;
assert(typeof KmsReadinessService === "function", "C1 compiled KmsReadinessService export is unavailable.");

const managed = [
  "NODE_ENV",
  "AWS_REGION",
  "AWS_DEFAULT_REGION",
  "AWS_ENDPOINT_URL_KMS",
  "AWS_KMS_ALLOW_CUSTOM_ENDPOINT",
  "MFA_KEY_PROVIDER",
  "MFA_KMS_KEY_ID",
  "CLINICAL_KEY_PROVIDER",
  "CLINICAL_KMS_KEY_ID",
  "ORDER_KEY_PROVIDER",
  "ORDER_KMS_KEY_ID",
  "DOCUMENT_KEY_PROVIDER",
  "DOCUMENT_KMS_KEY_ID",
  "MESSAGING_KEY_PROVIDER",
  "MESSAGING_KMS_KEY_ID",
  "TELEHEALTH_KEY_PROVIDER",
  "TELEHEALTH_KMS_KEY_ID",
];
const snapshot = new Map(managed.map((key) => [key, process.env[key]]));

function resetManaged() {
  for (const key of managed) delete process.env[key];
}

function productionAwsConfig() {
  resetManaged();
  process.env.NODE_ENV = "production";
  process.env.AWS_REGION = "me-south-1";
  for (const [providerEnv, keyEnv, suffix] of [
    ["MFA_KEY_PROVIDER", "MFA_KMS_KEY_ID", "mfa"],
    ["CLINICAL_KEY_PROVIDER", "CLINICAL_KMS_KEY_ID", "clinical"],
    ["ORDER_KEY_PROVIDER", "ORDER_KMS_KEY_ID", "orders"],
    ["DOCUMENT_KEY_PROVIDER", "DOCUMENT_KMS_KEY_ID", "documents"],
    ["MESSAGING_KEY_PROVIDER", "MESSAGING_KMS_KEY_ID", "messaging"],
    ["TELEHEALTH_KEY_PROVIDER", "TELEHEALTH_KMS_KEY_ID", "telehealth"],
  ]) {
    process.env[providerEnv] = "aws-kms";
    process.env[keyEnv] = `c1-${suffix}-key-id`;
  }
}

try {
  productionAwsConfig();
  let service = new KmsReadinessService();
  let config = service.validateConfiguration();
  assert(config.required === true && config.production === true, "C1 valid production KMS configuration was not recognized.");
  assert(config.domains.length === 6, `C1 expected six envelope KMS domains, got ${config.domains.length}.`);
  for (const domain of ["mfa", "clinical", "orders", "documents", "messaging", "telehealth"]) {
    assert(config.domains.includes(domain), `C1 production KMS configuration omitted ${domain}.`);
  }
  assert(config.region === "me-south-1" && config.customEndpoint === false, "C1 production AWS region/endpoint summary is incorrect.");

  productionAwsConfig();
  process.env.MFA_KEY_PROVIDER = "local";
  service = new KmsReadinessService();
  await expectFailure(
    () => service.validateConfiguration(),
    /production envelope encryption requires aws kms.*mfa/i,
    "C1 production local-provider guard",
  );

  productionAwsConfig();
  delete process.env.CLINICAL_KMS_KEY_ID;
  service = new KmsReadinessService();
  await expectFailure(
    () => service.validateConfiguration(),
    /CLINICAL_KMS_KEY_ID is required/i,
    "C1 missing domain key guard",
  );

  productionAwsConfig();
  delete process.env.AWS_REGION;
  service = new KmsReadinessService();
  await expectFailure(
    () => service.validateConfiguration(),
    /AWS_REGION.*required/i,
    "C1 deterministic AWS region guard",
  );

  productionAwsConfig();
  process.env.AWS_ENDPOINT_URL_KMS = "https://kms.internal.example";
  service = new KmsReadinessService();
  await expectFailure(
    () => service.validateConfiguration(),
    /forbidden in production unless AWS_KMS_ALLOW_CUSTOM_ENDPOINT=true/i,
    "C1 implicit custom endpoint guard",
  );

  productionAwsConfig();
  process.env.AWS_ENDPOINT_URL_KMS = "http://kms.internal.example";
  process.env.AWS_KMS_ALLOW_CUSTOM_ENDPOINT = "true";
  service = new KmsReadinessService();
  await expectFailure(
    () => service.validateConfiguration(),
    /must use HTTPS/i,
    "C1 insecure custom endpoint guard",
  );

  productionAwsConfig();
  process.env.AWS_ENDPOINT_URL_KMS = "https://kms.internal.example";
  process.env.AWS_KMS_ALLOW_CUSTOM_ENDPOINT = "true";
  service = new KmsReadinessService();
  config = service.validateConfiguration();
  assert(config.required === true && config.customEndpoint === true, "C1 explicit HTTPS private KMS endpoint was not accepted.");

  productionAwsConfig();
  process.env.ORDER_KEY_PROVIDER = "unsupported";
  service = new KmsReadinessService();
  await expectFailure(
    () => service.validateConfiguration(),
    /unsupported ORDER_KEY_PROVIDER/i,
    "C1 unsupported provider guard",
  );

  console.log(JSON.stringify({
    status: "passed",
    phase: "Phase-C-C1-KMS",
    readinessReportsKms: true,
    localCiDoesNotRequireAws: true,
    productionSixDomainCoverage: true,
    productionLocalProviderRejected: true,
    missingDomainKeyRejected: true,
    explicitAwsRegionRequired: true,
    customEndpointRequiresOptIn: true,
    productionCustomEndpointRequiresHttps: true,
    explicitPrivateHttpsEndpointSupported: true,
    unsupportedProviderRejected: true,
    liveKmsRoundTripRunsAtProductionStartup: true,
  }));
} finally {
  resetManaged();
  for (const [key, value] of snapshot) {
    if (value !== undefined) process.env[key] = value;
  }
}
