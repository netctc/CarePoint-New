import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  OciExternalSecretValueResolver,
} = require("../dist/infrastructure/secrets/oci-external-secret-value-resolver.js");

const primaryRegion = "me-riyadh-1";
const drRegion = "me-jeddah-1";
const vaultRef = "ocid1.vault.oc1.me-riyadh-1.carepointrelease1vault0301";
const externalKeyRef = "ocid1.key.oc1.me-riyadh-1.carepointrelease1external0302";
const refs = {
  CAREPOINT_PAYMENT_GATEWAY_SECRET_REF: "ocid1.vaultsecret.oc1.me-riyadh-1.carepointpayment0301",
  CAREPOINT_INSURANCE_GATEWAY_SECRET_REF: "ocid1.vaultsecret.oc1.me-riyadh-1.carepointinsurance0302",
  CAREPOINT_CLAIMS_GATEWAY_SECRET_REF: "ocid1.vaultsecret.oc1.me-riyadh-1.carepointclaims0303",
  CAREPOINT_NOTIFICATION_GATEWAY_SECRET_REF: "ocid1.vaultsecret.oc1.me-riyadh-1.carepointnotification0304",
  CAREPOINT_SIEM_EXPORT_SECRET_REF: "ocid1.vaultsecret.oc1.me-riyadh-1.carepointsiem0305",
  CAREPOINT_LIVEKIT_API_KEY_SECRET_REF: "ocid1.vaultsecret.oc1.me-riyadh-1.carepointlivekitkey0306",
  CAREPOINT_LIVEKIT_API_SECRET_REF: "ocid1.vaultsecret.oc1.me-riyadh-1.carepointlivekitcredential0307",
};

function env() {
  return {
    NODE_ENV: "production",
    CAREPOINT_CLOUD_PROVIDER: "oci",
    CAREPOINT_RESIDENCY_JURISDICTION: "SA",
    CAREPOINT_APPROVED_DATA_REGIONS: `${primaryRegion},${drRegion}`,
    CAREPOINT_PRIMARY_REGION: primaryRegion,
    CAREPOINT_DR_REGION: drRegion,
    OCI_REGION: primaryRegion,
    OCI_TENANCY_OCID: "ocid1.tenancy.oc1..carepointrelease1ksa0301",
    OCI_COMPARTMENT_OCID: "ocid1.compartment.oc1..carepointrelease1prod0302",
    CAREPOINT_OCI_AUTH_MODE: "instance-principal",
    CAREPOINT_KEY_MANAGEMENT_PROVIDER: "oci-vault-kms",
    CAREPOINT_KEY_MANAGEMENT_REGION: primaryRegion,
    CAREPOINT_VAULT_REF: vaultRef,
    CAREPOINT_DOCUMENT_KEY_REF: "ocid1.key.oc1.me-riyadh-1.carepointrelease1documents0303",
    CAREPOINT_DOCUMENT_SIGNING_KEY_REF: "ocid1.key.oc1.me-riyadh-1.carepointrelease1signing0304",
    CAREPOINT_EXTERNAL_SECRET_KEY_REF: externalKeyRef,
    CAREPOINT_KEY_MAX_ROTATION_DAYS: "365",
    CAREPOINT_EXTERNAL_SECRET_PROVIDER: "oci-vault-secrets",
    CAREPOINT_EXTERNAL_SECRET_REGION: primaryRegion,
    ...refs,
  };
}

function factory(options = {}) {
  const calls = { auth: 0, bundles: [], closed: 0, providerClosed: 0, regions: [] };
  const provider = {
    closeProvider() { calls.providerClosed += 1; },
  };
  return {
    calls,
    sdkFactory: {
      async buildInstancePrincipal() {
        calls.auth += 1;
        if (options.authError) throw namedError(options.authError);
        return provider;
      },
      createSecretsClient() {
        return {
          set regionId(value) { calls.regions.push(value); },
          get regionId() { return calls.regions.at(-1) ?? ""; },
          async getSecretBundle({ secretId, stage }) {
            calls.bundles.push([secretId, stage]);
            if (options.bundleError) throw namedError(options.bundleError);
            const plaintext = options.value ?? "carepoint-provider-token";
            const content = options.rawContent ?? Buffer.from(plaintext, "utf8").toString("base64");
            return {
              secretBundle: {
                secretId: options.secretId ?? secretId,
                versionNumber: options.versionNumber ?? 7,
                versionName: options.versionName,
                secretBundleContent: {
                  contentType: options.contentType ?? "BASE64",
                  content,
                },
              },
            };
          },
          close() { calls.closed += 1; },
        };
      },
    },
  };
}

function namedError(name) {
  const error = new Error("provider detail must not escape");
  error.name = name;
  return error;
}

async function rejects(pattern, mutate = () => {}, options = {}) {
  const config = env();
  mutate(config);
  const fake = factory(options);
  const resolver = new OciExternalSecretValueResolver(config, { sdkFactory: fake.sdkFactory });
  await assert.rejects(() => resolver.resolve("payment-gateway-api-key"), pattern);
  await resolver.close();
}

{
  const config = env();
  const fake = factory();
  const resolver = new OciExternalSecretValueResolver(config, { sdkFactory: fake.sdkFactory });
  const first = await resolver.resolve("payment-gateway-api-key");
  const second = await resolver.resolve("payment-gateway-api-key");
  assert.equal(first, "carepoint-provider-token");
  assert.equal(second, first);
  assert.equal(fake.calls.auth, 1);
  assert.deepEqual(fake.calls.regions, [primaryRegion]);
  assert.equal(fake.calls.bundles.length, 2);
  assert.deepEqual(fake.calls.bundles[0], [refs.CAREPOINT_PAYMENT_GATEWAY_SECRET_REF, "CURRENT"]);
  await resolver.close();
  assert.equal(fake.calls.closed, 1);
  assert.equal(fake.calls.providerClosed, 1);
  await resolver.close();
  assert.equal(fake.calls.closed, 1);
}

await rejects(/CAREPOINT_OCI_AUTH_MODE/, (config) => { config.CAREPOINT_OCI_AUTH_MODE = "config-file"; });
await rejects(/endpoint overrides are forbidden/, (config) => { config.CAREPOINT_OCI_SECRETS_ENDPOINT = "https://example.invalid"; });
await rejects(/unexpected resource/, () => {}, { secretId: "ocid1.vaultsecret.oc1.me-riyadh-1.other0308" });
await rejects(/BASE64 encoding/, () => {}, { contentType: "TEXT" });
await rejects(/canonical base64/, () => {}, { rawContent: "not-base64" });
await rejects(/CURRENT bundle has no version identity/, () => {}, { versionNumber: 0, versionName: "" });
await rejects(/plaintext is invalid/, () => {}, { value: "line1\nline2" });
await rejects(/retrieval failed \(ServiceError\)/, () => {}, { bundleError: "ServiceError" });
await rejects(/authentication initialization failed \(InstancePrincipalError\)/, () => {}, { authError: "InstancePrincipalError" });

console.log("R3 OCI secret value runtime smoke passed");
