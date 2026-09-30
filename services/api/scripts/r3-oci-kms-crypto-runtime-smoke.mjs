import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  OciKmsKeyProvider,
} = require("../dist/infrastructure/security/oci-kms-key-provider.js");

const primaryRegion = "me-riyadh-1";
const drRegion = "me-jeddah-1";
const vaultRef = "ocid1.vault.oc1.me-riyadh-1.carepointrelease1vault0401";
const documentKeyRef = "ocid1.key.oc1.me-riyadh-1.carepointrelease1documents0402";
const signingKeyRef = "ocid1.key.oc1.me-riyadh-1.carepointrelease1signing0403";
const externalKeyRef = "ocid1.key.oc1.me-riyadh-1.carepointrelease1external0404";
const cryptoEndpoint = "https://carepointrelease1-crypto.kms.me-riyadh-1.oraclecloud.com";
const purpose = "carepoint-clinical-document-dek";
const dataKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const wrappedCiphertext = "oci-kms-wrapped-dek-ciphertext";

function env() {
  return {
    NODE_ENV: "production",
    CAREPOINT_CLOUD_PROVIDER: "oci",
    CAREPOINT_RESIDENCY_JURISDICTION: "SA",
    CAREPOINT_APPROVED_DATA_REGIONS: `${primaryRegion},${drRegion}`,
    CAREPOINT_PRIMARY_REGION: primaryRegion,
    CAREPOINT_DR_REGION: drRegion,
    OCI_REGION: primaryRegion,
    OCI_TENANCY_OCID: "ocid1.tenancy.oc1..carepointrelease1ksa0401",
    OCI_COMPARTMENT_OCID: "ocid1.compartment.oc1..carepointrelease1prod0402",
    CAREPOINT_OCI_AUTH_MODE: "instance-principal",
    CAREPOINT_KEY_MANAGEMENT_PROVIDER: "oci-vault-kms",
    CAREPOINT_KEY_MANAGEMENT_REGION: primaryRegion,
    CAREPOINT_VAULT_REF: vaultRef,
    CAREPOINT_DOCUMENT_KEY_REF: documentKeyRef,
    CAREPOINT_DOCUMENT_SIGNING_KEY_REF: signingKeyRef,
    CAREPOINT_EXTERNAL_SECRET_KEY_REF: externalKeyRef,
    CAREPOINT_KEY_MAX_ROTATION_DAYS: "365",
  };
}

function namedError(name) {
  const error = new Error("provider detail must not escape");
  error.name = name;
  return error;
}

function factory(options = {}) {
  const calls = {
    auth: 0,
    regions: [],
    vaults: [],
    discoveryClosed: 0,
    cryptoClosed: 0,
    providerClosed: 0,
    endpoints: [],
    encrypt: [],
    decrypt: [],
  };
  const provider = {
    closeProvider() { calls.providerClosed += 1; },
  };
  const sdkFactory = {
    async buildInstancePrincipal() {
      calls.auth += 1;
      if (options.authError) throw namedError(options.authError);
      return provider;
    },
    createVaultDiscoveryClient() {
      if (options.discoveryClientError) throw namedError(options.discoveryClientError);
      return {
        set regionId(value) { calls.regions.push(value); },
        get regionId() { return calls.regions.at(-1) ?? ""; },
        async getVault({ vaultId }) {
          calls.vaults.push(vaultId);
          if (options.vaultError) throw namedError(options.vaultError);
          return {
            vault: {
              id: options.vaultId ?? vaultId,
              lifecycleState: options.lifecycleState ?? "ACTIVE",
              cryptoEndpoint: options.cryptoEndpoint ?? cryptoEndpoint,
            },
          };
        },
        close() { calls.discoveryClosed += 1; },
      };
    },
    createCryptoClient() {
      if (options.cryptoClientError) throw namedError(options.cryptoClientError);
      let endpoint = "";
      return {
        set endpoint(value) {
          endpoint = value;
          calls.endpoints.push(value);
        },
        get endpoint() { return endpoint; },
        async encrypt(request) {
          calls.encrypt.push(request);
          if (options.encryptError) throw namedError(options.encryptError);
          return {
            encryptedData: {
              ciphertext: options.ciphertext ?? wrappedCiphertext,
              keyId: options.encryptKeyId ?? documentKeyRef,
              encryptionAlgorithm: options.encryptAlgorithm ?? "AES_256_GCM",
            },
          };
        },
        async decrypt(request) {
          calls.decrypt.push(request);
          if (options.decryptError) throw namedError(options.decryptError);
          return {
            decryptedData: {
              plaintext: options.plaintext ?? Buffer.from(dataKey).toString("base64"),
              keyId: options.decryptKeyId ?? documentKeyRef,
              encryptionAlgorithm: options.decryptAlgorithm ?? "AES_256_GCM",
            },
          };
        },
        close() { calls.cryptoClosed += 1; },
      };
    },
  };
  return { calls, sdkFactory };
}

async function rejects(pattern, mutateEnv = () => {}, options = {}, operation = "wrap") {
  const config = env();
  mutateEnv(config);
  const fake = factory(options);
  const keyId = options.configuredKeyId ?? documentKeyRef;
  const provider = new OciKmsKeyProvider(keyId, purpose, config, { sdkFactory: fake.sdkFactory });
  const action = operation === "unwrap"
    ? () => provider.unwrapDataKey({ keyId, wrappedKey: wrappedCiphertext })
    : () => provider.wrapDataKey(dataKey);
  await assert.rejects(action, pattern);
  return fake.calls;
}

{
  const config = env();
  const fake = factory();
  const provider = new OciKmsKeyProvider(documentKeyRef, purpose, config, { sdkFactory: fake.sdkFactory });

  const wrapped = await provider.wrapDataKey(dataKey);
  assert.deepEqual(wrapped, { keyId: documentKeyRef, wrappedKey: wrappedCiphertext });
  assert.equal(fake.calls.auth, 1);
  assert.deepEqual(fake.calls.regions, [primaryRegion]);
  assert.deepEqual(fake.calls.vaults, [vaultRef]);
  assert.equal(fake.calls.discoveryClosed, 1);
  assert.deepEqual(fake.calls.endpoints, [cryptoEndpoint]);
  assert.equal(fake.calls.providerClosed, 0);
  assert.equal(fake.calls.encrypt.length, 1);
  assert.deepEqual(fake.calls.encrypt[0], {
    encryptDataDetails: {
      keyId: documentKeyRef,
      plaintext: Buffer.from(dataKey).toString("base64"),
      associatedData: { purpose },
      encryptionAlgorithm: "AES_256_GCM",
    },
  });

  const unwrapped = await provider.unwrapDataKey(wrapped);
  assert.deepEqual(Array.from(unwrapped), Array.from(dataKey));
  assert.equal(fake.calls.auth, 1);
  assert.equal(fake.calls.vaults.length, 1);
  assert.equal(fake.calls.decrypt.length, 1);
  assert.deepEqual(fake.calls.decrypt[0], {
    decryptDataDetails: {
      keyId: documentKeyRef,
      ciphertext: wrappedCiphertext,
      associatedData: { purpose },
      encryptionAlgorithm: "AES_256_GCM",
    },
  });
}

{
  const fake = factory();
  const provider = new OciKmsKeyProvider(documentKeyRef, purpose, env(), { sdkFactory: fake.sdkFactory });
  await assert.rejects(
    () => provider.wrapDataKey(Uint8Array.from([1, 2, 3])),
    /exactly 32 bytes/,
  );
  assert.equal(fake.calls.auth, 0);
}

{
  const fake = factory();
  const provider = new OciKmsKeyProvider(documentKeyRef, purpose, env(), { sdkFactory: fake.sdkFactory });
  await assert.rejects(
    () => provider.unwrapDataKey({ keyId: signingKeyRef, wrappedKey: wrappedCiphertext }),
    /unexpected key id/,
  );
  assert.equal(fake.calls.auth, 0);
}

await rejects(/CAREPOINT_OCI_AUTH_MODE/, (config) => { config.CAREPOINT_OCI_AUTH_MODE = "config-file"; });
await rejects(/endpoint overrides are forbidden/, (config) => { config.CAREPOINT_OCI_KMS_ENDPOINT = "https://example.invalid"; });
await rejects(/restricted to OCI production/, (config) => { config.CAREPOINT_CLOUD_PROVIDER = "aws"; });
await rejects(/approved encrypt-decrypt production key reference/, () => {}, { configuredKeyId: signingKeyRef });
await rejects(/does not match CAREPOINT_VAULT_REF/, () => {}, { vaultId: "ocid1.vault.oc1.me-riyadh-1.other0405" });
await rejects(/ACTIVE lifecycle state/, () => {}, { lifecycleState: "DELETED" });
await rejects(/must use HTTPS/, () => {}, { cryptoEndpoint: "http://carepointrelease1-crypto.kms.me-riyadh-1.oraclecloud.com" });
await rejects(/oraclecloud.com host/, () => {}, { cryptoEndpoint: "https://carepointrelease1-crypto.kms.me-riyadh-1.example.com" });
await rejects(/configured active region/, () => {}, { cryptoEndpoint: "https://carepointrelease1-crypto.kms.me-jeddah-1.oraclecloud.com" });
await rejects(/must not include a path/, () => {}, { cryptoEndpoint: `${cryptoEndpoint}/unexpected` });

{
  const calls = await rejects(/authentication initialization failed \(InstancePrincipalError\)/, () => {}, { authError: "InstancePrincipalError" });
  assert.equal(calls.providerClosed, 0);
}
{
  const calls = await rejects(/Vault discovery failed \(ServiceError\)/, () => {}, { vaultError: "ServiceError" });
  assert.equal(calls.discoveryClosed, 1);
  assert.equal(calls.providerClosed, 1);
}
{
  const calls = await rejects(/encryption failed \(ServiceError\)/, () => {}, { encryptError: "ServiceError" });
  assert.equal(calls.auth, 1);
}
await rejects(/unexpected key id/, () => {}, { encryptKeyId: externalKeyRef });
await rejects(/unexpected encryption algorithm/, () => {}, { encryptAlgorithm: "RSA_OAEP_SHA_256" });
await rejects(/decryption failed \(ServiceError\)/, () => {}, { decryptError: "ServiceError" }, "unwrap");
await rejects(/not canonical base64/, () => {}, { plaintext: "not-base64" }, "unwrap");
await rejects(/invalid data key length/, () => {}, { plaintext: Buffer.from("short", "utf8").toString("base64") }, "unwrap");
await rejects(/unexpected key id/, () => {}, { decryptKeyId: externalKeyRef }, "unwrap");
await rejects(/unexpected encryption algorithm/, () => {}, { decryptAlgorithm: "RSA_OAEP_SHA_256" }, "unwrap");

console.log("R3 OCI KMS crypto runtime smoke passed");
