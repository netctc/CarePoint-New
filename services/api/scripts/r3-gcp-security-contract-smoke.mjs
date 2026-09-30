import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  productionKeyManagementContract,
  validateProductionManagedKeyInspection,
} = require("../dist/infrastructure/cloud/production-key-management.js");
const {
  productionExternalSecretStoreContract,
  validateProductionExternalSecretInspection,
} = require("../dist/infrastructure/cloud/production-secret-store.js");
const {
  productionObjectStorageContract,
  validateProductionObjectStorageBucketInspection,
} = require("../dist/infrastructure/cloud/production-object-storage.js");
const {
  createGcpManagedKeyInspector,
  createGcpExternalCredentialInspector,
} = require("../dist/infrastructure/cloud/gcp-security-inspector-adapter.js");
const {
  createGcpObjectStorageBucketInspector,
} = require("../dist/infrastructure/cloud/gcp-object-storage-inspector-adapter.js");

const region = "me-central2";
const projectId = "carepoint-r1-ksa";
const keyRingRef = `projects/${projectId}/locations/${region}/keyRings/carepoint-r1`;
const documentKeyRef = `${keyRingRef}/cryptoKeys/clinical-documents`;
const signingKeyRef = `${keyRingRef}/cryptoKeys/clinical-attestation`;
const externalSecretKeyRef = `${keyRingRef}/cryptoKeys/external-secrets`;
const bucketRef = "carepoint-r1-ksa-clinical";

function secretRef(name) {
  return `projects/${projectId}/locations/${region}/secrets/${name}`;
}

function validEnv() {
  return {
    NODE_ENV: "production",
    CAREPOINT_CLOUD_PROVIDER: "gcp",
    CAREPOINT_RESIDENCY_JURISDICTION: "SA",
    CAREPOINT_APPROVED_DATA_REGIONS: region,
    CAREPOINT_PRIMARY_REGION: region,
    GCP_REGION: region,

    CAREPOINT_KEY_MANAGEMENT_PROVIDER: "gcp-cloud-kms",
    CAREPOINT_KEY_MANAGEMENT_REGION: region,
    CAREPOINT_VAULT_REF: keyRingRef,
    CAREPOINT_DOCUMENT_KEY_REF: documentKeyRef,
    CAREPOINT_DOCUMENT_SIGNING_KEY_REF: signingKeyRef,
    CAREPOINT_EXTERNAL_SECRET_KEY_REF: externalSecretKeyRef,
    CAREPOINT_KEY_MAX_ROTATION_DAYS: "365",

    CAREPOINT_EXTERNAL_SECRET_PROVIDER: "gcp-secret-manager",
    CAREPOINT_EXTERNAL_SECRET_REGION: region,
    CAREPOINT_PAYMENT_GATEWAY_SECRET_REF: secretRef("payment-gateway-api-key"),
    CAREPOINT_INSURANCE_GATEWAY_SECRET_REF: secretRef("insurance-gateway-api-key"),
    CAREPOINT_CLAIMS_GATEWAY_SECRET_REF: secretRef("claims-gateway-api-key"),
    CAREPOINT_NOTIFICATION_GATEWAY_SECRET_REF: secretRef("notification-gateway-api-key"),
    CAREPOINT_SIEM_EXPORT_SECRET_REF: secretRef("siem-export-api-key"),
    CAREPOINT_LIVEKIT_API_KEY_SECRET_REF: secretRef("livekit-api-key"),
    CAREPOINT_LIVEKIT_API_SECRET_REF: secretRef("livekit-api-secret"),

    CAREPOINT_OBJECT_STORAGE_PROVIDER: "gcp-cloud-storage",
    CAREPOINT_OBJECT_STORAGE_REGION: region,
    CAREPOINT_DOCUMENT_BUCKET_REF: bucketRef,
    CAREPOINT_DOCUMENT_STORAGE_KEY_REF: documentKeyRef,
    CAREPOINT_DOCUMENT_STORAGE_PREFIX: "carepoint/clinical",
    CAREPOINT_BULK_EXPORT_BUCKET_REF: bucketRef,
    CAREPOINT_BULK_EXPORT_STORAGE_KEY_REF: documentKeyRef,
    CAREPOINT_BULK_EXPORT_PREFIX: "carepoint/bulk-export",
    BULK_EXPORT_RETENTION_SECONDS: "86400",
  };
}

const env = validEnv();
const keyContract = productionKeyManagementContract(env);
assert.equal(keyContract.provider, "gcp-cloud-kms");
assert.equal(keyContract.region, region);
assert.equal(keyContract.vaultRef, keyRingRef);
assert.equal(keyContract.domains.length, 3);
assert.equal(keyContract.domains[0].rotationMode, "automatic");
assert.equal(keyContract.domains[1].rotationMode, "manual");
assert.equal(keyContract.domains[2].rotationMode, "automatic");

const keyInspector = createGcpManagedKeyInspector({
  region,
  client: {
    async getCryptoKey({ name }) {
      const domain = keyContract.domains.find((candidate) => candidate.keyRef === name);
      assert.ok(domain);
      return {
        cryptoKey: {
          name,
          purpose: domain.usage === "sign-verify" ? "ASYMMETRIC_SIGN" : "ENCRYPT_DECRYPT",
          primary: {
            state: "ENABLED",
            protectionLevel: "HSM",
          },
          ...(domain.rotationMode === "automatic"
            ? { rotationPeriod: { seconds: String(365 * 86_400) } }
            : {}),
        },
      };
    },
  },
});

for (const domain of keyContract.domains) {
  const inspection = await keyInspector(domain);
  assert.doesNotThrow(() => validateProductionManagedKeyInspection(domain, inspection));
}

const signingDomain = keyContract.domains.find((domain) => domain.label === "clinical-document-attestation");
assert.ok(signingDomain);
const signingInspection = await keyInspector(signingDomain);
assert.equal(signingInspection.rotationEnabled, false);
assert.equal(signingInspection.rotationPeriodDays, undefined);
assert.throws(
  () => validateProductionManagedKeyInspection(signingDomain, {
    ...signingInspection,
    rotationEnabled: true,
    rotationPeriodDays: 365,
  }),
  /must use manual rotation without an automatic rotation schedule/,
);

assert.throws(
  () => productionKeyManagementContract({
    ...env,
    CAREPOINT_KEY_MANAGEMENT_PROVIDER: "oci-vault-kms",
  }),
  /GCP Release 1 production requires CAREPOINT_KEY_MANAGEMENT_PROVIDER='gcp-cloud-kms'/,
);
assert.throws(
  () => productionKeyManagementContract({
    ...env,
    CAREPOINT_VAULT_REF: `projects/${projectId}/locations/me-central1/keyRings/carepoint-r1`,
  }),
  /key-ring region 'me-central1'.*must match CAREPOINT_KEY_MANAGEMENT_REGION 'me-central2'/,
);
assert.throws(
  () => productionKeyManagementContract({
    ...env,
    CAREPOINT_DOCUMENT_KEY_REF: `projects/other-project/locations/${region}/keyRings/other/cryptoKeys/clinical-documents`,
  }),
  /must belong to CAREPOINT_VAULT_REF GCP key ring/,
);

const secretContract = productionExternalSecretStoreContract(env);
assert.equal(secretContract.provider, "gcp-secret-manager");
assert.equal(secretContract.region, region);
assert.equal(secretContract.secrets.length, 7);
for (const secret of secretContract.secrets) {
  assert.equal(secret.encryptionKeyRef, externalSecretKeyRef);
}

const secretInspector = createGcpExternalCredentialInspector({
  region,
  client: {
    async getSecret({ name }) {
      return {
        secret: {
          name,
          customerManagedEncryption: {
            kmsKeyName: externalSecretKeyRef,
          },
        },
      };
    },
    async getSecretVersion({ name }) {
      return {
        secretVersion: {
          name: name.replace("/latest", "/1"),
          state: "ENABLED",
        },
      };
    },
  },
});

for (const secret of secretContract.secrets) {
  const inspection = await secretInspector(secret);
  assert.doesNotThrow(() => validateProductionExternalSecretInspection(secret, inspection));
}

assert.throws(
  () => productionExternalSecretStoreContract({
    ...env,
    CAREPOINT_EXTERNAL_SECRET_PROVIDER: "oci-vault-secrets",
  }),
  /GCP Release 1 production requires CAREPOINT_EXTERNAL_SECRET_PROVIDER='gcp-secret-manager'/,
);
assert.throws(
  () => productionExternalSecretStoreContract({
    ...env,
    CAREPOINT_PAYMENT_GATEWAY_SECRET_REF: `projects/${projectId}/secrets/payment-gateway-api-key`,
  }),
  /must be a full regional GCP Secret Manager resource name/,
);
assert.throws(
  () => productionExternalSecretStoreContract({
    ...env,
    CAREPOINT_PAYMENT_GATEWAY_SECRET_REF: `projects/other-project/locations/${region}/secrets/payment-gateway-api-key`,
  }),
  /secret project must match the configured GCP key-ring project/,
);

const paymentSecret = secretContract.secrets[0];
const disabledSecretInspector = createGcpExternalCredentialInspector({
  region,
  client: {
    async getSecret({ name }) {
      return {
        secret: {
          name,
          customerManagedEncryption: { kmsKeyName: externalSecretKeyRef },
        },
      };
    },
    async getSecretVersion({ name }) {
      return {
        secretVersion: {
          name: name.replace("/latest", "/1"),
          state: "DISABLED",
        },
      };
    },
  },
});
const disabledInspection = await disabledSecretInspector(paymentSecret);
assert.throws(
  () => validateProductionExternalSecretInspection(paymentSecret, disabledInspection),
  /must expose a current secret version/,
);

const storageContract = productionObjectStorageContract(env);
assert.equal(storageContract.provider, "gcp-cloud-storage");
assert.equal(storageContract.region, region);
assert.equal(storageContract.domains.length, 2);

const storageInspector = createGcpObjectStorageBucketInspector({
  region,
  client: {
    async getBucket({ bucketRef: requestedBucket }) {
      return {
        bucket: {
          name: requestedBucket,
          location: "ME-CENTRAL2",
          iamConfiguration: {
            publicAccessPrevention: "enforced",
          },
          encryption: {
            defaultKmsKeyName: documentKeyRef,
          },
        },
      };
    },
  },
});

for (const domain of storageContract.domains) {
  const inspection = await storageInspector(domain);
  assert.doesNotThrow(() => validateProductionObjectStorageBucketInspection(domain, inspection));
}

assert.throws(
  () => productionObjectStorageContract({
    ...env,
    CAREPOINT_OBJECT_STORAGE_PROVIDER: "oci-object-storage",
  }),
  /GCP Release 1 production requires CAREPOINT_OBJECT_STORAGE_PROVIDER='gcp-cloud-storage'/,
);
assert.throws(
  () => productionObjectStorageContract({
    ...env,
    CAREPOINT_DOCUMENT_BUCKET_REF: "CarePoint-Uppercase-Bucket",
  }),
  /valid lowercase GCP Cloud Storage bucket name/,
);
assert.throws(
  () => productionObjectStorageContract({
    ...env,
    CAREPOINT_DOCUMENT_STORAGE_KEY_REF: `projects/${projectId}/locations/me-central1/keyRings/carepoint-r1/cryptoKeys/clinical-documents`,
  }),
  /CryptoKey region 'me-central1'.*must match CAREPOINT_OBJECT_STORAGE_REGION 'me-central2'/,
);

const clinicalDomain = storageContract.domains[0];
const wrongStorageInspector = createGcpObjectStorageBucketInspector({
  region,
  client: {
    async getBucket({ bucketRef: requestedBucket }) {
      return {
        bucket: {
          name: requestedBucket,
          location: "ME-CENTRAL1",
          iamConfiguration: { publicAccessPrevention: "enforced" },
          encryption: { defaultKmsKeyName: documentKeyRef },
        },
      };
    },
  },
});
const wrongStorageInspection = await wrongStorageInspector(clinicalDomain);
assert.throws(
  () => validateProductionObjectStorageBucketInspection(clinicalDomain, wrongStorageInspection),
  /is in region 'me-central1', expected 'me-central2'/,
);

console.log("R3 GCP KSA security + storage contract smoke passed");
