import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const schema = readFileSync(new URL("../prisma/documents.prisma", import.meta.url), "utf8");
const versionSchema = readFileSync(new URL("../prisma/v2_document_versions.prisma", import.meta.url), "utf8");
const migration = readFileSync(new URL("../prisma/migrations/20260922150000_v2_document_versioning/migration.sql", import.meta.url), "utf8");
const service = readFileSync(new URL("../src/modules/documents/document-versioning.service.ts", import.meta.url), "utf8");
const controller = readFileSync(new URL("../src/modules/documents/document-versioning.controller.ts", import.meta.url), "utf8");
const moduleSource = readFileSync(new URL("../src/modules/documents/document-versioning.module.ts", import.meta.url), "utf8");
const appModule = readFileSync(new URL("../src/app.module.ts", import.meta.url), "utf8");

assert.match(schema, /logicalDocumentId\s+String/);
assert.match(schema, /documentVersion\s+Int/);
assert.match(schema, /effectiveDate\s+DateTime/);
assert.match(schema, /sourceType\s+String/);
assert.match(schema, /supersedesDocumentId\s+String\?/);
assert.match(schema, /@@unique\(\[logicalDocumentId, documentVersion\]\)/);

assert.match(versionSchema, /model DocumentVersion/);
assert.match(versionSchema, /versionHash\s+String/);
assert.match(versionSchema, /@@unique\(\[logicalDocumentId, version\]\)/);

assert.match(migration, /ClinicalDocument_snapshot_version/);
assert.match(migration, /DocumentVersion_no_update/);
assert.match(migration, /DocumentVersion_no_delete/);
assert.match(migration, /ClinicalDocument_version_identity_immutable/);
assert.match(migration, /REVOKE UPDATE, DELETE ON "DocumentVersion" FROM PUBLIC/);
assert.match(migration, /FOREIGN KEY \("supersedesDocumentId"\) REFERENCES "ClinicalDocument"/);

assert.match(service, /TransactionIsolationLevel\.Serializable/);
assert.match(service, /FOR UPDATE/);
assert.match(service, /expectedVersion/);
assert.match(service, /latest\.documentVersion \+ 1/);
assert.match(service, /status: "SUPERSEDED"/);
assert.match(service, /supersedesDocumentId: latest\.id/);
assert.match(service, /logicalDocumentId: latest\.logicalDocumentId/);
assert.match(service, /`clinical\/\$\{randomUUID\(\)\}\.cpenc`/);
assert.match(service, /CLINICAL_DOCUMENT_VERSION_CREATED/);
assert.match(service, /writeClinicalInTransaction/);
assert.match(service, /Patients can version only their own uploaded documents/);
assert.match(service, /Only the active authoring provider can version this document/);

const rollbackRemovals = [...service.matchAll(/storage\.remove\(([^)]+)\)/g)].map((match) => match[1]);
assert.deepEqual(rollbackRemovals, ["storedObjectKey"], "BE-028 must remove only a newly staged object on rollback; historical objects must remain untouched.");
assert.doesNotMatch(service, /storage\.remove\(latest\.objectKey/);
assert.doesNotMatch(service, /objectKey:\s*latest\.objectKey/);

assert.match(controller, /@Get\(":documentId\/versions"\)/);
assert.match(controller, /@Post\(":documentId\/versions"\)/);
assert.match(controller, /PATIENT_READ_CLINICAL_DOCUMENTS/);
assert.match(controller, /CLINICAL_DOCUMENT_WRITE/);
assert.match(moduleSource, /DocumentVersioningService/);
assert.match(appModule, /DocumentVersioningModule/);

console.log("BE-028 immutable clinical document versioning acceptance passed");
