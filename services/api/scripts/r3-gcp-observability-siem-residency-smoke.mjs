import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { assertProductionOtlpReady } = require("../dist/infrastructure/observability/production-otel-preflight.js");
const { assertProductionSiemReady } = require("../dist/infrastructure/siem/production-siem-preflight.js");

const managedNames = [
  "CAREPOINT_CLOUD_PROVIDER",
  "CAREPOINT_RESIDENCY_JURISDICTION",
  "CAREPOINT_APPROVED_DATA_REGIONS",
  "CAREPOINT_PRIMARY_REGION",
  "CAREPOINT_DR_REGION",
  "GCP_REGION",
  "OCI_REGION",
  "OCI_TENANCY_OCID",
  "OCI_COMPARTMENT_OCID",
  "CAREPOINT_OTEL_DESTINATION_REGION",
  "CAREPOINT_SIEM_DESTINATION_REGION",
  "OTEL_EXPORTER_OTLP_ENDPOINT",
  "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
  "OTEL_EXPORTER_OTLP_METRICS_ENDPOINT",
  "OTEL_EXPORTER_OTLP_PROTOCOL",
  "OTEL_EXPORTER_OTLP_TIMEOUT",
  "CAREPOINT_OTEL_EXPORT_MODE",
  "OTEL_SERVICE_NAME",
  "SIEM_EXPORT_ENABLED",
  "SIEM_EXPORT_URL",
  "SIEM_EXPORT_API_KEY",
  "SIEM_EXPORT_TIMEOUT_MS",
  "SIEM_WORKER_ENABLED",
  "SIEM_WORKER_POLL_MS",
  "SIEM_WORKER_LEASE_SECONDS",
  "SIEM_WORKER_BATCH_SIZE",
  "SIEM_MAX_ATTEMPTS",
  "SIEM_RETRY_BASE_SECONDS",
];

function resetManagedEnv() {
  for (const name of managedNames) delete process.env[name];
}

function apply(overrides = {}) {
  for (const [name, value] of Object.entries(overrides)) {
    if (value === undefined || value === null || value === "") delete process.env[name];
    else process.env[name] = String(value);
  }
}

function configureTransport() {
  Object.assign(process.env, {
    NODE_ENV: "production",
    OTEL_EXPORTER_OTLP_ENDPOINT: "https://otel.dammam.example.invalid:4318",
    OTEL_EXPORTER_OTLP_PROTOCOL: "http/json",
    OTEL_EXPORTER_OTLP_TIMEOUT: "5000",
    CAREPOINT_OTEL_EXPORT_MODE: "required",
    OTEL_SERVICE_NAME: "carepoint-api",
    SIEM_EXPORT_ENABLED: "true",
    SIEM_EXPORT_URL: "https://siem.dammam.example.invalid/v1/events",
    SIEM_EXPORT_API_KEY: "g3d-test-api-key-0123456789abcdef",
    SIEM_EXPORT_TIMEOUT_MS: "10000",
    SIEM_WORKER_ENABLED: "true",
    SIEM_WORKER_POLL_MS: "1000",
    SIEM_WORKER_LEASE_SECONDS: "60",
    SIEM_WORKER_BATCH_SIZE: "50",
    SIEM_MAX_ATTEMPTS: "10",
    SIEM_RETRY_BASE_SECONDS: "5",
  });
}

function configureGcp(overrides = {}) {
  resetManagedEnv();
  configureTransport();
  Object.assign(process.env, {
    CAREPOINT_CLOUD_PROVIDER: "gcp",
    CAREPOINT_RESIDENCY_JURISDICTION: "SA",
    CAREPOINT_APPROVED_DATA_REGIONS: "me-central2",
    CAREPOINT_PRIMARY_REGION: "me-central2",
    GCP_REGION: "me-central2",
    CAREPOINT_OTEL_DESTINATION_REGION: "me-central2",
    CAREPOINT_SIEM_DESTINATION_REGION: "me-central2",
  });
  apply(overrides);
}

function configureOci(overrides = {}) {
  resetManagedEnv();
  configureTransport();
  Object.assign(process.env, {
    CAREPOINT_CLOUD_PROVIDER: "oci",
    CAREPOINT_RESIDENCY_JURISDICTION: "SA",
    CAREPOINT_APPROVED_DATA_REGIONS: "me-riyadh-1,me-jeddah-1",
    CAREPOINT_PRIMARY_REGION: "me-riyadh-1",
    CAREPOINT_DR_REGION: "me-jeddah-1",
    OCI_REGION: "me-riyadh-1",
    OCI_TENANCY_OCID: "ocid1.tenancy.oc1..carepointg3dksa0001",
    OCI_COMPARTMENT_OCID: "ocid1.compartment.oc1..carepointg3dprod0001",
    CAREPOINT_OTEL_DESTINATION_REGION: "me-riyadh-1",
    CAREPOINT_SIEM_DESTINATION_REGION: "me-riyadh-1",
  });
  apply(overrides);
}

configureGcp();
let gcpOtlpCalls = 0;
await assertProductionOtlpReady({ send: async () => { gcpOtlpCalls += 1; } });
assert.equal(gcpOtlpCalls, 2, "GCP KSA OTLP readiness must validate both traces and metrics");
assert.doesNotThrow(() => assertProductionSiemReady(process.env));

configureGcp({ CAREPOINT_OTEL_DESTINATION_REGION: "" });
await assert.rejects(
  () => assertProductionOtlpReady({ send: async () => undefined }),
  /CAREPOINT_OTEL_DESTINATION_REGION is required in production/,
);

configureGcp({ CAREPOINT_OTEL_DESTINATION_REGION: "me-central1" });
await assert.rejects(
  () => assertProductionOtlpReady({ send: async () => undefined }),
  /outside CAREPOINT_APPROVED_DATA_REGIONS/,
);

configureGcp({ CAREPOINT_SIEM_DESTINATION_REGION: "" });
assert.throws(
  () => assertProductionSiemReady(process.env),
  /CAREPOINT_SIEM_DESTINATION_REGION is required in production/,
);

configureGcp({ CAREPOINT_SIEM_DESTINATION_REGION: "me-central1" });
assert.throws(
  () => assertProductionSiemReady(process.env),
  /outside CAREPOINT_APPROVED_DATA_REGIONS/,
);

configureGcp({ GCP_REGION: "me-central1" });
await assert.rejects(
  () => assertProductionOtlpReady({ send: async () => undefined }),
  /GCP_REGION must match CAREPOINT_PRIMARY_REGION/,
);

configureGcp({ CAREPOINT_DR_REGION: "me-central2" });
assert.throws(
  () => assertProductionSiemReady(process.env),
  /CAREPOINT_DR_REGION must be unset for the GCP KSA profile/,
);

configureGcp({ CAREPOINT_APPROVED_DATA_REGIONS: "me-central2,me-central1" });
assert.throws(
  () => assertProductionSiemReady(process.env),
  /approved data regions must contain only 'me-central2'/,
);

configureOci();
let ociOtlpCalls = 0;
await assertProductionOtlpReady({ send: async () => { ociOtlpCalls += 1; } });
assert.equal(ociOtlpCalls, 2, "OCI OTLP readiness must remain unchanged");
assert.doesNotThrow(() => assertProductionSiemReady(process.env));

configureOci({ CAREPOINT_OTEL_DESTINATION_REGION: "eu-frankfurt-1" });
await assert.rejects(
  () => assertProductionOtlpReady({ send: async () => undefined }),
  /outside CAREPOINT_APPROVED_DATA_REGIONS/,
);

configureOci({ CAREPOINT_SIEM_DESTINATION_REGION: "eu-frankfurt-1" });
assert.throws(
  () => assertProductionSiemReady(process.env),
  /outside CAREPOINT_APPROVED_DATA_REGIONS/,
);

resetManagedEnv();
process.env.NODE_ENV = "test";
let nonProductionCalls = 0;
await assertProductionOtlpReady({ send: async () => { nonProductionCalls += 1; } });
assert.equal(nonProductionCalls, 0);
assert.doesNotThrow(() => assertProductionSiemReady(process.env));

console.log("R3 GCP observability + SIEM KSA residency preflight smoke passed with OCI regression");
