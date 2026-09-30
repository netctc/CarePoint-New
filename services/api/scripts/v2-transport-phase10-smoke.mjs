import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const moduleSource = readFileSync(
  new URL("../src/modules/transport/transport-smart-dispatch.module.ts", import.meta.url),
  "utf8",
);
const appModule = readFileSync(
  new URL("../src/app.module.ts", import.meta.url),
  "utf8",
);
const schema = readFileSync(
  new URL("../prisma/v2_transport_smart_dispatch.prisma", import.meta.url),
  "utf8",
);
const migration = readFileSync(
  new URL("../prisma/migrations/20260930204500_v2_transport_smart_dispatch/migration.sql", import.meta.url),
  "utf8",
);
const panel = readFileSync(
  new URL("../../../apps/admin/components/TransportSmartDispatchPanel.tsx", import.meta.url),
  "utf8",
);
const adminPage = readFileSync(
  new URL("../../../apps/admin/app/transport-providers/page.tsx", import.meta.url),
  "utf8",
);
const proxy = readFileSync(
  new URL("../../../apps/admin/app/api/admin/transport/[...segments]/route.ts", import.meta.url),
  "utf8",
);
const docs = readFileSync(
  new URL("../../../docs/transport-smart-dispatch-phase10.md", import.meta.url),
  "utf8",
);

// Persistence is escalation-only and does not duplicate telemetry coordinates.
assert.match(schema, /model TransportOperationalEscalation/);
assert.match(schema, /@@unique\(\[transportRequestId, code\]\)/);
assert.match(schema, /status\s+String\s+@default\("OPEN"\)/);
assert.match(schema, /occurrenceCount\s+Int\s+@default\(1\)/);
assert.match(schema, /acknowledgedByAccountId/);
assert.match(schema, /resolvedByAccountId/);
assert.match(schema, /autoResolved\s+Boolean/);
assert.doesNotMatch(schema, /latitude/i);
assert.doesNotMatch(schema, /longitude/i);
assert.match(migration, /CREATE TABLE "TransportOperationalEscalation"/);
assert.match(
  migration,
  /TransportOperationalEscalation_transportRequestId_code_key/,
);

// Module registration and authorization.
assert.match(appModule, /TransportSmartDispatchModule/);
assert.match(moduleSource, /@Controller\("admin\/transport\/smart-dispatch"\)/);
assert.match(moduleSource, /@RequirePermissions\("TRANSPORT_OPERATE"\)/);
assert.match(moduleSource, /@Post\("evaluate"\)/);
assert.match(moduleSource, /@Post\(":requestId\/escalations\/:code\/acknowledge"\)/);
assert.match(moduleSource, /@Post\(":requestId\/escalations\/:code\/resolve"\)/);

// Core deterministic signal families from Phase 6-9.
for (const code of [
  "ASSIGNMENT_OVERDUE",
  "RESOURCE_NOT_READY",
  "ETA_ATTENTION",
  "ETA_STALE_AFTER_DESTINATION_CHANGE",
  "DEPARTURE_OVERDUE",
  "PROVIDER_READINESS_RISK",
  "CRITICAL_INCIDENT_REVIEW",
  "WARNING_INCIDENT_REVIEW",
  "TELEMETRY_HEARTBEAT_MISSING",
  "TELEMETRY_STALE",
  "PICKUP_CONFIRMATION_PENDING",
  "DESTINATION_CONFIRMATION_PENDING",
]) {
  assert.match(moduleSource, new RegExp(code));
}

// Escalations are persistent, idempotent by request+code and can reopen/auto-resolve.
assert.match(moduleSource, /transportOperationalEscalation\.upsert/);
assert.match(moduleSource, /occurrenceCount:\s*\{ increment: 1 \}/);
assert.match(moduleSource, /prior\?\.status === "RESOLVED" \? "OPEN"/);
assert.match(moduleSource, /autoResolved:\s*true/);
assert.match(moduleSource, /status:\s*"ACKNOWLEDGED"/);
assert.match(moduleSource, /status:\s*"RESOLVED"/);
assert.match(moduleSource, /note\.length > 500/);

// Human agency boundaries.
assert.match(moduleSource, /autoAssignmentPerformed:\s*false/);
assert.match(moduleSource, /automaticLifecycleMutation:\s*false/);
assert.match(moduleSource, /providerRecommendationUsesLiveLocation:\s*false/);
assert.doesNotMatch(moduleSource, /medicalTransportRequest\.update/);
assert.doesNotMatch(moduleSource, /medicalTransportRequest\.updateMany/);
assert.doesNotMatch(moduleSource, /assignedProviderId:\s*candidate/);
assert.doesNotMatch(moduleSource, /latitude.*candidate/i);
assert.doesNotMatch(moduleSource, /longitude.*candidate/i);

// Provider recommendation is dispatch-readiness/load/capacity based.
assert.match(moduleSource, /MODE_MATCH/);
assert.match(moduleSource, /DISPATCH_READY/);
assert.match(moduleSource, /ACTIVE_UNIT_CAPACITY/);
assert.match(moduleSource, /CURRENT_ACTIVE_JOB_LOAD/);
assert.match(moduleSource, /candidate\.mode === request\.mode/);
assert.match(moduleSource, /candidate\.dispatchReady/);
assert.match(moduleSource, /candidate\.activeJobs \* 15/);
assert.match(moduleSource, /candidate\.activeUnitCount/);

// Telemetry signals apply only when an explicit active sharing session exists.
assert.match(moduleSource, /session\.sharingStatus === "ACTIVE"/);
assert.match(moduleSource, /session\.shareWithPatient === true/);
assert.match(moduleSource, /session\.expiresAt\.getTime\(\) > now\.getTime\(\)/);

// Phase 9 milestone detections are advisory only.
assert.match(moduleSource, /PICKUP_ARRIVAL_DETECTED/);
assert.match(moduleSource, /DESTINATION_ARRIVAL_DETECTED/);
assert.match(moduleSource, /request\.status === "EN_ROUTE"/);
assert.match(moduleSource, /request\.status === "TRANSPORTING"/);

// Environment values are bounded and critical thresholds are monotonic.
for (const variable of [
  "TRANSPORT_SMART_DISPATCH_EVALUATION_SECONDS",
  "TRANSPORT_SMART_TELEMETRY_STALE_SECONDS",
  "TRANSPORT_SMART_TELEMETRY_CRITICAL_SECONDS",
  "TRANSPORT_SMART_MILESTONE_CONFIRMATION_MINUTES",
  "TRANSPORT_SMART_MILESTONE_CRITICAL_MINUTES",
]) {
  assert.match(moduleSource, new RegExp(variable));
}
assert.match(moduleSource, /Math\.max\(\s*telemetryStaleSeconds/);
assert.match(moduleSource, /Math\.max\(\s*milestoneConfirmationMinutes/);

// Audit evidence.
assert.match(moduleSource, /ADMIN_TRANSPORT_SMART_DISPATCH_READ/);
assert.match(moduleSource, /ADMIN_TRANSPORT_SMART_DISPATCH_EVALUATED/);
assert.match(moduleSource, /ADMIN_TRANSPORT_ESCALATION_ACKNOWLEDGED/);
assert.match(moduleSource, /ADMIN_TRANSPORT_ESCALATION_RESOLVED/);

// Admin panel automation and explicit human assignment.
assert.match(adminPage, /TransportSmartDispatchPanel/);
assert.match(panel, /PHASE 10 · SMART DISPATCH & ESCALATION/);
assert.match(panel, /\/api\/admin\/transport\/smart-dispatch\/evaluate/);
assert.match(panel, /setTimeout\(\(\) => void tick\(\), seconds \* 1000\)/);
assert.match(panel, /Assign recommended provider/);
assert.match(panel, /\/api\/admin\/transport\/dispatch\/medical\//);
assert.match(panel, /providerId:\s*recommendation\.providerId/);
assert.match(panel, /Acknowledge/);
assert.match(panel, /Resolve/);
assert.match(panel, /never auto-assign a\s+provider/i);
assert.match(panel, /never mutate transport lifecycle status/i);

// Existing generic Admin proxy supports the Phase 10 route depth.
assert.match(proxy, /segments\.length > 6/);
assert.match(proxy, /return "\/admin\/transport\/" \+ segments/);

// Documentation preserves no-env and no-autonomous-action boundaries.
assert.match(docs, /does \*\*not\*\*:/);
assert.match(docs, /auto-assign a provider/);
assert.match(docs, /mutate `MedicalTransportRequest\.status`/);
assert.match(docs, /providerRecommendationUsesLiveLocation: false/);
assert.match(docs, /No `\.env` file is added or modified/i);
assert.match(docs, /console-driven automation/i);

console.log(
  "V2 Transport Phase 10 smart dispatch + operational escalation contract acceptance passed",
);
