import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const backend = readFileSync(
  new URL("../src/modules/transport/transport-live-operations.module.ts", import.meta.url),
  "utf8",
);
const appModule = readFileSync(
  new URL("../src/app.module.ts", import.meta.url),
  "utf8",
);
const adminPage = readFileSync(
  new URL("../../../apps/admin/app/transport-providers/page.tsx", import.meta.url),
  "utf8",
);
const adminPanel = readFileSync(
  new URL("../../../apps/admin/components/TransportLiveOperationsPanel.tsx", import.meta.url),
  "utf8",
);
const adminProxy = readFileSync(
  new URL("../../../apps/admin/app/api/admin/transport/[...segments]/route.ts", import.meta.url),
  "utf8",
);
const incidents = readFileSync(
  new URL("../src/modules/transport/transport-incidents.module.ts", import.meta.url),
  "utf8",
);
const phase7Doc = readFileSync(
  new URL("../../../docs/transport-live-operations-phase7.md", import.meta.url),
  "utf8",
);

// Phase 7 is an additive live-operations module.
assert.match(appModule, /TransportLiveOperationsModule/);
assert.match(backend, /@Controller\("admin\/transport\/live-operations"\)/);
assert.match(backend, /@RequirePermissions\("TRANSPORT_OPERATE"\)/);
assert.match(backend, /@Get\(\)/);
assert.match(backend, /@Post\(":requestId\/notify-provider"\)/);

// SLA exceptions are derived from authoritative current state.
assert.match(backend, /ASSIGNMENT_SLA_BREACH/);
assert.match(backend, /RESOURCE_READY_SLA_BREACH/);
assert.match(backend, /ETA_STALE_AFTER_DESTINATION_CHANGE/);
assert.match(backend, /ETA_REFRESH_SLA_BREACH/);
assert.match(backend, /DEPARTURE_SLA_BREACH/);
assert.match(backend, /ASSIGNED_PROVIDER_NOT_READY/);
assert.match(backend, /CRITICAL_TRANSPORT_INCIDENT/);
assert.match(backend, /WARNING_TRANSPORT_INCIDENT/);
assert.match(backend, /crewAssignment\.findMany/);
assert.match(backend, /transportRouteRevision\.findMany/);
assert.match(backend, /transportIncident\.findMany/);
assert.match(backend, /missingCurrentCredentialTypes/);

// SLA configuration is optional and bounded.
assert.match(backend, /TRANSPORT_ASSIGNMENT_SLA_MINUTES/);
assert.match(backend, /TRANSPORT_RESOURCE_READY_SLA_MINUTES/);
assert.match(backend, /TRANSPORT_ETA_REFRESH_SLA_MINUTES/);
assert.match(backend, /TRANSPORT_DEPARTURE_GRACE_MINUTES/);
assert.match(backend, /value < 1 \|\| value > 1440/);

// Phase 7 explicitly does not imply GPS tracking.
assert.match(backend, /trackingMode:\s*"ESTIMATED_ROUTE_ONLY"/);
assert.match(backend, /liveGpsTrackingAvailable:\s*false/);
assert.match(adminPanel, /does not claim real-time GPS tracking/);
assert.match(phase7Doc, /does not implement live GPS tracking/i);

// Provider attention uses the existing notification channel and an audit event.
assert.match(backend, /notifications\.notifyAccount/);
assert.match(backend, /dedupeWindowMinutes:\s*15/);
assert.match(backend, /ADMIN_TRANSPORT_PROVIDER_ATTENTION_SENT/);
assert.match(incidents, /severity === "CRITICAL"/);
assert.match(incidents, /transport-incident:/);

// Admin UI exposes consolidated exception handling.
assert.match(adminPage, /TransportLiveOperationsPanel/);
assert.match(adminPanel, /Transport Exception Control/);
assert.match(adminPanel, /\/api\/admin\/transport\/live-operations/);
assert.match(adminPanel, /Notify provider/);
assert.match(adminPanel, /Assignment SLA/);
assert.match(adminProxy, /return "\/admin\/transport\/" \+ segments/);

// Phase 7 requires no schema migration and commits no environment file.
assert.match(phase7Doc, /No Phase 7 database migration/i);
assert.match(phase7Doc, /No `\.env` file/i);
assert.match(phase7Doc, /coordinates remain optional/i);

console.log("V2 Transport Phase 7 live operations + exception management contract acceptance passed");
