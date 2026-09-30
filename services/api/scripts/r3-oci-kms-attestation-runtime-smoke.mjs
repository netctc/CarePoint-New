import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  OciKmsSigningProvider,
} = require("../dist/infrastructure/security/oci-kms-signing-provider.js");

const primaryRegion = "me-riyadh-1";
const drRegion = "me-jeddah-1";
const vaultRef = "ocid1.vault.oc1.me-riyadh-1.carepointrelease1vault0501";
const documentKeyRef = "ocid1.key.oc1.me-riyadh-1.carepointrelease1documents0502";
const signingKeyRef = "ocid1.key.oc1.me-riyadh-1.carepointrelease1signing0503";
const externalKeyRef = "ocid1.key.oc1.me-riyadh-1.carepointrelease1external0504";
const keyVersionRef = "ocid1.keyversion.oc1.me-riyadh-1.carepointrelease1signingversion0505";
const managementEndpoint = "https://carepointrelease1-management.kms.me-riyadh-1.oraclecloud.com";
const cryptoEndpoint = "https://carepointrelease1-crypto.kms.me-riyadh-1.oraclecloud.com";
const rawSignature = Buffer.from("carepoint-release1-attestation-signature").toString("base64");
const material = "diagnostic-report-attestation-material";
const digest = createHash("sha256").update(material).digest("hex");
const digestMessage = Buffer.from(digest, "hex").toString("base64");

function env() {
  return {
    NODE_ENV: "production",
    CAREPOINT_CLOUD_PROVIDER: "oci",
    CAREPOINT_RESIDENCY_JURISDICTION: "SA",
    CAREPOINT_APPROVED_DATA_REGIONS: `${primaryRegion},${drRegion}`,
    CAREPOINT_PRIMARY_REGION: primaryRegion,
    CAREPOINT_DR_REGION: drRegion,
    OCI_REGION: primaryRegion,
    OCI_TENANCY_OCID: "ocid1.tenancy.oc1..carepointrelease1ksa0501",
    OCI_COMPARTMENT_OCID: "ocid1.compartment.oc1..carepointrelease1prod0502",
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
    managementEndpoints: [],
    cryptoEndpoints: [],
    keys: [],
    sign: [],
    verify: [],
    discoveryClosed: 0,
    managementClosed: 0,
    cryptoClosed: 0,
    providerClosed: 0,
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
      let regionId = "";
      return {
        set regionId(value) { regionId = value; calls.regions.push(value); },
        get regionId() { return regionId; },
        async getVault({ vaultId }) {
          calls.vaults.push(vaultId);
          if (options.vaultError) throw namedError(options.vaultError);
          return {
            vault: {
              id: options.vaultId ?? vaultId,
              lifecycleState: options.vaultLifecycle ?? "ACTIVE",
              managementEndpoint: options.managementEndpoint ?? managementEndpoint,
              cryptoEndpoint: options.cryptoEndpoint ?? cryptoEndpoint,
            },
          };
        },
        close() { calls.discoveryClosed += 1; },
      };
    },
    createManagementClient() {
      let endpoint = "";
      return {
        set endpoint(value) { endpoint = value; calls.managementEndpoints.push(value); },
        get endpoint() { return endpoint; },
        async getKey({ keyId }) {
          calls.keys.push(keyId);
          if (options.keyError) throw namedError(options.keyError);
          return {
            key: {
              id: options.keyId ?? keyId,
              vaultId: options.keyVaultId ?? vaultRef,
              lifecycleState: options.keyLifecycle ?? "ENABLED",
              protectionMode: options.protectionMode ?? "HSM",
              keyShape: { algorithm: options.keyAlgorithm ?? "RSA" },
            },
          };
        },
        close() { calls.managementClosed += 1; },
      };
    },
    createCryptoClient() {
      let endpoint = "";
      return {
        set endpoint(value) { endpoint = value; calls.cryptoEndpoints.push(value); },
        get endpoint() { return endpoint; },
        async sign(request) {
          calls.sign.push(request);
          if (options.signError) throw namedError(options.signError);
          return {
            signedData: options.missingSignedData ? undefined : {
              keyId: options.responseKeyId ?? signingKeyRef,
              keyVersionId: options.keyVersionId ?? keyVersionRef,
              signature: options.signature ?? rawSignature,
              signingAlgorithm: options.responseSigningAlgorithm ?? request.signDataDetails.signingAlgorithm,
            },
          };
        },
        async verify(request) {
          calls.verify.push(request);
          if (options.verifyError) throw namedError(options.verifyError);
          return { verifiedData: { isSignatureValid: options.signatureValid !== false } };
        },
        close() { calls.cryptoClosed += 1; },
      };
    },
  };
  return { calls, sdkFactory };
}

async function rejects(pattern, mutateEnv = () => {}, options = {}, configuredKeyId = signingKeyRef) {
  const config = env();
  mutateEnv(config);
  const fake = factory(options);
  const provider = new OciKmsSigningProvider(configuredKeyId, config, { sdkFactory: fake.sdkFactory });
  await assert.rejects(() => provider.signDigest(digest), pattern);
  await provider.close();
  return fake.calls;
}

{
  const fake = factory();
  const provider = new OciKmsSigningProvider(signingKeyRef, env(), { sdkFactory: fake.sdkFactory });
  const signed = await provider.signDigest(digest);
  assert.deepEqual(signed, {
    algorithm: "OCI-KMS-RSA-PSS-SHA256",
    keyId: signingKeyRef,
    signature: `OCI1|${keyVersionRef}|${rawSignature}`,
  });
  assert.equal(fake.calls.auth, 1);
  assert.deepEqual(fake.calls.regions, [primaryRegion]);
  assert.deepEqual(fake.calls.vaults, [vaultRef]);
  assert.deepEqual(fake.calls.managementEndpoints, [managementEndpoint]);
  assert.deepEqual(fake.calls.cryptoEndpoints, [cryptoEndpoint]);
  assert.deepEqual(fake.calls.keys, [signingKeyRef]);
  assert.deepEqual(fake.calls.sign[0], {
    signDataDetails: {
      keyId: signingKeyRef,
      message: digestMessage,
      messageType: "DIGEST",
      signingAlgorithm: "SHA_256_RSA_PKCS_PSS",
    },
  });

  assert.equal(await provider.verifyDigest(digest, signed.signature, signed.algorithm), true);
  assert.deepEqual(fake.calls.verify[0], {
    verifyDataDetails: {
      keyId: signingKeyRef,
      keyVersionId: keyVersionRef,
      signature: rawSignature,
      message: digestMessage,
      messageType: "DIGEST",
      signingAlgorithm: "SHA_256_RSA_PKCS_PSS",
    },
  });
  assert.equal(fake.calls.auth, 1, "runtime must be shared between sign and verify");

  await provider.close();
  assert.equal(fake.calls.discoveryClosed, 1);
  assert.equal(fake.calls.managementClosed, 1);
  assert.equal(fake.calls.cryptoClosed, 1);
  assert.equal(fake.calls.providerClosed, 1);
}

{
  const fake = factory({ keyAlgorithm: "ECDSA" });
  const provider = new OciKmsSigningProvider(signingKeyRef, env(), { sdkFactory: fake.sdkFactory });
  const signed = await provider.signDigest(digest);
  assert.equal(signed.algorithm, "OCI-KMS-ECDSA-SHA256");
  assert.equal(fake.calls.sign[0].signDataDetails.signingAlgorithm, "ECDSA_SHA_256");
  assert.equal(await provider.verifyDigest(digest, signed.signature, signed.algorithm), true);
  await provider.close();
}

{
  const fake = factory();
  const provider = new OciKmsSigningProvider(signingKeyRef, env(), { sdkFactory: fake.sdkFactory });
  await assert.rejects(() => provider.signDigest("not-a-sha256-digest"), /SHA-256 hexadecimal digest/);
  assert.equal(fake.calls.auth, 0);
  assert.equal(await provider.verifyDigest(digest, "not-an-oci-envelope", "OCI-KMS-RSA-PSS-SHA256"), false);
  assert.equal(fake.calls.auth, 0);
  assert.equal(await provider.verifyDigest(digest, `OCI1|${keyVersionRef}|${rawSignature}`, "AWS-KMS-HMAC-SHA256"), false);
  assert.equal(fake.calls.auth, 0);
}

await rejects(/CAREPOINT_OCI_AUTH_MODE/, (config) => { config.CAREPOINT_OCI_AUTH_MODE = "config-file"; });
await rejects(/endpoint overrides are forbidden/, (config) => { config.CAREPOINT_OCI_KMS_ENDPOINT = "https://example.invalid"; });
await rejects(/restricted to OCI production/, (config) => { config.CAREPOINT_CLOUD_PROVIDER = "aws"; });
await rejects(/approved clinical-document sign-verify key reference/, () => {}, {}, documentKeyRef);
await rejects(/does not match CAREPOINT_VAULT_REF/, () => {}, { vaultId: "ocid1.vault.oc1.me-riyadh-1.other0506" });
await rejects(/ACTIVE lifecycle state/, () => {}, { vaultLifecycle: "DELETED" });
await rejects(/management endpoint must use HTTPS/, () => {}, { managementEndpoint: "http://carepointrelease1-management.kms.me-riyadh-1.oraclecloud.com" });
await rejects(/crypto endpoint must use an oraclecloud.com host/, () => {}, { cryptoEndpoint: "https://carepointrelease1-crypto.kms.me-riyadh-1.example.com" });
await rejects(/crypto endpoint does not match the configured active region/, () => {}, { cryptoEndpoint: "https://carepointrelease1-crypto.kms.me-jeddah-1.oraclecloud.com" });
await rejects(/unexpected key id/, () => {}, { keyId: documentKeyRef });
await rejects(/does not belong to CAREPOINT_VAULT_REF/, () => {}, { keyVaultId: "ocid1.vault.oc1.me-riyadh-1.other0507" });
await rejects(/ENABLED lifecycle state/, () => {}, { keyLifecycle: "DISABLED" });
await rejects(/HSM or SOFTWARE/, () => {}, { protectionMode: "EXTERNAL" });
await rejects(/RSA or ECDSA/, () => {}, { keyAlgorithm: "AES" });

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
  const calls = await rejects(/signing-key inspection failed \(KeyServiceError\)/, () => {}, { keyError: "KeyServiceError" });
  assert.equal(calls.managementClosed, 1);
  assert.equal(calls.providerClosed, 1);
}
await rejects(/signing failed \(CryptoServiceError\)/, () => {}, { signError: "CryptoServiceError" });
await rejects(/no signed-data response/, () => {}, { missingSignedData: true });
await rejects(/invalid key-version OCID/, () => {}, { keyVersionId: "bad-version" });
await rejects(/not canonical base64/, () => {}, { signature: "***" });
await rejects(/unexpected signing algorithm/, () => {}, { responseSigningAlgorithm: "ECDSA_SHA_256" });

{
  const fake = factory({ signatureValid: false });
  const provider = new OciKmsSigningProvider(signingKeyRef, env(), { sdkFactory: fake.sdkFactory });
  const signed = await provider.signDigest(digest);
  assert.equal(await provider.verifyDigest(digest, signed.signature, signed.algorithm), false);
  await provider.close();
}

{
  const fake = factory({ verifyError: "VerifyServiceError" });
  const provider = new OciKmsSigningProvider(signingKeyRef, env(), { sdkFactory: fake.sdkFactory });
  const signed = await provider.signDigest(digest);
  await assert.rejects(
    () => provider.verifyDigest(digest, signed.signature, signed.algorithm),
    /signature verification failed \(VerifyServiceError\)/,
  );
  await provider.close();
}

console.log("R3 OCI KMS document attestation runtime smoke passed");
