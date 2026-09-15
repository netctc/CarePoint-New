import assert from "node:assert/strict";
import { appointmentNotificationConfiguration } from "../dist/modules/communications/appointment-notification-orchestrator.service.js";
import {
  ISOLATED_SYNTHETIC_PILOT_PROFILE,
  assertIsolatedSyntheticPilotConfiguration,
  isolatedSyntheticPrivatePilotActive,
  privatePilotInfrastructureProfile,
} from "../dist/infrastructure/release/private-pilot-infrastructure-profile.js";

const key32 = Buffer.alloc(32, 7).toString("base64");
const base = {
  NODE_ENV: "production",
  CAREPOINT_PRIVATE_PILOT: "true",
  CAREPOINT_PRIVATE_PILOT_INFRA_PROFILE: "isolated-synthetic",
  CAREPOINT_PRIVATE_PILOT_DATA_MODE: "synthetic-only",
  CAREPOINT_PRIVATE_PILOT_AUDIT_MODE: "database-local",
  CAREPOINT_PRIVATE_PILOT_TELEMETRY_MODE: "structured-local",
  CAREPOINT_PRIVATE_PILOT_SMART_FHIR_ENABLED: "false",
  CAREPOINT_RELEASE_VERSION: "0.9-closed-pilot.2",
  DATABASE_URL: "postgresql://pilot_user:pilot_password@127.0.0.1:41432/carepoint_pilot?connection_limit=5",
  REDIS_URL: "redis://:pilot_redis_password@127.0.0.1:41379/0",
  CAREPOINT_PRIVATE_PILOT_REDIS_NAMESPACE: "carepoint:pilot:0.9",
  SIEM_EXPORT_ENABLED: "false",
  SIEM_WORKER_ENABLED: "false",
  MFA_KEY_PROVIDER: "local",
  CLINICAL_KEY_PROVIDER: "local",
  ORDER_KEY_PROVIDER: "local",
  ORDER_SIGNING_PROVIDER: "local",
  DOCUMENT_STORAGE_PROVIDER: "local",
  DOCUMENT_KEY_PROVIDER: "local",
  DOCUMENT_SIGNING_PROVIDER: "local",
  DOCUMENT_SCAN_PROVIDER: "mock",
  DICOMWEB_PROVIDER: "mock",
  MESSAGING_KEY_PROVIDER: "local",
  BULK_EXPORT_STORAGE_PROVIDER: "local",
  MFA_ENVELOPE_KEY_BASE64: key32,
  CLINICAL_ENVELOPE_KEY_BASE64: key32,
  ORDER_ENVELOPE_KEY_BASE64: key32,
  DOCUMENT_ENVELOPE_KEY_BASE64: key32,
  MESSAGING_ENVELOPE_KEY_BASE64: key32,
  ORDER_SIGNING_SECRET_BASE64: key32,
  DOCUMENT_SIGNING_SECRET_BASE64: key32,
  MFA_ENVELOPE_KEY_ID: "pilot-mfa-kek-v1",
  CLINICAL_ENVELOPE_KEY_ID: "pilot-clinical-kek-v1",
  ORDER_ENVELOPE_KEY_ID: "pilot-orders-kek-v1",
  DOCUMENT_ENVELOPE_KEY_ID: "pilot-documents-kek-v1",
  MESSAGING_ENVELOPE_KEY_ID: "pilot-messaging-kek-v1",
  ORDER_SIGNING_KEY_ID: "pilot-orders-signing-v1",
  DOCUMENT_SIGNING_KEY_ID: "pilot-documents-signing-v1",
  DOCUMENT_STORAGE_LOCAL_ROOT: "/var/lib/carepoint-pilot/documents",
  BULK_EXPORT_STORAGE_LOCAL_ROOT: "/var/lib/carepoint-pilot/bulk-export",
};

assert.doesNotThrow(() => assertIsolatedSyntheticPilotConfiguration({ ...base }));
assert.equal(privatePilotInfrastructureProfile({ ...base }), ISOLATED_SYNTHETIC_PILOT_PROFILE);
assert.equal(isolatedSyntheticPrivatePilotActive({ ...base }), true);

const pilotReminderConfiguration = appointmentNotificationConfiguration({
  ...base,
  APPOINTMENT_NOTIFICATION_WORKER_ENABLED: "true",
});
assert.equal(pilotReminderConfiguration.enabled, true, "isolated synthetic pilot must keep lifecycle notification processing enabled");
assert.deepEqual(
  pilotReminderConfiguration.reminderOffsetsMinutes,
  [],
  "isolated synthetic pilot must be allowed to omit unapproved market reminder timing",
);

assert.throws(
  () => appointmentNotificationConfiguration({ NODE_ENV: "production", APPOINTMENT_NOTIFICATION_WORKER_ENABLED: "true" }),
  /APPOINTMENT_REMINDER_OFFSETS_MINUTES/,
  "normal production must continue rejecting an undefined reminder timing policy",
);
assert.throws(
  () => appointmentNotificationConfiguration({ ...base, APPOINTMENT_NOTIFICATION_WORKER_ENABLED: "false" }),
  /forbidden in production/,
  "isolated synthetic pilot must not disable appointment lifecycle notification processing",
);

assert.equal(privatePilotInfrastructureProfile({ NODE_ENV: "production" }), null, "normal production must remain unchanged when profile is absent");

for (const [name, patch, expected] of [
  ["private pilot activation", { CAREPOINT_PRIVATE_PILOT: "false" }, /requires CAREPOINT_PRIVATE_PILOT=true/],
  ["production runtime", { NODE_ENV: "development" }, /requires NODE_ENV=production/],
  ["pilot database marker", { DATABASE_URL: "postgresql://u:p@127.0.0.1:41432/carepoint?connection_limit=5" }, /database name must contain/],
  ["private database host", { DATABASE_URL: "postgresql://u:p@db.example.com:5432/carepoint_pilot?connection_limit=5" }, /private\/internal/],
  ["database authentication", { DATABASE_URL: "postgresql://127.0.0.1:41432/carepoint_pilot?connection_limit=5" }, /authentication credentials/],
  ["redis authentication", { REDIS_URL: "redis://127.0.0.1:41379/0" }, /authentication credentials/],
  ["redis private host", { REDIS_URL: "rediss://:p@redis.example.com:6379/0" }, /private\/internal/],
  ["synthetic data mode", { CAREPOINT_PRIVATE_PILOT_DATA_MODE: "mixed" }, /must be 'synthetic-only'/],
  ["database-local audit", { CAREPOINT_PRIVATE_PILOT_AUDIT_MODE: "external" }, /must be 'database-local'/],
  ["structured local telemetry", { CAREPOINT_PRIVATE_PILOT_TELEMETRY_MODE: "disabled" }, /must be 'structured-local'/],
  ["SMART FHIR disabled", { CAREPOINT_PRIVATE_PILOT_SMART_FHIR_ENABLED: "true" }, /must be 'false'/],
  ["pilot-scoped storage", { DOCUMENT_STORAGE_LOCAL_ROOT: "/var/lib/carepoint/documents" }, /must contain 'pilot'/],
  ["pilot-scoped key id", { MFA_ENVELOPE_KEY_ID: "local-mfa-kek-v1" }, /must contain 'pilot'/],
  ["strong local key", { CLINICAL_ENVELOPE_KEY_BASE64: Buffer.alloc(16, 1).toString("base64") }, /exactly 32 bytes/],
  ["release identity", { CAREPOINT_RELEASE_VERSION: "release-1" }, /0.9 closed pilot/],
]) {
  assert.throws(
    () => assertIsolatedSyntheticPilotConfiguration({ ...base, ...patch }),
    expected,
    name,
  );
}

assert.throws(
  () => privatePilotInfrastructureProfile({ ...base, CAREPOINT_PRIVATE_PILOT_INFRA_PROFILE: "anything-else" }),
  /must be 'isolated-synthetic'/,
);

console.log("private-pilot infrastructure profile smoke: PASS");
