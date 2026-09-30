import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const moduleSource = readFileSync(
  new URL("../src/modules/transport/transport-command-center.module.ts", import.meta.url),
  "utf8",
);
const appModule = readFileSync(
  new URL("../src/app.module.ts", import.meta.url),
  "utf8",
);
const panel = readFileSync(
  new URL("../../../apps/admin/components/TransportCommandCenterPanel.tsx", import.meta.url),
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
  new URL("../../../docs/transport-command-center-phase12.md", import.meta.url),
  "utf8",
);

// Module registration and authorization.
assert.match(appModule, /TransportCommandCenterModule/);
assert.match(moduleSource, /@Controller\("admin\/transport"\)/);
assert.match(moduleSource, /@RequirePermissions\("TRANSPORT_OPERATE"\)/);
assert.match(moduleSource, /@Get\("command-center"\)/);
assert.match(moduleSource, /@Get\("management-report"\)/);

// Bounded filters and pagination.
assert.match(
  moduleSource,
  /this\.integer\(\s*query\.windowDays,\s*90,\s*7,\s*365/,
);
assert.match(
  moduleSource,
  /this\.integer\(query\.page, 1, 1, 1000, "page"\)/,
);
assert.match(
  moduleSource,
  /this\.integer\(query\.limit, 100, 25, 250, "limit"\)/,
);
assert.match(moduleSource, /\["ALL", "GROUND", "AIR"\]/);
assert.match(
  moduleSource,
  /\["ALL", "BREACHED", "COMPLIANT", "PENDING"\]/,
);
assert.match(moduleSource, /SOURCE_LIMIT = 5000/);
assert.match(moduleSource, /take: SOURCE_LIMIT \+ 1/);
assert.match(moduleSource, /truncatedSource = requests\.length > SOURCE_LIMIT/);

// No Phase 12 persistence or migration.
assert.equal(
  existsSync(
    new URL("../prisma/v2_transport_command_center.prisma", import.meta.url),
  ),
  false,
);
assert.equal(
  existsSync(
    new URL(
      "../prisma/migrations/20260930230000_v2_transport_command_center/migration.sql",
      import.meta.url,
    ),
  ),
  false,
);

// Command-center source explicitly excludes patient/location fields.
assert.match(moduleSource, /medicalTransportRequest\.findMany/);
assert.match(moduleSource, /assignedProviderId:\s*true/);
assert.match(moduleSource, /etaMinutes:\s*true/);
assert.doesNotMatch(moduleSource, /patientId:\s*true/);
assert.doesNotMatch(moduleSource, /callbackPhone:\s*true/);
assert.doesNotMatch(moduleSource, /pickupAddress:\s*true/);
assert.doesNotMatch(moduleSource, /destinationAddress:\s*true/);
assert.doesNotMatch(moduleSource, /pickupLatitude:\s*true/);
assert.doesNotMatch(moduleSource, /pickupLongitude:\s*true/);
assert.doesNotMatch(moduleSource, /destinationLatitude:\s*true/);
assert.doesNotMatch(moduleSource, /destinationLongitude:\s*true/);

// Explicit privacy policy.
assert.match(moduleSource, /patientIdentityIncluded:\s*false/);
assert.match(moduleSource, /patientContactIncluded:\s*false/);
assert.match(moduleSource, /pickupAddressIncluded:\s*false/);
assert.match(moduleSource, /destinationAddressIncluded:\s*false/);
assert.match(moduleSource, /coordinatesIncluded:\s*false/);

// SLA semantics.
assert.match(moduleSource, /private assignmentSla/);
assert.match(moduleSource, /private resourceReadinessSla/);
assert.match(moduleSource, /private departureSla/);
assert.match(moduleSource, /minutes <= threshold \? "COMPLIANT" : "BREACHED"/);
assert.match(moduleSource, /minutes > threshold \? "BREACHED" : "PENDING"/);
assert.match(moduleSource, /"NOT_APPLICABLE"/);
assert.match(moduleSource, /breachCount > 0[\s\S]*"BREACHED"/);
assert.match(moduleSource, /pendingCount > 0[\s\S]*"PENDING"/);
assert.match(moduleSource, /this\.matchesSla\(row\.sla\.overall, options\.sla\)/);

// Management report columns are operational only.
for (const column of [
  "requestId",
  "mode",
  "status",
  "providerId",
  "providerName",
  "requestedAt",
  "scheduledFor",
  "assignmentSlaState",
  "resourceReadinessSlaState",
  "departureSlaState",
  "etaEvidence",
  "warningIncidents",
  "criticalIncidents",
  "escalations",
  "openEscalations",
]) {
  assert.match(moduleSource, new RegExp('"' + column + '"'));
}
for (const forbidden of [
  "patientName",
  "patientPhone",
  "callbackPhone",
  "pickupAddress",
  "destinationAddress",
  "pickupLatitude",
  "pickupLongitude",
  "destinationLatitude",
  "destinationLongitude",
]) {
  assert.doesNotMatch(
    moduleSource.match(/const columns = \[[\s\S]*?\] as const;/)?.[0] ?? "",
    new RegExp(forbidden),
  );
}

// Read-only boundaries.
assert.doesNotMatch(moduleSource, /medicalTransportRequest\.update/);
assert.doesNotMatch(moduleSource, /medicalTransportRequest\.updateMany/);
assert.doesNotMatch(moduleSource, /transportOperationalEscalation\.(create|update|upsert)/);
assert.doesNotMatch(moduleSource, /crewAssignment\.(create|update|upsert)/);

// Audit.
assert.match(moduleSource, /ADMIN_TRANSPORT_COMMAND_CENTER_READ/);
assert.match(moduleSource, /ADMIN_TRANSPORT_MANAGEMENT_REPORT_EXPORTED/);
assert.match(moduleSource, /format:\s*"CSV_CLIENT_RENDERED"/);

// Admin proxy forwards only allow-listed Phase 11/12 query keys.
assert.match(proxy, /transportQueryPath\(request, path\)/);
assert.match(proxy, /"\/admin\/transport\/command-center"/);
assert.match(proxy, /"\/admin\/transport\/management-report"/);
assert.match(proxy, /\["windowDays", "page", "limit"\]/);
assert.match(proxy, /\["ALL", "GROUND", "AIR"\]/);
assert.match(proxy, /\["ALL", "BREACHED", "COMPLIANT", "PENDING"\]/);
assert.match(proxy, /if \(!SAFE\.test\(providerId\)\) return null/);

// Admin command center and CSV hardening.
assert.match(adminPage, /TransportCommandCenterPanel/);
assert.match(panel, /PHASE 12 · OPERATIONS COMMAND CENTER/);
assert.match(panel, /\/api\/admin\/transport\/command-center\?/);
assert.match(panel, /\/api\/admin\/transport\/management-report\?/);
assert.match(panel, /Export management CSV/);
assert.match(panel, /new Blob/);
assert.match(panel, /text\/csv;charset=utf-8/);
assert.match(panel, /\^\[=\+\\-@\]/);
assert.match(panel, /text\.replace\(\/"\/g, '""'\)/);
assert.match(panel, /patient identity, contact details/i);
assert.match(panel, /Source capped at 5,000 requests/);

// Documentation boundaries.
assert.match(docs, /read-only/i);
assert.match(docs, /does \*\*not\*\*:/);
assert.match(docs, /patient name, phone, addresses or coordinates/i);
assert.match(docs, /formula-injection risk/i);
assert.match(docs, /adds:[\s\S]*no Prisma model[\s\S]*no migration/i);
assert.match(docs, /No `\.env` file is added or modified/i);

console.log(
  "V2 Transport Phase 12 command center + management reporting contract acceptance passed",
);
