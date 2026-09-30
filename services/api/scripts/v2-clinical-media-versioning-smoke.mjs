import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const schema = readFileSync(new URL("../prisma/v2_clinical_media.prisma", import.meta.url), "utf8");
const versionSchema = readFileSync(new URL("../prisma/v2_clinical_media_versions.prisma", import.meta.url), "utf8");
const migration = readFileSync(new URL("../prisma/migrations/20260922170000_v2_clinical_media_versioning/migration.sql", import.meta.url), "utf8");
const service = readFileSync(new URL("../src/modules/documents/clinical-media-versioning.service.ts", import.meta.url), "utf8");
const controller = readFileSync(new URL("../src/modules/documents/clinical-media-versioning.controller.ts", import.meta.url), "utf8");
const moduleSource = readFileSync(new URL("../src/modules/documents/clinical-media.module.ts", import.meta.url), "utf8");

assert.match(schema, /SUPERSEDED/);
assert.match(schema, /logicalMediaId\s+String\?/);
assert.match(schema, /mediaVersion\s+Int/);
assert.match(schema, /effectiveDate\s+DateTime/);
assert.match(schema, /sourceType\s+String\?/);
assert.match(schema, /supersedesMediaId\s+String\?/);
assert.match(schema, /@@unique\(\[logicalMediaId, mediaVersion\]\)/);

assert.match(versionSchema, /model ClinicalMediaVersion/);
assert.match(versionSchema, /contentDigest\s+String/);
assert.match(versionSchema, /consentEvidenceId\s+String/);
assert.match(versionSchema, /@@unique\(\[logicalMediaId, version\]\)/);

assert.match(migration, /ClinicalMedia_version_identity_init_trigger/);
assert.match(migration, /NEW\."logicalMediaId" := NEW\."id"/);
assert.match(migration, /ClinicalMedia_version_snapshot_trigger/);
assert.match(migration, /ClinicalMedia_immutable_payload_trigger/);
assert.match(migration, /ClinicalMediaVersion_immutable_trigger/);
assert.match(migration, /REVOKE UPDATE, DELETE ON "ClinicalMediaVersion" FROM PUBLIC/);
assert.match(migration, /FOREIGN KEY \("supersedesMediaId"\) REFERENCES "ClinicalMedia"/);
assert.match(migration, /CASE WHEN NEW\."providerId" IS NULL THEN 'PATIENT_UPLOAD' ELSE 'PROVIDER_CAPTURE' END/);

assert.match(service, /TransactionIsolationLevel\.Serializable/);
assert.match(service, /FOR UPDATE/);
assert.match(service, /expectedVersion/);
assert.match(service, /latest\.mediaVersion \+ 1/);
assert.match(service, /status: "SUPERSEDED"/);
assert.match(service, /supersedesMediaId: latest\.id/);
assert.match(service, /logicalMediaId/);
assert.match(service, /CLINICAL_MEDIA_VERSION_CREATED/);
assert.match(service, /CLINICAL_MEDIA_VERSION_HISTORY_READ/);
assert.match(service, /writeClinicalInTransaction/);
assert.match(service, /reserveIntegrityChainForSerializableTransaction/);
assert.match(service, /consentEvidence\.create/);
assert.match(service, /Active clinical-media consent is required/);
assert.match(service, /Patients can version only their own uploaded clinical media/);
assert.match(service, /Only the active authoring provider can version this clinical media/);
assert.match(service, /`clinical-media\/\$\{randomUUID\(\)\}\.cpenc`/);
assert.match(service, /`clinical-media\/thumbnails\/\$\{randomUUID\(\)\}\.cpenc`/);

assert.match(service, /storage\.remove\(payload\.objectKey\)/);
assert.match(service, /storage\.remove\(payload\.thumbnailObjectKey\)/);
assert.doesNotMatch(service, /storage\.remove\(latest\.objectKey/);
assert.doesNotMatch(service, /objectKey:\s*latest\.objectKey/);

assert.match(controller, /@Get\(":mediaId\/versions"\)/);
assert.match(controller, /@Post\(":mediaId\/versions"\)/);
assert.match(controller, /PATIENT_MANAGE_CLINICAL_MEDIA/);
assert.match(controller, /CLINICAL_MEDIA_READ/);
assert.match(controller, /CLINICAL_MEDIA_WRITE/);
assert.match(moduleSource, /ClinicalMediaVersioningController/);
assert.match(moduleSource, /ClinicalMediaVersioningService/);

console.log("BE-029 immutable clinical media versioning acceptance passed");
