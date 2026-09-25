import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const prisma = readFileSync(new URL("../prisma/v2_terminology.prisma", import.meta.url), "utf8");
const migration = readFileSync(
  new URL("../prisma/migrations/20260922074000_v2_terminology/migration.sql", import.meta.url),
  "utf8",
);
const service = readFileSync(
  new URL("../src/modules/terminology/terminology.service.ts", import.meta.url),
  "utf8",
);
const moduleSource = readFileSync(
  new URL("../src/modules/terminology/terminology.module.ts", import.meta.url),
  "utf8",
);
const appModule = readFileSync(new URL("../src/app.module.ts", import.meta.url), "utf8");

// Canonical BE-039 stores stable system+code identity separately from versioned display text.
assert.match(prisma, /model CodingSystem\s*\{/);
assert.match(prisma, /model TerminologyConcept\s*\{/);
assert.match(prisma, /model TerminologyConceptVersion\s*\{/);
assert.match(prisma, /model ExternalCatalogMapping\s*\{/);
assert.match(prisma, /@@unique\(\[system, code\]\)/);
assert.match(prisma, /currentVersion\s+Int\s+@default\(1\)/);
assert.match(prisma, /display\s+String/);
assert.match(prisma, /@@unique\(\[conceptId, version\]\)/);

// Historical concept displays and mappings are immutable; publishing creates another version.
assert.match(migration, /TerminologyConceptVersion_append_only/);
assert.match(migration, /ExternalCatalogMapping_append_only/);
assert.match(migration, /REVOKE UPDATE, DELETE ON "TerminologyConceptVersion" FROM PUBLIC/);
assert.match(migration, /REVOKE UPDATE, DELETE ON "ExternalCatalogMapping" FROM PUBLIC/);
assert.match(service, /const version = current\.currentVersion \+ 1/);
assert.match(service, /terminologyConceptVersion\.create/);
assert.match(service, /data: \{ currentVersion: version, status \}/);
assert.doesNotMatch(service, /terminologyConceptVersion\.update/);
assert.doesNotMatch(service, /terminologyConceptVersion\.delete/);

// Search resolves exactly the anchor's current immutable version and keeps stable system+code.
assert.match(service, /v\.version = c\."currentVersion"/);
assert.match(service, /system: row\.system/);
assert.match(service, /code: row\.code/);
assert.match(service, /display: row\.display/);
assert.match(service, /contentVersion: row\.currentVersion/);
assert.match(service, /LIMIT \$\{limit\}/);

// Mapping lookup is local and versioned; no external vendor call is embedded in the domain.
assert.match(service, /externalCatalogMapping\.findFirst/);
assert.match(service, /orderBy: \{ version: "desc" \}/);
assert.match(service, /mappingVersion: mapping\.version/);
assert.doesNotMatch(service, /fetch\(/);
assert.doesNotMatch(service, /axios/);

// Concurrent publication is explicit and audit evidence remains atomic with serializable writes.
assert.match(service, /expectedVersion/);
assert.match(service, /FOR UPDATE/);
assert.match(service, /TransactionIsolationLevel\.Serializable/);
assert.match(service, /reserveIntegrityChainForSerializableTransaction/);
assert.match(service, /TERMINOLOGY_CONCEPT_VERSION_PUBLISHED/);
assert.match(service, /TERMINOLOGY_MAPPING_PUBLISHED/);

// Read APIs and governed Admin catalog APIs are separately exposed.
assert.match(moduleSource, /@Controller\("terminology"\)/);
assert.match(moduleSource, /@Get\("search"\)/);
assert.match(moduleSource, /@Get\("map"\)/);
assert.match(moduleSource, /@Controller\("admin\/terminology"\)/);
assert.match(moduleSource, /RequirePermissions\("CATALOG_MANAGE"\)/);
assert.match(moduleSource, /@Post\("concepts"\)/);
assert.match(moduleSource, /@Post\("concepts\/:conceptId\/versions"\)/);
assert.match(moduleSource, /@Post\("mappings"\)/);
assert.match(appModule, /TerminologyModule/);

console.log("BE-039 versioned terminology abstraction acceptance passed");
await import("./v2-admin-medication-catalog-status-smoke.mjs");
await import("./v2-localization-smoke.mjs");
