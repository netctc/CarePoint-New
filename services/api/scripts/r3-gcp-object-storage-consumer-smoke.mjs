import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  DocumentStorageService,
} = require("../dist/modules/documents/document-storage.service.js");

const documentSource = readFileSync(new URL("../src/modules/documents/document-storage.service.ts", import.meta.url), "utf8");
const bulkSource = readFileSync(new URL("../src/modules/fhir/fhir-bulk-export-storage.service.ts", import.meta.url), "utf8");

for (const [label, source, domain] of [
  ["clinical document", documentSource, "clinical-documents"],
  ["FHIR bulk export", bulkSource, "fhir-bulk-export"],
]) {
  assert.match(source, /CAREPOINT_CLOUD_PROVIDER\?\.trim\(\) === "gcp"/, `${label} storage must select GCP from the cloud provider contract`);
  assert.match(source, /CAREPOINT_OBJECT_STORAGE_PROVIDER\?\.trim\(\) !== "gcp-cloud-storage"/, `${label} storage must fail closed on a mismatched GCP storage provider`);
  assert.ok(source.includes(`"${domain}"`), `${label} storage must bind the expected GCP storage domain`);
  assert.match(source, /createProductionGcpObjectStorageRuntime\(process\.env\)/, `${label} storage must construct the production GCP runtime lazily`);
  assert.match(source, /createProductionOciObjectStorageRuntime\(process\.env\)/, `${label} storage must retain the OCI runtime path`);
  assert.match(source, /onModuleDestroy/, `${label} storage must release long-lived cloud runtimes on shutdown`);
}

assert.match(documentSource, /DOCUMENT_STORAGE_PROVIDER/, "legacy document provider compatibility must remain present");
assert.match(documentSource, /AWS_ENDPOINT_URL_S3/, "legacy document S3 endpoint guard must remain present");
assert.match(bulkSource, /BULK_EXPORT_STORAGE_PROVIDER/, "legacy bulk provider compatibility must remain present");
assert.match(bulkSource, /AWS_ENDPOINT_URL_S3/, "legacy bulk S3 endpoint guard must remain present");

const previous = { ...process.env };
try {
  process.env.NODE_ENV = "production";
  process.env.CAREPOINT_CLOUD_PROVIDER = "gcp";
  process.env.CAREPOINT_OBJECT_STORAGE_PROVIDER = "gcp-cloud-storage";
  const service = new DocumentStorageService();
  assert.equal(service.storageProviderName(), "GCP_CLOUD_STORAGE");

  process.env.CAREPOINT_OBJECT_STORAGE_PROVIDER = "oci-object-storage";
  assert.throws(
    () => service.storageProviderName(),
    /GCP production document storage requires CAREPOINT_OBJECT_STORAGE_PROVIDER='gcp-cloud-storage'/,
  );
} finally {
  for (const key of Object.keys(process.env)) {
    if (!(key in previous)) delete process.env[key];
  }
  Object.assign(process.env, previous);
}

console.log("R3 GCP Cloud Storage consumer-selection smoke passed");
