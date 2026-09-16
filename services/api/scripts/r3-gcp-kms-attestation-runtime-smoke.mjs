import assert from "node:assert/strict";
import {
  constants as cryptoConstants,
  createHash,
  generateKeyPairSync,
  sign as signData,
} from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  GcpKmsSigningProvider,
} = require("../dist/infrastructure/security/gcp-kms-signing-provider.js");

const region = "me-central2";
const projectId = "carepoint-r1";
const serviceAccountEmail = `carepoint-runtime@${projectId}.iam.gserviceaccount.com`;
const keyRing = `projects/${projectId}/locations/${region}/keyRings/carepoint-r1`;
const documentKeyRef = `${keyRing}/cryptoKeys/clinical-documents`;
const signingKeyRef = `${keyRing}/cryptoKeys/clinical-document-attestation`;
const externalKeyRef = `${keyRing}/cryptoKeys/external-secrets`;
const signingVersionRef = `${signingKeyRef}/cryptoKeyVersions/7`;
const material = "diagnostic-report-attestation-material";
const payloadDigest = createHash("sha256").update(material).digest("hex");
const kmsHost = `cloudkms.${region}.rep.googleapis.com`;
const metadataHost = "metadata.google.internal";
const providerAlgorithm = "RSA_SIGN_PSS_2048_SHA256";
const ecdsaProviderAlgorithm = "EC_SIGN_P256_SHA256";

const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
const rsaPublicKeyPem = rsa.publicKey.export({ type: "spki", format: "pem" }).toString();
const ec = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const ecPublicKeyPem = ec.publicKey.export({ type: "spki", format: "pem" }).toString();

function env() {
  return {
    NODE_ENV: "production",
    CAREPOINT_CLOUD_PROVIDER: "gcp",
    CAREPOINT_RESIDENCY_JURISDICTION: "SA",
    CAREPOINT_APPROVED_DATA_REGIONS: region,
    CAREPOINT_PRIMARY_REGION: region,
    GCP_REGION: region,
    GCP_PROJECT_ID: projectId,
    CAREPOINT_GCP_AUTH_MODE: "metadata-service",
    CAREPOINT_GCP_SERVICE_ACCOUNT_EMAIL: serviceAccountEmail,
    CAREPOINT_KEY_MANAGEMENT_PROVIDER: "gcp-cloud-kms",
    CAREPOINT_KEY_MANAGEMENT_REGION: region,
    CAREPOINT_VAULT_REF: keyRing,
    CAREPOINT_DOCUMENT_KEY_REF: documentKeyRef,
    CAREPOINT_DOCUMENT_SIGNING_KEY_REF: signingKeyRef,
    CAREPOINT_DOCUMENT_SIGNING_KEY_VERSION_REF: signingVersionRef,
    CAREPOINT_EXTERNAL_SECRET_KEY_REF: externalKeyRef,
    CAREPOINT_KEY_MAX_ROTATION_DAYS: "365",
  };
}

function response(body, { status = 200, headers = {} } = {}) {
  return new Response(body, { status, headers });
}

function jsonResponse(value, options = {}) {
  return response(JSON.stringify(value), {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers ?? {}),
    },
  });
}

function crc32c(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) !== 0 ? 0x82f63b78 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function signatureFor(value, algorithm) {
  if (algorithm === ecdsaProviderAlgorithm) {
    return signData(
      "sha256",
      Buffer.from(value, "utf8"),
      { key: ec.privateKey, dsaEncoding: "der" },
    );
  }
  return signData(
    "sha256",
    Buffer.from(value, "utf8"),
    {
      key: rsa.privateKey,
      padding: cryptoConstants.RSA_PKCS1_PSS_PADDING,
      saltLength: 32,
    },
  );
}

function publicKeyPemFor(algorithm) {
  return algorithm === ecdsaProviderAlgorithm ? ecPublicKeyPem : rsaPublicKeyPem;
}

function fakeFetch(options = {}) {
  const calls = [];
  let emailCalls = 0;
  let tokenCalls = 0;
  let keyInspections = 0;
  let versionInspections = 0;
  let signCalls = 0;
  let publicKeyCalls = 0;

  return {
    calls,
    get emailCalls() { return emailCalls; },
    get tokenCalls() { return tokenCalls; },
    get keyInspections() { return keyInspections; },
    get versionInspections() { return versionInspections; },
    get signCalls() { return signCalls; },
    get publicKeyCalls() { return publicKeyCalls; },
    fetch: async (input, init = {}) => {
      const url = new URL(String(input));
      calls.push({ url: url.toString(), init });

      if (url.hostname === metadataHost && url.pathname.endsWith("/service-accounts/default/email")) {
        emailCalls += 1;
        return response(options.email ?? serviceAccountEmail, {
          headers: options.omitMetadataFlavor ? {} : { "metadata-flavor": "Google" },
        });
      }
      if (url.hostname === metadataHost && url.pathname.endsWith("/service-accounts/default/token")) {
        tokenCalls += 1;
        return jsonResponse({
          access_token: options.token ?? "short-lived-signing-token",
          expires_in: options.expiresIn ?? 3600,
          token_type: options.tokenType ?? "Bearer",
        }, {
          headers: { "metadata-flavor": "Google" },
        });
      }

      if (url.hostname !== kmsHost) throw new Error(`Unexpected URL host: ${url.hostname}`);
      assert.equal(url.protocol, "https:");
      assert.equal(url.search, "");
      assert.equal(url.hash, "");
      assert.equal(init.redirect, "error");
      assert.equal(init.headers?.Authorization, "Bearer short-lived-signing-token");
      assert.ok(init.signal, "Cloud KMS calls require timeout signals");

      if (options.httpStatus) {
        return response("PROVIDER-SIGNING-BODY-MUST-NOT-ESCAPE", { status: options.httpStatus });
      }

      const algorithm = options.algorithm ?? providerAlgorithm;
      const path = decodeURIComponent(url.pathname);
      if (path === `/v1/${signingKeyRef}` && init.method === "GET") {
        keyInspections += 1;
        return jsonResponse({
          name: options.keyName ?? signingKeyRef,
          purpose: options.keyPurpose ?? "ASYMMETRIC_SIGN",
        });
      }
      if (path === `/v1/${signingVersionRef}` && init.method === "GET") {
        versionInspections += 1;
        return jsonResponse({
          name: options.versionName ?? signingVersionRef,
          state: options.versionState ?? "ENABLED",
          algorithm,
          protectionLevel: options.protectionLevel ?? "HSM",
        });
      }
      if (path === `/v1/${signingVersionRef}:asymmetricSign` && init.method === "POST") {
        signCalls += 1;
        const body = JSON.parse(String(init.body));
        const digest = Buffer.from(body.digest?.sha256 ?? "", "base64");
        assert.equal(digest.toString("hex"), payloadDigest);
        assert.equal(Number(body.digestCrc32c), crc32c(digest));
        const signature = options.signature ?? signatureFor(material, algorithm).toString("base64");
        return jsonResponse({
          name: options.signResponseName ?? signingVersionRef,
          signature,
          signatureCrc32c: options.signatureCrc32c
            ?? String(crc32c(Buffer.from(signature, "base64"))),
          verifiedDigestCrc32c: options.verifiedDigest ?? true,
          protectionLevel: options.protectionLevel ?? "HSM",
        });
      }
      if (path === `/v1/${signingVersionRef}/publicKey` && init.method === "GET") {
        publicKeyCalls += 1;
        const publicKeyAlgorithm = options.publicKeyAlgorithm ?? algorithm;
        const pem = options.pem ?? publicKeyPemFor(publicKeyAlgorithm);
        return jsonResponse({
          name: options.publicKeyName ?? signingVersionRef,
          pem,
          algorithm: publicKeyAlgorithm,
          pemCrc32c: options.pemCrc32c ?? String(crc32c(Buffer.from(pem, "utf8"))),
          protectionLevel: options.protectionLevel ?? "HSM",
        });
      }
      throw new Error(`Unexpected Cloud KMS request: ${init.method} ${path}`);
    },
  };
}

async function rejects(pattern, mutate = () => {}, options = {}) {
  const config = env();
  mutate(config);
  const fake = fakeFetch(options);
  const provider = new GcpKmsSigningProvider(signingKeyRef, config, {
    fetch: fake.fetch,
    now: () => 1_700_000_000_000,
  });
  await assert.rejects(() => provider.signDigest(payloadDigest), pattern);
  return fake;
}

{
  const fake = fakeFetch();
  const provider = new GcpKmsSigningProvider(signingKeyRef, env(), {
    fetch: fake.fetch,
    now: () => 1_700_000_000_000,
  });

  const signed = await provider.signDigest(payloadDigest);
  assert.equal(signed.algorithm, "GCP-KMS-RSA-PSS-SHA256");
  assert.equal(signed.keyId, signingKeyRef);
  assert.ok(signed.signature.startsWith(`GCP1|${signingVersionRef}|`));
  assert.equal(await provider.verifyMaterial(material, signed.signature, signed.algorithm), true);
  assert.equal(await provider.verifyMaterial(`${material}-tampered`, signed.signature, signed.algorithm), false);
  assert.equal(await provider.verifyMaterial(material, signed.signature, "GCP-KMS-ECDSA-P256-SHA256"), false);
  assert.equal(await provider.verifyMaterial(material, "not-an-envelope", signed.algorithm), false);

  assert.equal(fake.emailCalls, 1, "runtime identity should be validated once");
  assert.equal(fake.tokenCalls, 1, "metadata access token should be cached in memory");
  assert.equal(fake.keyInspections, 1);
  assert.equal(fake.versionInspections, 1);
  assert.equal(fake.signCalls, 1);
  assert.equal(fake.publicKeyCalls, 3, "all well-formed persisted signatures use the exact version public key before cryptographic/algorithm validation");
  await provider.close();
  await assert.rejects(() => provider.signDigest(payloadDigest), /provider is closed/);
}

{
  const fake = fakeFetch({ algorithm: ecdsaProviderAlgorithm });
  const provider = new GcpKmsSigningProvider(signingKeyRef, env(), { fetch: fake.fetch });
  const signed = await provider.signDigest(payloadDigest);
  assert.equal(signed.algorithm, "GCP-KMS-ECDSA-P256-SHA256");
  assert.equal(await provider.verifyMaterial(material, signed.signature, signed.algorithm), true);
  assert.equal(await provider.verifyMaterial(`${material}-tampered`, signed.signature, signed.algorithm), false);
}

await rejects(/CAREPOINT_GCP_AUTH_MODE/, (config) => { config.CAREPOINT_GCP_AUTH_MODE = "service-account-key"; });
await rejects(
  /GOOGLE_APPLICATION_CREDENTIALS static credential configuration is forbidden/,
  (config) => { config.GOOGLE_APPLICATION_CREDENTIALS = "/tmp/key.json"; },
);
await rejects(
  /endpoint overrides are forbidden/,
  (config) => { config.CAREPOINT_GCP_KMS_ENDPOINT = "https://example.invalid"; },
);
await rejects(/restricted to GCP production/, (config) => { config.CAREPOINT_CLOUD_PROVIDER = "oci"; });
await rejects(
  /CAREPOINT_DOCUMENT_SIGNING_KEY_VERSION_REF is required/,
  (config) => { delete config.CAREPOINT_DOCUMENT_SIGNING_KEY_VERSION_REF; },
);
await rejects(
  /must be a numeric CryptoKeyVersion under CAREPOINT_DOCUMENT_SIGNING_KEY_REF/,
  (config) => { config.CAREPOINT_DOCUMENT_SIGNING_KEY_VERSION_REF = `${documentKeyRef}/cryptoKeyVersions/7`; },
);
await rejects(
  /runtime service-account identity does not match/,
  () => {},
  { email: `wrong-runtime@${projectId}.iam.gserviceaccount.com` },
);
await rejects(/unexpected CryptoKey/, () => {}, { keyName: documentKeyRef });
await rejects(/ASYMMETRIC_SIGN purpose/, () => {}, { keyPurpose: "ENCRYPT_DECRYPT" });
await rejects(/must be ENABLED/, () => {}, { versionState: "DISABLED" });
await rejects(/unsupported signing algorithm/, () => {}, { algorithm: "RSA_SIGN_PSS_4096_SHA512" });
await rejects(/SOFTWARE or HSM protection/, () => {}, { protectionLevel: "EXTERNAL" });
await rejects(/did not verify the digest CRC32C/, () => {}, { verifiedDigest: false });
await rejects(/unexpected CryptoKeyVersion/, () => {}, { signResponseName: `${signingKeyRef}/cryptoKeyVersions/8` });
await rejects(/failed CRC32C integrity validation/, () => {}, { signatureCrc32c: "1" });
await rejects(/not canonical base64/, () => {}, { signature: "not-base64", signatureCrc32c: "1" });

{
  const fake = await rejects(/request failed \(HTTP 503\)/, () => {}, { httpStatus: 503 });
  assert.ok(fake.calls.length > 0);
}

{
  const fake = fakeFetch({ pemCrc32c: "1" });
  const provider = new GcpKmsSigningProvider(signingKeyRef, env(), { fetch: fake.fetch });
  const signed = await provider.signDigest(payloadDigest);
  await assert.rejects(
    () => provider.verifyMaterial(material, signed.signature, signed.algorithm),
    /public key PEM failed CRC32C integrity validation/,
  );
}

{
  const fake = fakeFetch({ publicKeyAlgorithm: ecdsaProviderAlgorithm, pem: ecPublicKeyPem });
  const provider = new GcpKmsSigningProvider(signingKeyRef, env(), { fetch: fake.fetch });
  const signed = await provider.signDigest(payloadDigest);
  assert.equal(await provider.verifyMaterial(material, signed.signature, signed.algorithm), false);
}

{
  const config = env();
  const otherKeyRing = `projects/other-project/locations/${region}/keyRings/carepoint-r1`;
  config.CAREPOINT_VAULT_REF = otherKeyRing;
  config.CAREPOINT_DOCUMENT_KEY_REF = `${otherKeyRing}/cryptoKeys/clinical-documents`;
  config.CAREPOINT_DOCUMENT_SIGNING_KEY_REF = `${otherKeyRing}/cryptoKeys/clinical-document-attestation`;
  config.CAREPOINT_DOCUMENT_SIGNING_KEY_VERSION_REF = `${config.CAREPOINT_DOCUMENT_SIGNING_KEY_REF}/cryptoKeyVersions/7`;
  config.CAREPOINT_EXTERNAL_SECRET_KEY_REF = `${otherKeyRing}/cryptoKeys/external-secrets`;
  const fake = fakeFetch();
  const provider = new GcpKmsSigningProvider(config.CAREPOINT_DOCUMENT_SIGNING_KEY_REF, config, { fetch: fake.fetch });
  await assert.rejects(() => provider.signDigest(payloadDigest), /must belong to GCP_PROJECT_ID/);
}

console.log("R3 GCP Cloud KMS attestation runtime smoke passed");
