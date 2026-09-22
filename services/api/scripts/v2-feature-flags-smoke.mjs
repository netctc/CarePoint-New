import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const service = readFileSync(new URL("../src/modules/feature-flags/feature-flag.service.ts", import.meta.url), "utf8");
const featureModule = readFileSync(new URL("../src/modules/feature-flags/feature-flags.module.ts", import.meta.url), "utf8");
const realtimeModule = readFileSync(new URL("../src/modules/realtime/realtime.module.ts", import.meta.url), "utf8");
const appModule = readFileSync(new URL("../src/app.module.ts", import.meta.url), "utf8");
const prisma = readFileSync(new URL("../prisma/v2_feature_flags.prisma", import.meta.url), "utf8");
const migration = readFileSync(new URL("../prisma/migrations/20260922114500_v2_feature_flags/migration.sql", import.meta.url), "utf8");
const pilotPolicy = readFileSync(new URL("../src/infrastructure/release/private-pilot-policy.ts", import.meta.url), "utf8");

for (const model of ["FeatureFlag", "FeatureFlagVersion", "FeatureAssignment"]) {
  assert.match(prisma, new RegExp(`model ${model}\\b`), `Missing ${model} model`);
}
assert.match(prisma, /currentVersion\s+Int/, "Feature flag anchor must track current version");
assert.match(prisma, /@@unique\(\[featureFlagId, version\]\)/, "Feature versions must be unique per flag/version");
assert.match(prisma, /selectorKey\s+String/, "Assignments must retain a deterministic selector key");
assert.match(prisma, /environment\s+String\?/, "Environment selector missing");
assert.match(prisma, /jurisdiction\s+String\?/, "Jurisdiction selector missing");
assert.match(prisma, /role\s+String\?/, "Role selector missing");
assert.match(prisma, /providerCategoryId\s+String\?/, "Provider-category selector missing");

assert.match(migration, /FeatureFlagVersion_immutable/, "Feature versions must be immutable in PostgreSQL");
assert.match(migration, /FeatureAssignment_immutable/, "Feature assignments must be immutable in PostgreSQL");
assert.match(migration, /REVOKE UPDATE, DELETE ON "FeatureFlagVersion" FROM PUBLIC/, "Feature version mutation privileges must be revoked");
assert.match(migration, /REVOKE UPDATE, DELETE ON "FeatureAssignment" FROM PUBLIC/, "Assignment mutation privileges must be revoked");
assert.match(migration, /'V2_REALTIME'/, "Realtime feature must be seeded into governed feature policy");
assert.match(migration, /"defaultEnabled"[^;]+true/s, "Realtime rollout must preserve existing enabled behavior on migration");

assert.match(service, /TransactionIsolationLevel\.Serializable/, "Feature publication must use SERIALIZABLE isolation");
assert.match(service, /FOR UPDATE/, "Feature publication must lock the anchor row");
assert.match(service, /expectedVersion/, "Feature publication must require optimistic concurrency");
assert.match(service, /Feature flag version conflict/, "Stale feature publication must fail explicitly");
assert.match(service, /MISSING_OR_INACTIVE/, "Missing or inactive feature policy must fail closed");
assert.match(service, /VERSION_MISSING/, "Missing current policy version must fail closed");
assert.match(service, /throw new ForbiddenException/, "Disabled features must be rejected by the server");
assert.match(service, /CAREPOINT_ENVIRONMENT \?\? process\.env\.NODE_ENV/, "Environment must come from server runtime, not request input");
assert.match(service, /CAREPOINT_JURISDICTION/, "Jurisdiction must come from server runtime");
assert.match(service, /role: principal\.role/, "Role selector must come from the authenticated principal");
assert.match(service, /otherProviderProfile: \{ select: \{ categoryId: true \} \}/, "Provider category must be resolved from persisted provider data");
assert.doesNotMatch(service, /headers?\.|query\.|body\.environment|body\.jurisdiction|body\.role/, "Feature evaluation must not trust client-supplied rollout context");
assert.match(service, /specificity:/, "Feature assignment resolution must rank selector specificity");
assert.match(service, /b\.specificity - a\.specificity/, "More specific feature assignments must win deterministically");
assert.match(service, /b\.rule\.priority - a\.rule\.priority/, "Assignment priority must break equal-specificity ties");
assert.match(service, /selectorKey\.localeCompare/, "Selector key must provide deterministic final tie breaking");
assert.match(service, /FEATURE_FLAG_CREATED/, "Feature creation must be audited");
assert.match(service, /FEATURE_FLAG_VERSION_PUBLISHED/, "Feature publication must be audited");

assert.match(featureModule, /APP_INTERCEPTOR/, "Feature enforcement must run as a global Nest interceptor");
assert.match(featureModule, /RequireFeature/, "Server feature requirement decorator missing");
assert.match(featureModule, /this\.features\.assertEnabled\(request\.principal, featureKey\)/, "Feature interceptor must enforce policy using authenticated principal");
assert.match(featureModule, /@Controller\("admin\/feature-flags"\)/, "Admin feature-governance API missing");
assert.match(featureModule, /@RequirePermissions\("DATA_GOVERNANCE_MANAGE"\)/, "Feature governance must require data-governance privilege");
assert.match(featureModule, /@Post\(":featureFlagId\/versions"\)/, "Version publication endpoint missing");

assert.match(realtimeModule, /@RequireFeature\("V2_REALTIME"\)/, "Realtime controller must demonstrate server-side feature enforcement");
assert.match(appModule, /import \{ FeatureFlagsModule \}/, "FeatureFlagsModule import missing");
assert.match(appModule, /\bFeatureFlagsModule,/, "FeatureFlagsModule must be registered in AppModule");

assert.match(pilotPolicy, /carePointRuntimeFeatures/, "Existing startup/private-pilot feature policy must remain intact");
assert.doesNotMatch(featureModule + service, /dotenv|\.env\b|api[-_]?key|secret/i, "BE-055 runtime governance must not introduce secrets or .env artifacts");

console.log("V2 BE-055 server-side feature flag enforcement acceptance passed");
