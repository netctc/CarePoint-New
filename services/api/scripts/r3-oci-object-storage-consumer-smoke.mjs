import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const documentSource = readFileSync(new URL("../src/modules/documents/document-storage.service.ts", import.meta.url), "utf8");
const bulkSource = readFileSync(new URL("../src/modules/fhir/fhir-bulk-export-storage.service.ts", import.meta.url), "utf8");

for (const [label, source, domain] of [
  ["clinical document", documentSource, "clinical-documents"],
  ["FHIR bulk export", bulkSource, "fhir-bulk-export"],
]) {
  assert.match(source, /CAREPOINT_CLOUD_PROVIDER\?\.trim\(\) === "oci"/, `${label} storage must select OCI from the cloud provider contract`);
  assert.match(source, /CAREPOINT_OBJECT_STORAGE_PROVIDER\?\.trim\(\) !== "oci-object-storage"/, `${label} storage must fail closed on a mismatched OCI storage provider`);
  assert.ok(source.includes(`"${domain}"`), `${label} storage must bind the expected OCI storage domain`);
  assert.match(source, /createProductionOciObjectStorageRuntime\(process\.env\)/, `${label} storage must construct the production OCI runtime lazily`);
  assert.match(source, /onModuleDestroy/, `${label} storage must release the long-lived OCI runtime on shutdown`);
}

assert.match(documentSource, /DOCUMENT_STORAGE_PROVIDER/, "legacy document provider compatibility must remain present");
assert.match(documentSource, /AWS_ENDPOINT_URL_S3/, "legacy document S3 endpoint guard must remain present");
assert.match(bulkSource, /BULK_EXPORT_STORAGE_PROVIDER/, "legacy bulk provider compatibility must remain present");
assert.match(bulkSource, /AWS_ENDPOINT_URL_S3/, "legacy bulk S3 endpoint guard must remain present");

console.log("R3 OCI Object Storage consumer-selection smoke passed");
