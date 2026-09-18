import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  createProductionOciSecurityRuntime,
} = require("../dist/infrastructure/cloud/oci-production-security-runtime.js");
const {
  assertProductionKmsReady,
} = require("../dist/infrastructure/security/production-kms-preflight.js");
const {
  assertProductionKmsRotationReady,
} = require("../dist/infrastructure/security/production-kms-rotation-preflight.js");
const {
  assertProductionExternalSecretsReady,
} = require("../dist/infrastructure/secrets/production-external-secrets-preflight.js");

const primaryRegion = "me-riyadh-1";
const drRegion = "me-jeddah-1";
const vaultRef = "ocid1.vault.oc1.me-riyadh-1.carepointrelease1vault0201";
const documentKeyRef = "ocid1.key.oc1.me-riyadh-1.carepointrelease1documents0202";
const documentSigningKeyRef = "ocid1.key.oc1.me-riyadh-1.carepointrelease1signing0203";
const externalKeyRef = "ocid1.key.oc1.me-riyadh-1.carepointrelease1external0204";
const managementEndpoint = "https://carepointrelease1-management.kms.me-riyadh-1.oraclecloud.com";

const externalRefs = {
  CAREPOINT_PAYMENT_GATEWAY_SECRET_REF: "ocid1.vaultsecret.oc1.me-riyadh-1.carepointpayment0201",
  CAREPOINT_INSURANCE_GATEWAY_SECRET_REF: "ocid1.vaultsecret.oc1.me-riyadh-1.carepointinsurance0202",
  CAREPOINT_CLAIMS_GATEWAY_SECRET_REF: "ocid1.vaultsecret.oc1.me-riyadh-1.carepointclaims0203",
  CAREPOINT_NOTIFICATION_GATEWAY_SECRET_REF: "ocid1.vaultsecret.oc1.me-riyadh-1.carepointnotification0204",
  CAREPOINT_SIEM_EXPORT_SECRET_REF: "ocid1.vaultsecret.oc1.me-riyadh-1.carepointsiem0205",
  CAREPOINT_LIVEKIT_API_KEY_SECRET_REF: "ocid1.vaultsecret.oc1.me-riyadh-1.carepointlivekitkey0206",
  CAREPOINT_LIVEKIT_API_SECRET_REF: "ocid1.vaultsecret.oc1.me-riyadh-1.carepointlivekitcredential0207",
};

const legacySecretEnvNames = [
  "PAYMENT_GATEWAY_API_KEY",
  "INSURANCE_GATEWAY_API_KEY",
  "CLAIMS_GATEWAY_API_KEY",
  "NOTIFICATION_GATEWAY_API_KEY",
  "SIEM_EXPORT_API_KEY",
  "LIVEKIT_API_KEY",
  "LIVEKIT_API_SECRET",
];

function configureOciProduction() {
  Object.assign(process.env, {
    NODE_ENV: "production",
    CAREPOINT_CLOUD_PROVIDER: "oci",
    CAREPOINT_RESIDENCY_JURISDICTION: "SA",
    CAREPOINT_APPROVED_DATA_REGIONS: `${primaryRegion},${drRegion}`,
    CAREPOINT_PRIMARY_REGION: primaryRegion,
    CAREPOINT_DR_REGION: drRegion,
    OCI_REGION: primaryRegion,
    OCI_TENANCY_OCID: "ocid1.tenancy.oc1..carepointrelease1ksa0201",
    OCI_COMPARTMENT_OCID: "ocid1.compartment.oc1..carepointrelease1prod0202",
    CAREPOINT_OCI_AUTH_MODE: "instance-principal",
    CAREPOINT_KEY_MANAGEMENT_PROVIDER: "oci-vault-kms",
    CAREPOINT_KEY_MANAGEMENT_REGION: primaryRegion,
    CAREPOINT_VAULT_REF: vaultRef,
    CAREPOINT_DOCUMENT_KEY_REF: documentKeyRef,
    CAREPOINT_DOCUMENT_SIGNING_KEY_REF: documentSigningKeyRef,
    CAREPOINT_EXTERNAL_SECRET_KEY_REF: externalKeyRef,
    CAREPOINT_KEY_MAX_ROTATION_DAYS: "365",
    CAREPOINT_EXTERNAL_SECRET_PROVIDER: "oci-vault-secrets",
    CAREPOINT_EXTERNAL_SECRET_REGION: primaryRegion,
    ...externalRefs,
  });
  for (const name of legacySecretEnvNames) delete process.env[name];
  for (const name of [
    "CAREPOINT_OCI_KMS_ENDPOINT",
    "CAREPOINT_OCI_VAULT_ENDPOINT",
    "CAREPOINT_OCI_SECRETS_ENDPOINT",
  ]) delete process.env[name];
}

function createSdkFactory(overrides = {}) {
  const calls = {
    auth: 0,
    vault: [],
    keys: [],
    secretMetadata: [],
    secretBundles: [],
    regions: [],
    closed: [],
    providerClosed: 0,
  };
  const provider = {
    closeProvider() {
      calls.providerClosed += 1;
    },
  };

  const closable = (name) => ({
    close() {
      calls.closed.push(name);
    },
  });

  const factory = {
    async buildInstancePrincipal() {
      calls.auth += 1;
      if (overrides.authError) throw namedError(overrides.authError);
      return provider;
    },
    createVaultDiscoveryClient() {
      return {
        ...closable("vault-discovery"),
        set regionId(value) { calls.regions.push(["vault-discovery", value]); },
        async getVault({ vaultId }) {
          calls.vault.push(vaultId);
          if (overrides.vaultError) throw namedError(overrides.vaultError);
          return {
            vault: {
              id: overrides.vaultId ?? vaultRef,
              lifecycleState: overrides.vaultLifecycle ?? "ACTIVE",
              managementEndpoint: overrides.managementEndpoint ?? managementEndpoint,
            },
          };
        },
      };
    },
    createKmsManagementClient() {
      let endpoint = "";
      return {
        ...closable("kms-management"),
        get endpoint() { return endpoint; },
        set endpoint(value) { endpoint = value; calls.regions.push(["kms-endpoint", value]); },
        async getKey({ keyId }) {
          calls.keys.push([keyId, endpoint]);
          const signing = keyId === documentSigningKeyRef;
          return {
            key: {
              id: keyId,
              vaultId: vaultRef,
              lifecycleState: "ENABLED",
              protectionMode: "HSM",
              keyShape: { algorithm: signing ? "RSA" : "AES" },
              isAutoRotationEnabled: true,
              autoKeyRotationDetails: { rotationIntervalInDays: 180 },
            },
          };
        },
      };
    },
    createVaultSecretsMetadataClient() {
      return {
        ...closable("vault-secrets"),
        set regionId(value) { calls.regions.push(["vault-secrets", value]); },
        async getSecret({ secretId }) {
          calls.secretMetadata.push(secretId);
          return {
            secret: {
              id: secretId,
              vaultId: vaultRef,
              keyId: externalKeyRef,
              lifecycleState: "ACTIVE",
            },
          };
        },
      };
    },
    createSecretsBundleClient() {
      return {
        ...closable("secret-bundles"),
        set regionId(value) { calls.regions.push(["secret-bundles", value]); },
        async getSecretBundle({ secretId, stage }) {
          calls.secretBundles.push([secretId, stage]);
          return { secretBundle: { secretId, versionNumber: 2 } };
        },
      };
    },
  };
  return { factory, calls };
}

async function expectRuntimeReject(pattern, mutate, overrides = {}) {
  configureOciProduction();
  mutate();
  const fake = createSdkFactory(overrides);
  await assert.rejects(
    createProductionOciSecurityRuntime(process.env, { sdkFactory: fake.factory }),
    pattern,
  );
}

process.env.NODE_ENV = "test";
let factoryCalls = 0;
assert.equal(
  await createProductionOciSecurityRuntime(process.env, {
    sdkFactory: {
      async buildInstancePrincipal() { factoryCalls += 1; return {}; },
    },
  }),
  null,
);
assert.equal(factoryCalls, 0, "non-production must not initialize OCI authentication");

process.env.NODE_ENV = "production";
process.env.CAREPOINT_CLOUD_PROVIDER = "aws";
assert.equal(
  await createProductionOciSecurityRuntime(process.env, {
    sdkFactory: {
      async buildInstancePrincipal() { factoryCalls += 1; return {}; },
    },
  }),
  null,
);
assert.equal(factoryCalls, 0, "AWS production must not initialize OCI authentication");

configureOciProduction();
const live = createSdkFactory();
const runtime = await createProductionOciSecurityRuntime(process.env, { sdkFactory: live.factory });
assert.ok(runtime, "OCI production must create a security runtime binding");
assert.equal(live.calls.auth, 1, "one instance-principal provider must be shared by OCI security clients");
assert.deepEqual(live.calls.vault, [vaultRef]);
assert.ok(live.calls.regions.some(([name, value]) => name === "vault-discovery" && value === primaryRegion));
assert.ok(live.calls.regions.some(([name, value]) => name === "vault-secrets" && value === primaryRegion));
assert.ok(live.calls.regions.some(([name, value]) => name === "secret-bundles" && value === primaryRegion));
assert.ok(live.calls.regions.some(([name, value]) => name === "kms-endpoint" && value === managementEndpoint));

await assertProductionKmsReady({ inspectManagedKey: runtime.inspectManagedKey });
await assertProductionKmsRotationReady({ inspectManagedKey: runtime.inspectManagedKey });
await assertProductionExternalSecretsReady(process.env, undefined, {
  inspectExternalCredential: runtime.inspectExternalCredential,
});
assert.equal(live.calls.keys.length, 6, "C1 and C8 must inspect all three OCI managed keys through the live binding");
assert.ok(live.calls.keys.every(([, endpoint]) => endpoint === managementEndpoint));
assert.equal(live.calls.secretMetadata.length, 7);
assert.equal(live.calls.secretBundles.length, 7);
assert.ok(live.calls.secretBundles.every(([, stage]) => stage === "CURRENT"));

await runtime.close();
assert.deepEqual(
  live.calls.closed,
  ["secret-bundles", "vault-secrets", "kms-management", "vault-discovery"],
  "OCI clients must close in reverse construction order",
);
assert.equal(live.calls.providerClosed, 1);

await expectRuntimeReject(
  /CAREPOINT_OCI_AUTH_MODE must be 'instance-principal'/,
  () => { process.env.CAREPOINT_OCI_AUTH_MODE = "config-file"; },
);
await expectRuntimeReject(
  /CAREPOINT_OCI_AUTH_MODE is required/,
  () => { delete process.env.CAREPOINT_OCI_AUTH_MODE; },
);
await expectRuntimeReject(
  /CAREPOINT_OCI_KMS_ENDPOINT endpoint overrides are forbidden/,
  () => { process.env.CAREPOINT_OCI_KMS_ENDPOINT = "https://example.invalid"; },
);
await expectRuntimeReject(
  /instance-principal authentication initialization failed \(MetadataUnavailable\)/,
  () => {},
  { authError: "MetadataUnavailable" },
);
await expectRuntimeReject(
  /does not match CAREPOINT_VAULT_REF/,
  () => {},
  { vaultId: "ocid1.vault.oc1.me-riyadh-1.unexpectedvault0209" },
);
await expectRuntimeReject(
  /must be in ACTIVE lifecycle state/,
  () => {},
  { vaultLifecycle: "DELETED" },
);
await expectRuntimeReject(
  /must use HTTPS/,
  () => {},
  { managementEndpoint: "http://carepointrelease1-management.kms.me-riyadh-1.oraclecloud.com" },
);
await expectRuntimeReject(
  /must use an oraclecloud.com host/,
  () => {},
  { managementEndpoint: "https://kms.me-riyadh-1.example.invalid" },
);
await expectRuntimeReject(
  /does not match the configured active region/,
  () => {},
  { managementEndpoint: "https://carepointrelease1-management.kms.me-jeddah-1.oraclecloud.com" },
);

configureOciProduction();
const sanitized = createSdkFactory({ vaultError: "ServiceUnavailable" });
await assert.rejects(
  createProductionOciSecurityRuntime(process.env, { sdkFactory: sanitized.factory }),
  /OCI Vault discovery failed \(ServiceUnavailable\)/,
);
assert.doesNotMatch(
  String(await Promise.resolve("OCI Vault discovery failed (ServiceUnavailable).")),
  /credential|private|token/i,
);

function namedError(name) {
  const error = new Error("provider details intentionally omitted");
  error.name = name;
  return error;
}

console.log("R3 OCI SDK production security runtime binding smoke passed");
