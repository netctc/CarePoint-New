import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const readApi = (path) => readFile(new URL(path, root), "utf8");
const readRepo = (path) => readFile(new URL("../../" + path, root), "utf8");

const [live, pkgText, ci, docs] = await Promise.all([
  readApi("scripts/v2-transport-phase30-live-http.mjs"),
  readApi("package.json"),
  readRepo(".github/workflows/ci.yml"),
  readRepo("docs/transport-advanced-live-http-phase30.md"),
]);
const pkg = JSON.parse(pkgText);

for (const text of [
  'process.env.NODE_ENV === "production"',
  'routePreviewFallback',
  'resourceAssignmentId',
  'telemetryReplay',
  'smartDispatchNonMutating',
  'reportRunStatus',
  'deliveryStatus',
  'downloadOneTime',
  'artifactIntegrityStatus',
  'complianceManifestSha256',
  '"/transport/location/saved"',
  '"/transport/location/route-preview"',
  '"/tracking/heartbeat"',
  '"/admin/transport/smart-dispatch/evaluate"',
  '"/admin/transport/report-schedules"',
  '"/prepare-delivery-handoff"',
  '"/download-grant"',
  '"/compliance-manifest"',
  'replayDownload.status === 400',
  'artifactIntegrityStatus === "VERIFIED"',
  'manifest.exportPolicy?.[field] === false',
]) {
  assert.ok(live.includes(text), "Phase 30 live acceptance must include: " + text);
}

assert.equal(
  live.includes("GOOGLE_MAPS_SERVER_API_KEY"),
  false,
  "Phase 30 must not inject external route credentials",
);
assert.equal(
  live.includes("TRANSPORT_ROUTE_PROVIDER=google"),
  false,
  "Phase 30 must exercise route-preview fallback without external routing",
);
assert.equal(live.includes(".env"), false);

assert.equal(
  pkg.scripts["v2:transport-phase30"],
  "node scripts/v2-transport-phase30-smoke.mjs",
);
assert.equal(
  pkg.scripts["v2:transport-phase30-live-http"],
  "node scripts/v2-transport-phase30-live-http.mjs",
);
assert.ok(pkg.scripts.test.includes("npm run v2:transport-phase29"));
assert.ok(pkg.scripts.test.includes("npm run v2:transport-phase30"));

const f32Index = ci.indexOf("F3.2 headless Flutter journeys and independent PostgreSQL verification");
const p30Index = ci.indexOf("Transport Phase 30 advanced live HTTP acceptance");
const logsIndex = ci.indexOf("Print API and Admin logs on failure");
assert.ok(f32Index >= 0);
assert.ok(p30Index > f32Index, "Phase 30 live acceptance must run after existing live journeys");
assert.ok(logsIndex > p30Index, "Phase 30 live acceptance must run before final failure log collection");
assert.ok(ci.includes("npm --workspace @carepoint/api run v2:transport-phase30-live-http"));

for (const text of [
  "Advanced Transport Live HTTP Acceptance",
  "saved locations",
  "route-preview fallback",
  "telemetry",
  "smart dispatch",
  "one-time download",
  "compliance manifest",
  "No new production environment variables",
  "No .env file",
]) {
  assert.ok(docs.includes(text), "Phase 30 docs must include: " + text);
}

console.log("Transport Phase 30 advanced live HTTP acceptance contract passed");
