import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const service = readFileSync(resolve(here, "../src/modules/documents/documents-attestation.service.ts"), "utf8");
const provider = readFileSync(resolve(here, "../src/infrastructure/security/oci-kms-signing-provider.ts"), "utf8");

assert.match(service, /OCI-KMS-RSA-PSS-SHA256/);
assert.match(service, /OCI-KMS-ECDSA-SHA256/);
assert.match(service, /CAREPOINT_DOCUMENT_SIGNING_KEY_REF/);
assert.match(service, /requires OCI Vault KMS document signing/);
assert.match(provider, /SIGNATURE_ENVELOPE_PREFIX = "OCI1"/);
assert.match(provider, /keyVersionId: envelope\.keyVersionId/);
assert.match(provider, /messageType: OCI_MESSAGE_TYPE/);
assert.match(provider, /SHA_256_RSA_PKCS_PSS/);
assert.match(provider, /ECDSA_SHA_256/);
assert.doesNotMatch(provider, /DOCUMENT_SIGNING_SECRET_BASE64/);

console.log("R3 OCI KMS document attestation contract smoke passed");
