import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const prisma = readFileSync(new URL("../prisma/v2_localization.prisma", import.meta.url), "utf8");
const migration = readFileSync(new URL("../prisma/migrations/20260922121000_v2_localization/migration.sql", import.meta.url), "utf8");
const service = readFileSync(new URL("../src/modules/localization/localization.service.ts", import.meta.url), "utf8");
const moduleSource = readFileSync(new URL("../src/modules/localization/localization.module.ts", import.meta.url), "utf8");
const appModule = readFileSync(new URL("../src/app.module.ts", import.meta.url), "utf8");

for (const model of ["LocalizationCatalog", "TranslationKey", "TranslationVersion"]) {
  assert.match(prisma, new RegExp(`model ${model}\\b`), `Missing ${model} model`);
}
assert.match(prisma, /currentVersion\s+Int\s+@default\(1\)/, "Version anchors must expose currentVersion");
assert.match(prisma, /textEn\s+String/, "English fallback text must be required");
for (const field of ["textAr", "textFr", "textEs"]) {
  assert.match(prisma, new RegExp(`${field}\\s+String\\?`), `Missing optional ${field} translation`);
}
assert.match(prisma, /@@unique\(\[translationKeyId, version\]\)/, "Translation history must be versioned per key");
assert.match(migration, /TranslationVersion_immutable/, "Translation history must be immutable in PostgreSQL");
assert.match(migration, /REVOKE UPDATE, DELETE ON "TranslationVersion" FROM PUBLIC/, "Historical translation mutation privileges must be revoked");
assert.match(migration, /'GLOBAL'/, "Global catalog revision anchor must be seeded");

for (const locale of ["en", "ar", "fr", "es"]) {
  assert.match(service, new RegExp(`"${locale}"`), `Supported locale ${locale} missing`);
}
assert.match(service, /split\(\/\[-_\]\//, "Regional locales must normalize to their supported base language");
assert.match(service, /locale === "ar" \? "rtl" : "ltr"/, "Arabic bundles must declare RTL direction");
assert.match(service, /fallbackLocale: "en"/, "English fallback metadata missing");
assert.match(service, /value: key, sourceLocale: "key"/, "Unknown translation keys must fall back to the key itself");
assert.match(service, /return \{ value: version\.textEn, sourceLocale: "en"/, "Missing locale text must fall back to English");
assert.match(service, /MAX_BUNDLE_KEYS\s*=\s*500/, "Localization bundle size must remain bounded");
assert.match(service, /catalogVersion: catalog\.currentVersion/, "Clients must receive a monotonic catalog revision");
assert.match(moduleSource, /contentVersion:\s*item\.translationVersion/, "Runtime bundle must expose canonical contentVersion for signed/dynamic forms");

assert.match(service, /expectedVersion/, "Translation publication must use optimistic concurrency");
assert.match(service, /Translation version conflict/, "Stale translation publication must fail explicitly");
assert.match(service, /TransactionIsolationLevel\.Serializable/, "Translation publication must use SERIALIZABLE isolation");
assert.match(service, /FOR UPDATE/, "Translation/catalog anchors must be locked during publication");
assert.match(service, /currentVersion: nextCatalogVersion/, "Publishing must advance the global catalog version");
assert.match(service, /TRANSLATION_KEY_CREATED/, "Translation key creation must be audited");
assert.match(service, /TRANSLATION_VERSION_PUBLISHED/, "Translation publication must be audited");
assert.doesNotMatch(service, /translationVersion\.(update|delete)/, "Historical translation rows must never be mutated in the service");

assert.match(moduleSource, /@Controller\("localization"\)/, "Runtime localization API missing");
assert.match(moduleSource, /@Public\(\)/, "Runtime translation bundle must be available before sign-in");
assert.match(moduleSource, /Cache-Control["'],\s*["']public, max-age=60, stale-while-revalidate=300/, "Localization bundle needs bounded client caching");
assert.match(moduleSource, /@Controller\("admin\/localization"\)/, "Admin localization catalog API missing");
assert.match(moduleSource, /@RequirePermissions\("CATALOG_MANAGE"\)/, "Localization governance must require catalog permission");
assert.match(moduleSource, /@Post\("keys"\)/, "Translation-key creation endpoint missing");
assert.match(moduleSource, /@Post\("keys\/:translationKeyId\/versions"\)/, "Translation-version publication endpoint missing");
assert.match(appModule, /import \{ LocalizationModule \}/, "LocalizationModule import missing");
assert.match(appModule, /\bLocalizationModule,/, "LocalizationModule must be registered in AppModule");

console.log("V2 BE-056 dynamic localization acceptance passed");
