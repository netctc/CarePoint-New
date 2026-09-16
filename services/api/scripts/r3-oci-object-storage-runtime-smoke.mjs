import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { Readable } from "node:stream";

const require = createRequire(import.meta.url);
const {
  createProductionOciObjectStorageRuntime,
} = require("../dist/infrastructure/cloud/oci-object-storage-runtime.js");

const primaryRegion = "me-riyadh-1";
const drRegion = "me-jeddah-1";
const documentBucket = "carepoint-clinical-documents";
const bulkBucket = "carepoint-fhir-bulk-export";
const documentKey = "ocid1.key.oc1.me-riyadh-1.carepointdocuments0301";
const bulkKey = "ocid1.key.oc1.me-riyadh-1.carepointbulk0302";

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
    CAREPOINT_OBJECT_STORAGE_PROVIDER: "oci-object-storage",
    CAREPOINT_OBJECT_STORAGE_REGION: primaryRegion,
    CAREPOINT_DOCUMENT_BUCKET_REF: documentBucket,
    CAREPOINT_DOCUMENT_STORAGE_KEY_REF: documentKey,
    CAREPOINT_DOCUMENT_STORAGE_PREFIX: "carepoint/clinical",
    CAREPOINT_BULK_EXPORT_BUCKET_REF: bulkBucket,
    CAREPOINT_BULK_EXPORT_STORAGE_KEY_REF: bulkKey,
    CAREPOINT_BULK_EXPORT_PREFIX: "carepoint/bulk-export",
    BULK_EXPORT_RETENTION_SECONDS: "86400",
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
    namespaces: [],
    puts: [],
    gets: [],
    deletes: [],
    closed: 0,
    providerClosed: 0,
  };
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
      createObjectStorageClient() {
        return {
          set regionId(value) { calls.regions.push(value); },
          get regionId() { return calls.regions.at(-1) ?? ""; },
          async getNamespace(request) {
            calls.namespaces.push(request);
            if (options.namespaceError) throw namedError(options.namespaceError);
            return { value: options.namespace ?? "carepointksa" };
          },
          async putObject(request) {
            calls.puts.push(request);
            if (options.putError) throw namedError(options.putError);
            return {};
          },
          async getObject(request) {
            calls.gets.push(request);
            if (options.getError) throw namedError(options.getError);
            return { value: options.body ?? Readable.from(["carepoint-object-body"]) };
          },
          async deleteObject(request) {
            calls.deletes.push(request);
            if (options.deleteError) throw namedError(options.deleteError);
            return {};
          },
          close() { calls.closed += 1; },
        };
      },
    },
  };
}

{
  const fake = factory();
  const runtime = await createProductionOciObjectStorageRuntime(env(), { sdkFactory: fake.sdkFactory });
  assert.ok(runtime);
  assert.equal(fake.calls.auth, 1);
  assert.deepEqual(fake.calls.regions, [primaryRegion]);
  assert.deepEqual(fake.calls.namespaces, [{ compartmentId: "ocid1.compartment.oc1..carepointrelease1prod0302" }]);

  await runtime.putString("clinical-documents", "patient/report.enc", "ciphertext", {
    contentType: "application/octet-stream",
    metadata: { carepoint: "clinical-document", encrypted: "true" },
  });
  assert.equal(fake.calls.puts.length, 1);
  assert.equal(fake.calls.puts[0].namespaceName, "carepointksa");
  assert.equal(fake.calls.puts[0].bucketName, documentBucket);
  assert.equal(fake.calls.puts[0].objectName, "carepoint/clinical/patient/report.enc");
  assert.equal(fake.calls.puts[0].opcSseKmsKeyId, documentKey);
  assert.equal(fake.calls.puts[0].cacheControl, "no-store");
  assert.equal(fake.calls.puts[0].contentLength, Buffer.byteLength("ciphertext"));

  const body = await runtime.getString("fhir-bulk-export", "jobs/export.ndjson");
  assert.equal(body, "carepoint-object-body");
  assert.deepEqual(fake.calls.gets[0], {
    namespaceName: "carepointksa",
    bucketName: bulkBucket,
    objectName: "carepoint/bulk-export/jobs/export.ndjson",
  });

  await runtime.delete("fhir-bulk-export", "jobs/export.ndjson");
  assert.deepEqual(fake.calls.deletes[0], {
    namespaceName: "carepointksa",
    bucketName: bulkBucket,
    objectName: "carepoint/bulk-export/jobs/export.ndjson",
  });

  await runtime.close();
  await runtime.close();
  assert.equal(fake.calls.closed, 1);
  assert.equal(fake.calls.providerClosed, 1);
}

{
  const fake = factory();
  const config = env();
  config.NODE_ENV = "development";
  assert.equal(await createProductionOciObjectStorageRuntime(config, { sdkFactory: fake.sdkFactory }), null);
  assert.equal(fake.calls.auth, 0);
}

{
  const fake = factory();
  const config = env();
  config.CAREPOINT_CLOUD_PROVIDER = "aws";
  assert.equal(await createProductionOciObjectStorageRuntime(config, { sdkFactory: fake.sdkFactory }), null);
  assert.equal(fake.calls.auth, 0);
}

{
  const config = env();
  config.CAREPOINT_OCI_AUTH_MODE = "config-file";
  await assert.rejects(
    () => createProductionOciObjectStorageRuntime(config, { sdkFactory: factory().sdkFactory }),
    /CAREPOINT_OCI_AUTH_MODE/,
  );
}

{
  const config = env();
  config.CAREPOINT_OCI_OBJECT_STORAGE_ENDPOINT = "https://example.invalid";
  await assert.rejects(
    () => createProductionOciObjectStorageRuntime(config, { sdkFactory: factory().sdkFactory }),
    /endpoint overrides are forbidden/,
  );
}

await assert.rejects(
  () => createProductionOciObjectStorageRuntime(env(), { sdkFactory: factory({ namespace: "bad namespace" }).sdkFactory }),
  /invalid namespace/,
);

{
  const fake = factory({ authError: "InstancePrincipalError" });
  await assert.rejects(
    () => createProductionOciObjectStorageRuntime(env(), { sdkFactory: fake.sdkFactory }),
    /authentication initialization failed \(InstancePrincipalError\)/,
  );
}

{
  const fake = factory({ namespaceError: "ServiceError" });
  await assert.rejects(
    () => createProductionOciObjectStorageRuntime(env(), { sdkFactory: fake.sdkFactory }),
    /namespace discovery failed \(ServiceError\)/,
  );
}

{
  const fake = factory({ putError: "ServiceError" });
  const runtime = await createProductionOciObjectStorageRuntime(env(), { sdkFactory: fake.sdkFactory });
  await assert.rejects(
    () => runtime.putString("clinical-documents", "patient/report.enc", "ciphertext"),
    /put failed \(ServiceError\)/,
  );
  await runtime.close();
}

{
  const fake = factory();
  const runtime = await createProductionOciObjectStorageRuntime(env(), { sdkFactory: fake.sdkFactory });
  await assert.rejects(
    () => runtime.getString("clinical-documents", "../escape"),
    /Unsafe OCI Object Storage object key/,
  );
  await runtime.close();
}

console.log("R3 OCI Object Storage runtime smoke passed");
