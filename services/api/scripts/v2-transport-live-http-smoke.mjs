import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const readApi = (path) => readFile(new URL(path, root), "utf8");
const readRepo = (path) => readFile(new URL("../../" + path, root), "utf8");

const [live, pkgText, slice8, docs] = await Promise.all([
  readApi("scripts/v2-transport-live-http.mjs"),
  readApi("package.json"),
  readApi("scripts/slice8-smoke.mjs"),
  readRepo("docs/transport-advanced-live-http-acceptance.md"),
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
  '"Sensitive patient data leaked into management-report CSV."',
  "patientA.email",
]) {
  assert.ok(live.includes(text), "Advanced Transport live acceptance must include: " + text);
}

assert.equal(
  live.includes("GOOGLE_MAPS_SERVER_API_KEY"),
  false,
  "Advanced Transport live acceptance must not inject external route credentials",
);
assert.equal(
  live.includes("TRANSPORT_ROUTE_PROVIDER=google"),
  false,
  "Advanced Transport live acceptance must exercise route-preview fallback without external routing",
);
for (const forbidden of [
  'dotenv/config',
  'readFile(".env',
  "readFile('.env",
  'writeFile(".env',
  "writeFile('.env",
]) {
  assert.equal(
    live.includes(forbidden),
    false,
    "Advanced Transport live acceptance must not read or write .env files: " + forbidden,
  );
}

assert.equal(
  pkg.scripts["v2:transport-live-http-contract"],
  "node scripts/v2-transport-live-http-smoke.mjs",
);
assert.equal(
  pkg.scripts["v2:transport-live-http-acceptance"],
  "node scripts/v2-transport-live-http.mjs",
);
assert.ok(pkg.scripts.test.includes("npm run v2:transport-phase29"));
assert.ok(pkg.scripts.test.includes("npm run v2:transport-live-http-contract"));

assert.ok(
  slice8.includes('await import("./v2-transport-live-http.mjs");'),
  "Slice 8 live acceptance must chain Advanced Transport live HTTP acceptance",
);
const slice8MainIndex = slice8.indexOf("await main();");
const phase30ImportIndex = slice8.indexOf('await import("./v2-transport-live-http.mjs");');
assert.ok(
  phase30ImportIndex > slice8MainIndex,
  "Advanced Transport live acceptance must run after the original Slice 8 live journey",
);

for (const text of [
  "Advanced Transport Live HTTP Acceptance",
  "saved locations",
  "route-preview fallback",
  "telemetry",
  "smart dispatch",
  "one-time secure report download",
  "compliance manifest",
  "No new production environment variables",
  "No .env file",
]) {
  assert.ok(docs.includes(text), "Phase 30 docs must include: " + text);
}

console.log("Advanced Transport live HTTP acceptance contract passed");
