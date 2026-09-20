import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  createOciManagedKeyInspector,
  createOciExternalCredentialInspector,
} = require("../dist/infrastructure/cloud/oci-security-inspector-adapter.js");
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
const vaultRef = "ocid1.vault.oc1.me-riyadh-1.carepointrelease1vault0101";
const documentKeyRef = "ocid1.key.oc1.me-riyadh-1.carepointrelease1documents0102";
const documentSigningKeyRef = "ocid1.key.oc1.me-riyadh-1.carepointrelease1signing0103";
const externalKeyRef = "ocid1.key.oc1.me-riyadh-1.carepointrelease1external0104";

const externalRefs = {
  CAREPOINT_PAYMENT_GATEWAY_SECRET_REF: "ocid1.vaultsecret.oc1.me-riyadh-1.carepointpayment0101",
  CAREPOINT_INSURANCE_GATEWAY_SECRET_REF: "ocid1.vaultsecret.oc1.me-riyadh-1.carepointinsurance0102",
  CAREPOINT_CLAIMS_GATEWAY_SECRET_REF: "ocid1.vaultsecret.oc1.me-riyadh-1.carepointclaims0103",
  CAREPOINT_NOTIFICATION_GATEWAY_SECRET_REF: "ocid1.vaultsecret.oc1.me-riyadh-1.carepointnotification0104",
  CAREPOINT_SIEM_EXPORT_SECRET_REF: "ocid1.vaultsecret.oc1.me-riyadh-1.carepointsiem0105",
  CAREPOINT_LIVEKIT_API_KEY_SECRET_REF: "ocid1.vaultsecret.oc1.me-riyadh-1.carepointlivekitkey0106",
  CAREPOINT_LIVEKIT_API_SECRET_REF: "ocid1.vaultsecret.oc1.me-riyadh-1.carepointlivekitcredential0107",
};

function configureOciProduction() {
  Object.assign(process.env, {
    NODE_ENV: "production",
    CAREPOINT_CLOUD_PROVIDER: "oci",
    CAREPOINT_RESIDENCY_JURISDICTION: "SA",
    CAREPOINT_APPROVED_DATA_REGIONS: `${primaryRegion},${drRegion}`,
    CAREPOINT_PRIMARY_REGION: primaryRegion,
    CAREPOINT_DR_REGION: drRegion,
    OCI_REGION: primaryRegion,
    OCI_TENANCY_OCID: "ocid1.tenancy.oc1..carepointrelease1ksa0101",
    OCI_COMPARTMENT_OCID: "ocid1.compartment.oc1..carepointrelease1prod0102",
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
  for (const name of [
    "PAYMENT_GATEWAY_API_KEY",
    "INSURANCE_GATEWAY_API_KEY",
    "CLAIMS_GATEWAY_API_KEY",
    "NOTIFICATION_GATEWAY_API_KEY",
    "SIEM_EXPORT_API_KEY",
    "LIVEKIT_API_KEY",
    "LIVEKIT_API_SECRET",
  ]) delete process.env[name];
}

function keyShape(keyId) {
  return keyId === documentSigningKeyRef ? { algorithm: "RSA" } : { algorithm: "AES" };
}

function createClients(overrides = {}) {
  const keyCalls = [];
  const metadataCalls = [];
  const bundleCalls = [];
  const keyClient = {
    async getKey({ keyId }) {
      keyCalls.push(keyId);
      return {
        key: {
          id: keyId,
          vaultId: vaultRef,
          lifecycleState: "ENABLED",
          protectionMode: "HSM",
          keyShape: keyShape(keyId),
          isAutoRotationEnabled: true,
          autoKeyRotationDetails: { rotationIntervalInDays: 180 },
          ...(overrides.key ?? {}),
        },
      };
    },
  };
  const credentialClient = {
    async getSecret({ secretId }) {
      metadataCalls.push(secretId);
      return {
        secret: {
          id: secretId,
          vaultId: vaultRef,
          keyId: externalKeyRef,
          lifecycleState: "ACTIVE",
          ...(overrides.credential ?? {}),
        },
      };
    },
    async getSecretBundle({ secretId, stage }) {
      bundleCalls.push([secretId, stage]);
      if (overrides.missingCurrent === true) return {};
      return {
        secretBundle: {
          secretId,
          versionNumber: 1,
        },
      };
    },
  };
  return { keyClient, credentialClient, keyCalls, metadataCalls, bundleCalls };
}

process.env.NODE_ENV = "test";
let nonProductionCalls = 0;
await assertProductionKmsReady({ inspectManagedKey: async () => { nonProductionCalls += 1; throw new Error("unexpected"); } });
await assertProductionKmsRotationReady({ inspectManagedKey: async () => { nonProductionCalls += 1; throw new Error("unexpected"); } });
await assertProductionExternalSecretsReady(process.env, undefined, { inspectExternalCredential: async () => { nonProductionCalls += 1; throw new Error("unexpected"); } });
assert.equal(nonProductionCalls, 0);

configureOciProduction();
const live = createClients();
const inspectManagedKey = createOciManagedKeyInspector({ region: primaryRegion, client: live.keyClient });
const inspectExternalCredential = createOciExternalCredentialInspector({ region: primaryRegion, client: live.credentialClient });

await assertProductionKmsReady({ inspectManagedKey });
await assertProductionKmsRotationReady({ inspectManagedKey });
await assertProductionExternalSecretsReady(process.env, undefined, { inspectExternalCredential });
assert.equal(live.keyCalls.length, 6, "C1 and C8 must each inspect all three OCI managed-key domains");
assert.equal(live.metadataCalls.length, 7, "C12 must inspect metadata for all seven OCI external credentials");
assert.equal(live.bundleCalls.length, 7, "C12 must verify a CURRENT version for all seven OCI external credentials");
assert.ok(live.bundleCalls.every(([, stage]) => stage === "CURRENT"));

configureOciProduction();
await assert.rejects(
  assertProductionKmsReady(),
  /requires a live managed-key inspector/,
);
await assert.rejects(
  assertProductionKmsRotationReady(),
  /requires a live managed-key inspector/,
);
await assert.rejects(
  assertProductionExternalSecretsReady(process.env),
  /requires a live OCI Vault inspector/,
);

configureOciProduction();
const disabled = createClients({ key: { lifecycleState: "DISABLED" } });
await assert.rejects(
  assertProductionKmsReady({
    inspectManagedKey: createOciManagedKeyInspector({ region: primaryRegion, client: disabled.keyClient }),
  }),
  /must be in ENABLED lifecycle state/,
);

configureOciProduction();
const slowRotation = createClients({
  key: { autoKeyRotationDetails: { rotationIntervalInDays: 400 } },
});
await assert.rejects(
  assertProductionKmsRotationReady({
    inspectManagedKey: createOciManagedKeyInspector({ region: primaryRegion, client: slowRotation.keyClient }),
  }),
  /rotation period exceeds CAREPOINT_KEY_MAX_ROTATION_DAYS/,
);

configureOciProduction();
const noCurrent = createClients({ missingCurrent: true });
await assert.rejects(
  assertProductionExternalSecretsReady(process.env, undefined, {
    inspectExternalCredential: createOciExternalCredentialInspector({ region: primaryRegion, client: noCurrent.credentialClient }),
  }),
  /External credential preflight failed/,
);

configureOciProduction();
const wrongVault = createClients({ credential: { vaultId: "ocid1.vault.oc1.me-riyadh-1.otherreleasevault9999" } });
await assert.rejects(
  assertProductionExternalSecretsReady(process.env, undefined, {
    inspectExternalCredential: createOciExternalCredentialInspector({ region: primaryRegion, client: wrongVault.credentialClient }),
  }),
  /External credential preflight failed/,
);

configureOciProduction();
const regionMismatch = createClients();
const wrongRegionInspector = createOciManagedKeyInspector({ region: drRegion, client: regionMismatch.keyClient });
await assert.rejects(
  assertProductionKmsReady({ inspectManagedKey: wrongRegionInspector }),
  /Production key-management inspection failed/,
);

console.log("R3 OCI KSA security preflight binding smoke passed");
