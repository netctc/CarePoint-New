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

const primaryRegion = "me-riyadh-1";
const drRegion = "me-jeddah-1";
const vaultRef = "ocid1.vault.oc1.me-riyadh-1.carepointrelease1vault0001";
const documentKeyRef = "ocid1.key.oc1.me-riyadh-1.carepointrelease1documents0002";
const documentSigningKeyRef = "ocid1.key.oc1.me-riyadh-1.carepointrelease1signing0003";
const externalSecretKeyRef = "ocid1.key.oc1.me-riyadh-1.carepointrelease1secrets0004";

function secretRef(suffix) {
  return `ocid1.vaultsecret.oc1.me-riyadh-1.carepointrelease1${suffix}`;
}

function validEnv() {
  return {
    NODE_ENV: "production",
    CAREPOINT_CLOUD_PROVIDER: "oci",
    CAREPOINT_RESIDENCY_JURISDICTION: "SA",
    CAREPOINT_APPROVED_DATA_REGIONS: `${primaryRegion},${drRegion}`,
    CAREPOINT_PRIMARY_REGION: primaryRegion,
    CAREPOINT_DR_REGION: drRegion,
    OCI_REGION: primaryRegion,
    OCI_TENANCY_OCID: "ocid1.tenancy.oc1..carepointrelease1ksa0001",
    OCI_COMPARTMENT_OCID: "ocid1.compartment.oc1..carepointrelease1prod0001",

    CAREPOINT_KEY_MANAGEMENT_PROVIDER: "oci-vault-kms",
    CAREPOINT_KEY_MANAGEMENT_REGION: primaryRegion,
    CAREPOINT_VAULT_REF: vaultRef,
    CAREPOINT_DOCUMENT_KEY_REF: documentKeyRef,
    CAREPOINT_DOCUMENT_SIGNING_KEY_REF: documentSigningKeyRef,
    CAREPOINT_EXTERNAL_SECRET_KEY_REF: externalSecretKeyRef,
    CAREPOINT_KEY_MAX_ROTATION_DAYS: "365",

    CAREPOINT_EXTERNAL_SECRET_PROVIDER: "oci-vault-secrets",
    CAREPOINT_EXTERNAL_SECRET_REGION: primaryRegion,
    CAREPOINT_PAYMENT_GATEWAY_SECRET_REF: secretRef("payment0001"),
    CAREPOINT_INSURANCE_GATEWAY_SECRET_REF: secretRef("insurance0002"),
    CAREPOINT_CLAIMS_GATEWAY_SECRET_REF: secretRef("claims0003"),
    CAREPOINT_NOTIFICATION_GATEWAY_SECRET_REF: secretRef("notification0004"),
    CAREPOINT_SIEM_EXPORT_SECRET_REF: secretRef("siem0005"),
    CAREPOINT_LIVEKIT_API_KEY_SECRET_REF: secretRef("livekitkey0006"),
    CAREPOINT_LIVEKIT_API_SECRET_REF: secretRef("livekitsecret0007"),
  };
}

function validKeyInspection(domain) {
  return {
    provider: domain.provider,
    region: domain.region,
    vaultRef: domain.vaultRef,
    keyRef: domain.keyRef,
    lifecycleState: "ENABLED",
    customerManaged: true,
    usage: domain.usage,
    rotationEnabled: true,
    rotationPeriodDays: Math.min(domain.maxRotationDays, 365),
  };
}

function validSecretInspection(secret) {
  return {
    provider: secret.provider,
    region: secret.region,
    vaultRef: secret.vaultRef,
    secretRef: secret.secretRef,
    encryptionKeyRef: secret.encryptionKeyRef,
    lifecycleState: "ACTIVE",
    currentVersionPresent: true,
  };
}

assert.equal(productionKeyManagementContract({ NODE_ENV: "test" }), null);
assert.equal(productionExternalSecretStoreContract({ NODE_ENV: "test" }), null);

const valid = validEnv();
const keyContract = productionKeyManagementContract(valid);
assert.equal(keyContract.provider, "oci-vault-kms");
assert.equal(keyContract.region, primaryRegion);
assert.equal(keyContract.vaultRef, vaultRef);
assert.equal(keyContract.domains.length, 3);
assert.equal(keyContract.domains[0].label, "clinical-documents");
assert.equal(keyContract.domains[0].usage, "encrypt-decrypt");
assert.equal(keyContract.domains[1].label, "clinical-document-attestation");
assert.equal(keyContract.domains[1].usage, "sign-verify");
assert.equal(keyContract.domains[2].label, "external-integration-secrets");
for (const domain of keyContract.domains) {
  assert.doesNotThrow(() =>
    validateProductionManagedKeyInspection(domain, validKeyInspection(domain)),
  );
}

assert.throws(
  () => productionKeyManagementContract({ ...valid, CAREPOINT_KEY_MANAGEMENT_PROVIDER: "" }),
  /CAREPOINT_KEY_MANAGEMENT_PROVIDER is required/,
);
assert.throws(
  () => productionKeyManagementContract({ ...valid, CAREPOINT_KEY_MANAGEMENT_PROVIDER: "local" }),
  /must be 'aws-kms' or 'oci-vault-kms'/,
);
assert.throws(
  () => productionKeyManagementContract({ ...valid, CAREPOINT_KEY_MANAGEMENT_PROVIDER: "aws-kms" }),
  /OCI Release 1 production requires CAREPOINT_KEY_MANAGEMENT_PROVIDER='oci-vault-kms'/,
);
assert.throws(
  () => productionKeyManagementContract({ ...valid, CAREPOINT_KEY_MANAGEMENT_REGION: drRegion }),
  /active key management must be in primary region 'me-riyadh-1'/,
);
assert.throws(
  () => productionKeyManagementContract({ ...valid, CAREPOINT_VAULT_REF: "not-a-vault" }),
  /CAREPOINT_VAULT_REF must be an OCI Vault OCID/,
);
assert.throws(
  () => productionKeyManagementContract({ ...valid, CAREPOINT_DOCUMENT_KEY_REF: "not-a-key" }),
  /CAREPOINT_DOCUMENT_KEY_REF must be an OCI Key Management key OCID/,
);
assert.throws(
  () => productionKeyManagementContract({
    ...valid,
    CAREPOINT_DOCUMENT_SIGNING_KEY_REF: documentKeyRef,
  }),
  /must use distinct key references/,
);
assert.throws(
  () => productionKeyManagementContract({ ...valid, CAREPOINT_KEY_MAX_ROTATION_DAYS: "366" }),
  /must be an integer between 1 and 365/,
);

const documentDomain = keyContract.domains[0];
assert.throws(
  () => validateProductionManagedKeyInspection(documentDomain, {
    ...validKeyInspection(documentDomain),
    provider: "aws-kms",
  }),
  /inspection provider 'aws-kms' does not match configured provider 'oci-vault-kms'/,
);
assert.throws(
  () => validateProductionManagedKeyInspection(documentDomain, {
    ...validKeyInspection(documentDomain),
    region: drRegion,
  }),
  /is in region 'me-jeddah-1', expected 'me-riyadh-1'/,
);
assert.throws(
  () => validateProductionManagedKeyInspection(documentDomain, {
    ...validKeyInspection(documentDomain),
    lifecycleState: "DISABLED",
  }),
  /must be in ENABLED lifecycle state/,
);
assert.throws(
  () => validateProductionManagedKeyInspection(documentDomain, {
    ...validKeyInspection(documentDomain),
    customerManaged: false,
  }),
  /must be customer-managed/,
);
assert.throws(
  () => validateProductionManagedKeyInspection(documentDomain, {
    ...validKeyInspection(documentDomain),
    usage: "sign-verify",
  }),
  /does not match required usage 'encrypt-decrypt'/,
);
assert.throws(
  () => validateProductionManagedKeyInspection(documentDomain, {
    ...validKeyInspection(documentDomain),
    rotationEnabled: false,
  }),
  /must have rotation enabled/,
);
assert.throws(
  () => validateProductionManagedKeyInspection(documentDomain, {
    ...validKeyInspection(documentDomain),
    rotationPeriodDays: 366,
  }),
  /rotation period exceeds CAREPOINT_KEY_MAX_ROTATION_DAYS/,
);

const secretContract = productionExternalSecretStoreContract(valid);
assert.equal(secretContract.provider, "oci-vault-secrets");
assert.equal(secretContract.region, primaryRegion);
assert.equal(secretContract.vaultRef, vaultRef);
assert.equal(secretContract.secrets.length, 7);
assert.equal(secretContract.secrets[0].name, "payment-gateway-api-key");
for (const secret of secretContract.secrets) {
  assert.equal(secret.encryptionKeyRef, externalSecretKeyRef);
  assert.doesNotThrow(() =>
    validateProductionExternalSecretInspection(secret, validSecretInspection(secret)),
  );
}

assert.throws(
  () => productionExternalSecretStoreContract({ ...valid, CAREPOINT_EXTERNAL_SECRET_PROVIDER: "" }),
  /CAREPOINT_EXTERNAL_SECRET_PROVIDER is required/,
);
assert.throws(
  () => productionExternalSecretStoreContract({
    ...valid,
    CAREPOINT_EXTERNAL_SECRET_PROVIDER: "aws-kms-files",
  }),
  /OCI Release 1 production requires CAREPOINT_EXTERNAL_SECRET_PROVIDER='oci-vault-secrets'/,
);
assert.throws(
  () => productionExternalSecretStoreContract({
    ...valid,
    CAREPOINT_EXTERNAL_SECRET_REGION: drRegion,
  }),
  /active external-secret store must be in primary region 'me-riyadh-1'/,
);
assert.throws(
  () => productionExternalSecretStoreContract({
    ...valid,
    CAREPOINT_PAYMENT_GATEWAY_SECRET_REF: "not-a-secret-ocid",
  }),
  /CAREPOINT_PAYMENT_GATEWAY_SECRET_REF must be an OCI Vault secret OCID/,
);
assert.throws(
  () => productionExternalSecretStoreContract({
    ...valid,
    PAYMENT_GATEWAY_API_KEY: "plaintext-is-forbidden",
  }),
  /PAYMENT_GATEWAY_API_KEY plaintext environment configuration is forbidden/,
);
assert.throws(
  () => productionExternalSecretStoreContract({
    ...valid,
    CAREPOINT_INSURANCE_GATEWAY_SECRET_REF: valid.CAREPOINT_PAYMENT_GATEWAY_SECRET_REF,
  }),
  /must use a distinct secret reference/,
);

const paymentSecret = secretContract.secrets[0];
assert.throws(
  () => validateProductionExternalSecretInspection(paymentSecret, {
    ...validSecretInspection(paymentSecret),
    provider: "aws-kms-files",
  }),
  /inspection provider 'aws-kms-files' does not match configured provider 'oci-vault-secrets'/,
);
assert.throws(
  () => validateProductionExternalSecretInspection(paymentSecret, {
    ...validSecretInspection(paymentSecret),
    encryptionKeyRef: documentKeyRef,
  }),
  /encryption key does not match configured external-secret key reference/,
);
assert.throws(
  () => validateProductionExternalSecretInspection(paymentSecret, {
    ...validSecretInspection(paymentSecret),
    lifecycleState: "DELETED",
  }),
  /must be in ACTIVE lifecycle state/,
);
assert.throws(
  () => validateProductionExternalSecretInspection(paymentSecret, {
    ...validSecretInspection(paymentSecret),
    currentVersionPresent: false,
  }),
  /must expose a current secret version/,
);

console.log("R3 OCI KSA Vault/KMS + Secrets contract smoke passed");
