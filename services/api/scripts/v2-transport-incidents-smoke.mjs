import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../src/modules/transport/transport-incidents.module.ts", import.meta.url),
  "utf8",
);
const schema = readFileSync(
  new URL("../prisma/v2_transport_incidents.prisma", import.meta.url),
  "utf8",
);
const migration = readFileSync(
  new URL("../prisma/migrations/20260922014500_v2_transport_incidents/migration.sql", import.meta.url),
  "utf8",
);
const appModule = readFileSync(
  new URL("../src/app.module.ts", import.meta.url),
  "utf8",
);
const mobileApi = readFileSync(
  new URL("../../../packages/mobile_core/lib/transport_api.dart", import.meta.url),
  "utf8",
);
const mobileFlow = readFileSync(
  new URL("../../../packages/mobile_core/lib/transport_incidents.dart", import.meta.url),
  "utf8",
);
const mobileWorkspace = readFileSync(
  new URL("../../../packages/mobile_core/lib/transport_workspace.dart", import.meta.url),
  "utf8",
);

// Provider authorization and active-job scope.
assert.match(source, /@Controller\("provider\/transport\/jobs"\)/);
assert.match(source, /@Post\(":id\/incidents"\)/);
assert.match(source, /@Get\(":id\/incidents"\)/);
assert.match(source, /RequirePermissions\("TRANSPORT_RESPOND"\)/);
assert.match(source, /assignedProviderId:\s*responder\.providerId/);
assert.match(source, /ACTIVE_STATUSES = new Set\(\["ASSIGNED", "EN_ROUTE", "ARRIVED", "TRANSPORTING"\]\)/);
assert.match(source, /MEDICAL_TRANSPORT_GROUND/);
assert.match(source, /MEDICAL_TRANSPORT_AIR/);

// Classification/reason are mandatory and server-controlled.
assert.match(source, /DELAY/);
assert.match(source, /VEHICLE_BREAKDOWN/);
assert.match(source, /PATIENT_CONDITION_CHANGE/);
assert.match(source, /REFUSAL/);
assert.match(source, /OPERATIONAL/);
assert.match(source, /INFO/);
assert.match(source, /WARNING/);
assert.match(source, /CRITICAL/);
assert.match(source, /reasonCode\(input\.reasonCode\)/);
assert.match(source, /SAFE_CODE/);
assert.match(source, /occurredAt/);

// Retry safety, exact crew/unit context and encrypted detail payload.
assert.match(source, /idempotencyKey/);
assert.match(source, /requestDigest/);
assert.match(source, /crewAssignment\.findFirst/);
assert.match(source, /orderBy:\s*\{ revision: "desc" \}/);
assert.match(source, /transportUnitId/);
assert.match(source, /crewProviderIds/);
assert.match(source, /encryptRecord\(payload\)/);
assert.match(source, /decryptRecord/);
assert.match(source, /TransactionIsolationLevel\.Serializable/);
assert.match(source, /FOR UPDATE/);

// Audit is structural only; critical incidents enqueue operational notifications.
assert.match(source, /MEDICAL_TRANSPORT_INCIDENT_RECORDED/);
assert.match(source, /MEDICAL_TRANSPORT_INCIDENT_TIMELINE_READ/);
assert.match(source, /detailIncluded:\s*detail !== null/);
assert.doesNotMatch(source, /metadata:[\s\S]{0,1000}?detail,/);
assert.match(source, /severity === "CRITICAL"/);
assert.match(source, /role:\s*\{ in:\s*\["ADMIN", "SUPPORT"\] \}/);
assert.match(source, /enqueueAccountInTransaction/);
assert.match(source, /type:\s*"TRANSPORT_UPDATE"/);
assert.match(source, /transport\.incident\.critical\.title/);
assert.match(source, /transport\.incident\.critical\.body/);
assert.match(source, /wakeOutbox\(\)/);

// Durable append-only evidence.
assert.match(schema, /model TransportIncident/);
assert.match(schema, /idempotencyKey\s+String\s+@unique/);
assert.match(schema, /requestDigest\s+String/);
assert.match(schema, /ciphertext\s+String/);
assert.match(schema, /reportedByAccountId\s+String/);
assert.match(migration, /TransportIncident_category_ck/);
assert.match(migration, /TransportIncident_severity_ck/);
assert.match(migration, /TransportIncident_immutable_trigger/);
assert.match(migration, /BEFORE UPDATE OR DELETE/);
assert.match(migration, /REVOKE UPDATE, DELETE ON "TransportIncident"/);
assert.match(migration, /CrewAssignment/);
assert.match(migration, /MedicalTransportRequest/);
assert.match(migration, /PatientProfile/);
assert.match(migration, /reportedByAccountId/);
assert.match(appModule, /TransportIncidentsModule/);

// Provider Mobile API, form, timeline and multilingual copy.
assert.match(mobileApi, /providerTransportIncidents/);
assert.match(mobileApi, /recordProviderTransportIncident/);
assert.match(mobileApi, /\/provider\/transport\/jobs\/\$requestId\/incidents/);
assert.match(mobileFlow, /showTransportIncidentsSheet/);
assert.match(mobileFlow, /recordProviderTransportIncident/);
assert.match(mobileFlow, /providerTransportIncidents/);
assert.match(mobileFlow, /VEHICLE_BREAKDOWN/);
assert.match(mobileFlow, /PATIENT_CONDITION_CHANGE/);
assert.match(mobileFlow, /severity == 'CRITICAL'/);
assert.match(mobileFlow, /criticalNotice/);
assert.match(mobileFlow, /CarePointLocale\.ar/);
assert.match(mobileFlow, /CarePointLocale\.fr/);
assert.match(mobileFlow, /CarePointLocale\.es/);
assert.match(mobileWorkspace, /transport_incidents\.dart/);
assert.match(mobileWorkspace, /showTransportIncidentsSheet/);
assert.match(mobileWorkspace, /'ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'TRANSPORTING'/);

console.log("V2 PRV-085 transport incidents and critical operational notification acceptance passed");
