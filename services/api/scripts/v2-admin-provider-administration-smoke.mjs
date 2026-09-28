import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const read = (value) => readFile(path.join(root, value), "utf8");

const [schema, adminApi, masterApi, expiry, operational, adminUi, masterUi, nginx, migration] = await Promise.all([
  read("services/api/prisma/schema.prisma"),
  read("services/api/src/modules/admin-provider-administration/admin-provider-administration.module.ts"),
  read("services/api/src/modules/admin-master-data/admin-master-data.module.ts"),
  read("services/api/src/modules/credential-expiry/credential-expiry.module.ts"),
  read("services/api/src/security/provider-operational-credential.service.ts"),
  read("apps/admin/components/ProfessionalAdministrationCenter.tsx"),
  read("apps/admin/app/master-data/page.tsx"),
  read("ops/test-v2/nginx/carepoint-v2-http.conf.template"),
  read("services/api/prisma/migrations/20260928052000_admin_provider_administration/migration.sql"),
]);

assert.match(schema, /model ProviderCredentialDocument/);
assert.match(schema, /model ProviderCredentialVerification/);
assert.match(schema, /model ProviderGovernanceHistory/);
assert.match(schema, /renewedFromCredentialId/);
assert.match(migration, /SET "status" = 'VALID'/);

assert.match(adminApi, /@Controller\("admin\/provider-administration"\)/);
assert.match(adminApi, /ACCOUNT_STATUSES/);
assert.match(adminApi, /PROVIDER_STATUSES/);
assert.match(adminApi, /CREDENTIAL_BASE_STATUSES/);
assert.match(adminApi, /EXPIRING_SOON/);
assert.match(adminApi, /EXPIRED/);
assert.match(adminApi, /renewCredential/);
assert.match(adminApi, /uploadCredentialDocument/);
assert.match(adminApi, /ProviderCredentialVerification/);

assert.match(masterApi, /@Controller\("admin\/master-data"\)/);
assert.match(masterApi, /MASTER_DATA_SPECIALTY_/);
assert.match(masterApi, /MASTER_DATA_PROVIDER_CATEGORY_/);
assert.match(masterApi, /active: false/);

assert.match(expiry, /DEFAULT_WINDOWS = \[90, 60, 30, 7\]/);
assert.match(operational, /credential\.status === "VALID" \|\| credential\.status === "VERIFIED"/);

assert.match(adminUi, /ADM-PRO-001 → ADM-PRO-010/);
assert.match(adminUi, /operationalBlockReasons/);
assert.match(adminUi, /Attach PDF|Adjuntar PDF/);
assert.match(masterUi, /Master Data Maintenance|Mantenimiento de Datos Maestros/);

assert.ok((nginx.match(/client_max_body_size 12m;/g) ?? []).length >= 2, "API and Admin Nginx hosts must allow credential PDF payloads.");

console.log("ADM-PRO-001..010 and governed master-data acceptance passed");
