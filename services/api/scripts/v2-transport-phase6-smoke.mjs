import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const backend = readFileSync(
  new URL("../src/modules/transport/transport-dispatch.module.ts", import.meta.url),
  "utf8",
);
const routeService = readFileSync(
  new URL("../src/modules/transport/transport-saved-locations.module.ts", import.meta.url),
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
const adminBoard = readFileSync(
  new URL("../../../apps/admin/components/TransportDispatchBoard.tsx", import.meta.url),
  "utf8",
);
const adminProxy = readFileSync(
  new URL("../../../apps/admin/app/api/admin/transport/[...segments]/route.ts", import.meta.url),
  "utf8",
);
const mobileApi = readFileSync(
  new URL("../../../packages/mobile_core/lib/transport_api.dart", import.meta.url),
  "utf8",
);
const workspace = readFileSync(
  new URL("../../../packages/mobile_core/lib/transport_workspace.dart", import.meta.url),
  "utf8",
);
const localization = readFileSync(
  new URL("../../../packages/mobile_core/lib/transport_localization.dart", import.meta.url),
  "utf8",
);
const phase6Doc = readFileSync(
  new URL("../../../docs/transport-dispatch-eta-phase6.md", import.meta.url),
  "utf8",
);

// Phase 6 reuses Phase 5 routing instead of adding a second route engine.
assert.match(routeService, /export class TransportSavedLocationsService/);
assert.match(routeService, /exports:\s*\[TransportSavedLocationsService\]/);
assert.match(backend, /TransportSavedLocationsModule/);
assert.match(backend, /TransportSavedLocationsService/);
assert.match(backend, /routePreviewForRequest/);

// Dispatch board is operations-only and aggregates provider/resource/ETA state.
assert.match(backend, /@Controller\("admin\/transport"\)/);
assert.match(backend, /@RequirePermissions\("TRANSPORT_OPERATE"\)/);
assert.match(backend, /@Get\("dispatch-board"\)/);
assert.match(backend, /UNASSIGNED/);
assert.match(backend, /PROVIDER_ASSIGNED/);
assert.match(backend, /RESOURCES_PARTIAL/);
assert.match(backend, /RESOURCES_READY/);
assert.match(backend, /STALE_AFTER_DESTINATION_CHANGE/);
assert.match(backend, /missingCurrentCredentialTypes/);
assert.match(backend, /dispatchReady/);
assert.match(backend, /crewAssignment\.findMany/);
assert.match(backend, /transportRouteRevision\.findMany/);
assert.match(backend, /transportUnit\.findMany/);

// ETA recalculation is explicit, idempotent, concurrency-safe and audited.
assert.match(backend, /@Post\("dispatch-board\/:requestId\/recalculate-eta"\)/);
assert.match(backend, /@Post\(":requestId\/recalculate-eta"\)/);
assert.match(backend, /@RequirePermissions\("TRANSPORT_RESPOND"\)/);
assert.match(backend, /idempotencyKey/);
assert.match(backend, /FOR UPDATE/);
assert.match(backend, /changed while ETA was being calculated/);
assert.match(backend, /transportRouteRevision\.create/);
assert.match(backend, /etaMinutes/);
assert.match(backend, /MEDICAL_TRANSPORT_ETA_RECALCULATED/);
assert.match(backend, /notifyPatientEta/);
assert.match(backend, /PROVIDER_ROUTE_PROVIDER/);
assert.match(backend, /DISPATCH_UPDATE/);

// Automatic routing remains optional and AIR remains non-blocking.
assert.match(backend, /AIR_NOT_SUPPORTED/);
assert.match(backend, /persisted:\s*false/);
assert.match(phase6Doc, /route provider is optional/i);
assert.match(phase6Doc, /coordinates remain optional/i);
assert.match(phase6Doc, /No `\.env` file/i);

// Module registration and Admin UI are part of the same vertical slice.
assert.match(appModule, /TransportDispatchModule/);
assert.match(adminPage, /TransportDispatchBoard/);
assert.match(adminBoard, /Medical Transport Dispatch Board/);
assert.match(adminBoard, /\/api\/admin\/transport\/dispatch-board/);
assert.match(adminBoard, /\/dispatch\/medical\//);
assert.match(adminBoard, /Recalculate ETA/);
assert.match(adminBoard, /dispatchReady/);
assert.match(adminProxy, /operations\/medical-transport/);

// Transport Provider Mobile can explicitly refresh ETA after destination changes.
assert.match(mobileApi, /recalculateProviderMedicalTransportEta/);
assert.match(mobileApi, /provider\/medical-transport\/\$requestId\/recalculate-eta/);
assert.match(workspace, /transport-recalculate-eta-/);
assert.match(workspace, /_recalculateEta/);
assert.match(localization, /'recalculateEta'/);
assert.match(localization, /'etaRefreshed'/);
assert.match(localization, /'etaUnavailable'/);

console.log("V2 Transport Phase 6 dispatch + ETA lifecycle contract acceptance passed");
