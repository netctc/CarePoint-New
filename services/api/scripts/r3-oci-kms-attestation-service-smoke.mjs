import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  DocumentsAttestationService,
} = require("../dist/modules/documents/documents-attestation.service.js");

const previous = { ...process.env };

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in previous)) delete process.env[key];
  }
  Object.assign(process.env, previous);
}

try {
  process.env.NODE_ENV = "production";
  process.env.CAREPOINT_CLOUD_PROVIDER = "oci";
  delete process.env.DOCUMENT_SIGNING_PROVIDER;
  const service = new DocumentsAttestationService();

  await assert.rejects(
    () => service.attest("material"),
    /CAREPOINT_DOCUMENT_SIGNING_KEY_REF is required/,
    "OCI production must select the OCI signing path before attempting AWS KMS",
  );

  process.env.DOCUMENT_SIGNING_PROVIDER = "aws-kms-hmac";
  await assert.rejects(
    () => service.attest("material"),
    /requires OCI Vault KMS document signing/,
    "OCI production must reject an explicit AWS signing override",
  );

  process.env.NODE_ENV = "development";
  process.env.CAREPOINT_CLOUD_PROVIDER = "aws";
  process.env.DOCUMENT_SIGNING_PROVIDER = "local";
  process.env.DOCUMENT_SIGNING_SECRET_BASE64 = Buffer.alloc(32, 7).toString("base64");
  const local = await service.attest("material");
  assert.equal(local.algorithm, "HMAC-SHA256");
  assert.equal(await service.verify("material", local.signature, local.keyId, local.algorithm), true);

  await service.onModuleDestroy();
} finally {
  restoreEnv();
}

console.log("R3 OCI KMS document attestation service selection smoke passed");
