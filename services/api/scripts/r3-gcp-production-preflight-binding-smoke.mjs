import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  createGcpManagedKeyInspector,
  createGcpExternalCredentialInspector,
} = require("../dist/infrastructure/cloud/gcp-security-inspector-adapter.js");
const {
  assertProductionKmsReady,
} = require("../dist/infrastructure/security/production-kms-preflight.js");
const {
  assertProductionKmsRotationReady,
} = require("../dist/infrastructure/security/production-kms-rotation-preflight.js");
const {
  assertProductionExternalSecretsReady,
} = require("../dist/infrastructure/secrets/production-external-secrets-preflight.js");

const region = "me-central2";
const projectId = "carepoint-r1";
const keyRing = `projects/${projectId}/locations/${region}/keyRings/carepoint-r1`;
const documentKey = `${keyRing}/cryptoKeys/clinical-documents`;
const signingKey = `${keyRing}/cryptoKeys/clinical-document-attestation`;
const externalSecretKey = `${keyRing}/cryptoKeys/external-secrets`;

function secretRef(name) {
  return `projects/${projectId}/locations/${region}/secrets/${name}`;
}

const externalRefs = {
  CAREPOINT_PAYMENT_GATEWAY_SECRET_REF: secretRef("payment-gateway-api-key"),
  CAREPOINT_INSURANCE_GATEWAY_SECRET_REF: secretRef("insurance-gateway-api-key"),
  CAREPOINT_CLAIMS_GATEWAY_SECRET_REF: secretRef("claims-gateway-api-key"),
  CAREPOINT_NOTIFICATION_GATEWAY_SECRET_REF: secretRef("notification-gateway-api-key"),
  CAREPOINT_SIEM_EXPORT_SECRET_REF: secretRef("siem-export-api-key"),
  CAREPOINT_LIVEKIT_API_KEY_SECRET_REF: secretRef("livekit-api-key"),
  CAREPOINT_LIVEKIT_API_SECRET_REF: secretRef("livekit-api-secret"),
};

function configureGcpProduction() {
  Object.assign(process.env, {
    NODE_ENV: "production",
    CAREPOINT_CLOUD_PROVIDER: "gcp",
    CAREPOINT_RESIDENCY_JURISDICTION: "SA",
    CAREPOINT_APPROVED_DATA_REGIONS: region,
    CAREPOINT_PRIMARY_REGION: region,
    GCP_REGION: region,
    GCP_PROJECT_ID: projectId,
    CAREPOINT_KEY_MANAGEMENT_PROVIDER: "gcp-cloud-kms",
    CAREPOINT_KEY_MANAGEMENT_REGION: region,
    CAREPOINT_VAULT_REF: keyRing,
    CAREPOINT_DOCUMENT_KEY_REF: documentKey,
    CAREPOINT_DOCUMENT_SIGNING_KEY_REF: signingKey,
    CAREPOINT_EXTERNAL_SECRET_KEY_REF: externalSecretKey,
    CAREPOINT_KEY_MAX_ROTATION_DAYS: "365",
    CAREPOINT_EXTERNAL_SECRET_PROVIDER: "gcp-secret-manager",
    CAREPOINT_EXTERNAL_SECRET_REGION: region,
    ...externalRefs,
  });

  for (const name of [
    "CAREPOINT_DR_REGION",
    "AWS_REGION",
    "AWS_ENDPOINT_URL_KMS",
    "PAYMENT_GATEWAY_API_KEY",
    "INSURANCE_GATEWAY_API_KEY",
    "CLAIMS_GATEWAY_API_KEY",
    "NOTIFICATION_GATEWAY_API_KEY",
    "SIEM_EXPORT_API_KEY",
    "LIVEKIT_API_KEY",
    "LIVEKIT_API_SECRET",
  ]) delete process.env[name];
}

function createClients(overrides = {}) {
  const keyCalls = [];
  const secretCalls = [];
  const versionCalls = [];

  const keyClient = {
    async getCryptoKey({ name }) {
      keyCalls.push(name);
      if (name === signingKey) {
        return {
          cryptoKey: {
            name,
            purpose: "ASYMMETRIC_SIGN",
            primary: {
              state: overrides.keyState ?? "ENABLED",
              protectionLevel: "HSM",
            },
          },
        };
      }
      return {
        cryptoKey: {
          name,
          purpose: "ENCRYPT_DECRYPT",
          primary: {
            state: overrides.keyState ?? "ENABLED",
            protectionLevel: "HSM",
          },
          rotationPeriod: { seconds: String((overrides.rotationDays ?? 90) * 86_400) },
        },
      };
    },
  };

  const secretClient = {
    async getSecret({ name }) {
      secretCalls.push(name);
      return {
        secret: {
          name,
          customerManagedEncryption: {
            kmsKeyName: overrides.secretKeyRef ?? externalSecretKey,
          },
        },
      };
    },
    async getSecretVersion({ name }) {
      versionCalls.push(name);
      if (overrides.missingCurrent === true) return {};
      return {
        secretVersion: {
          name,
          state: "ENABLED",
        },
      };
    },
  };

  return { keyClient, secretClient, keyCalls, secretCalls, versionCalls };
}

process.env.NODE_ENV = "test";
let nonProductionCalls = 0;
await assertProductionKmsReady({ inspectManagedKey: async () => { nonProductionCalls += 1; throw new Error("unexpected"); } });
await assertProductionKmsRotationReady({ inspectManagedKey: async () => { nonProductionCalls += 1; throw new Error("unexpected"); } });
await assertProductionExternalSecretsReady(process.env, undefined, {
  inspectExternalCredential: async () => { nonProductionCalls += 1; throw new Error("unexpected"); },
});
assert.equal(nonProductionCalls, 0);

configureGcpProduction();
const live = createClients();
const inspectManagedKey = createGcpManagedKeyInspector({ region, client: live.keyClient });
const inspectExternalCredential = createGcpExternalCredentialInspector({ region, client: live.secretClient });

await assertProductionKmsReady({ inspectManagedKey });
await assertProductionKmsRotationReady({ inspectManagedKey });
await assertProductionExternalSecretsReady(process.env, undefined, { inspectExternalCredential });
assert.equal(live.keyCalls.length, 6, "C1 and C8 must each inspect all three GCP managed-key domains");
assert.equal(live.secretCalls.length, 7, "external credential preflight must inspect all seven GCP regional secrets");
assert.equal(live.versionCalls.length, 7, "external credential preflight must verify a latest enabled version for all seven secrets");
assert.ok(live.versionCalls.every((name) => name.endsWith("/versions/latest")));
assert.equal(process.env.AWS_REGION, undefined, "GCP managed preflights must not fall through to AWS configuration");

configureGcpProduction();
await assert.rejects(
  assertProductionKmsReady(),
  /GCP production KMS preflight requires a live managed-key inspector/,
);
await assert.rejects(
  assertProductionKmsRotationReady(),
  /GCP production KMS rotation preflight requires a live managed-key inspector/,
);
await assert.rejects(
  assertProductionExternalSecretsReady(process.env),
  /GCP production external credential preflight requires a live GCP Secret Manager inspector/,
);

configureGcpProduction();
const disabled = createClients({ keyState: "DISABLED" });
await assert.rejects(
  assertProductionKmsReady({
    inspectManagedKey: createGcpManagedKeyInspector({ region, client: disabled.keyClient }),
  }),
  /must be in ENABLED lifecycle state/,
);

configureGcpProduction();
const slowRotation = createClients({ rotationDays: 366 });
await assert.rejects(
  assertProductionKmsRotationReady({
    inspectManagedKey: createGcpManagedKeyInspector({ region, client: slowRotation.keyClient }),
  }),
  /rotation period exceeds CAREPOINT_KEY_MAX_ROTATION_DAYS/,
);

configureGcpProduction();
const noCurrent = createClients({ missingCurrent: true });
await assert.rejects(
  assertProductionExternalSecretsReady(process.env, undefined, {
    inspectExternalCredential: createGcpExternalCredentialInspector({ region, client: noCurrent.secretClient }),
  }),
  /External credential preflight failed/,
);

const mainSource = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
assert.match(mainSource, /createProductionGcpSecurityRuntime/);
assert.match(mainSource, /productionCloudProvider === "gcp"/);
assert.match(mainSource, /await assertProductionGcpObjectStorageReady\(\)/);
assert.ok(
  mainSource.indexOf("await assertProductionKmsReady(") < mainSource.indexOf("NestFactory.create"),
  "GCP managed-key preflight must execute before Nest application creation",
);
assert.ok(
  mainSource.indexOf("await assertProductionGcpObjectStorageReady()") < mainSource.indexOf("NestFactory.create"),
  "GCP Cloud Storage preflight must execute before Nest application creation",
);

await import("./r3-gcp-cloud-run-preflight-smoke.mjs");

console.log("R3 GCP production security/storage startup binding smoke passed");
