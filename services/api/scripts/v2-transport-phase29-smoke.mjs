import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const readApi = (path) => readFile(new URL(path, root), "utf8");
const readRepo = (path) => readFile(new URL("../../" + path, root), "utf8");

const [transport, postgresAcceptance, pkgText, ci, docs] = await Promise.all([
  readApi("src/modules/transport/transport.module.ts"),
  readApi("scripts/v2-transport-phase29-postgres.mjs"),
  readApi("package.json"),
  readRepo(".github/workflows/ci.yml"),
  readRepo("docs/transport-postgres-acceptance-phase29.md"),
]);
const pkg = JSON.parse(pkgText);

for (const text of [
  "export class MedicalTransportService",
  'this.prismaErrorCode(error) === "P2034"',
  "Medical transport was assigned concurrently to another provider.",
  "Medical transport job changed concurrently. Refresh and retry.",
]) {
  assert.ok(transport.includes(text), "transport concurrency contract must include: " + text);
}

for (const text of [
  'CAREPOINT_TRANSPORT_POSTGRES_ACCEPTANCE !== "true"',
  'process.env.NODE_ENV === "production"',
  "new MedicalTransportService(db, audit, notificationGateway)",
  "patient request is idempotent and patient-scoped",
  "concurrent dispatch commits exactly one provider assignment",
  "provider lifecycle rejects skips and preserves exact event order",
  "cancellation is persistence-idempotent and blocked after departure",
  "transport-family mismatch cannot assign a ground provider to AIR",
  "statusOf(row.reason), 409",
  '"REQUESTED"',
  '"ASSIGNED"',
  '"EN_ROUTE"',
  '"ARRIVED"',
  '"TRANSPORTING"',
  '"COMPLETED"',
]) {
  assert.ok(postgresAcceptance.includes(text), "PostgreSQL acceptance must include: " + text);
}

assert.equal(pkg.scripts["v2:transport-phase29"], "node scripts/v2-transport-phase29-smoke.mjs");
assert.equal(pkg.scripts["v2:transport-phase29-postgres"], "node --test scripts/v2-transport-phase29-postgres.mjs");
assert.ok(pkg.scripts.test.includes("npm run v2:transport-phase29"));

const deployIndex = ci.indexOf("- run: npm run db:deploy");
const postgresIndex = ci.indexOf("Transport Phase 29 PostgreSQL transactional acceptance");
const bootstrapIndex = ci.indexOf("- run: npm run db:bootstrap");
assert.ok(deployIndex >= 0);
assert.ok(postgresIndex > deployIndex, "Phase 29 PostgreSQL acceptance must run after db:deploy");
assert.ok(bootstrapIndex > postgresIndex, "Phase 29 fixture must run before shared bootstrap data");
for (const text of [
  'CAREPOINT_TRANSPORT_POSTGRES_ACCEPTANCE: "true"',
  "npm --workspace @carepoint/api run v2:transport-phase29-postgres",
]) {
  assert.ok(ci.includes(text), "CI Phase 29 wiring must include: " + text);
}

for (const text of [
  "PostgreSQL Transactional Transport Acceptance",
  "Serializable concurrency",
  "409 Conflict",
  "No new production environment variables",
  "No .env file",
]) {
  assert.ok(docs.includes(text), "Phase 29 docs must include: " + text);
}

assert.equal(postgresAcceptance.includes("deleteMany({ where: {}"), false);
assert.equal(postgresAcceptance.includes("DROP TABLE"), false);
assert.equal(postgresAcceptance.includes("TRUNCATE"), false);

console.log("Transport Phase 29 PostgreSQL acceptance contract passed");
