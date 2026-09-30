import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const service = readFileSync(
  new URL("../src/modules/provider-offline-sync/provider-offline-sync.service.ts", import.meta.url),
  "utf8",
);
assert.match(service, /enabledModalities\.has\("HOME_VISIT"\)/, "PRV-075 must be limited to HOME_VISIT-capable providers");
assert.match(service, /modality:\s*"HOME_VISIT"/);
assert.match(service, /status:\s*\{\s*in:\s*\["CONFIRMED",\s*"COMPLETED"\]/);
assert.match(service, /ClinicalEnvelopeService/, "offline server snapshots must use the clinical envelope");
assert.match(service, /baseServerVersion/, "offline sync must carry an optimistic concurrency baseline");
assert.match(service, /FOR UPDATE/, "offline sync must lock mutable server anchors during reconciliation");
assert.match(service, /offlineFieldSyncConflict\.create/, "version divergence must persist a durable conflict");
assert.match(service, /serverVersionAtConflict/);
assert.match(service, /SERVER_ADVANCED_AFTER_CONFLICT/, "stale conflict resolution must not overwrite a newer server draft");
assert.match(service, /KEEP_SERVER/);
assert.match(service, /USE_CLIENT/);
assert.match(service, /idempotencyKey/, "mobile retries must be idempotent");
assert.doesNotMatch(service, /data:\s*\{[^}]*notes\s*:/s, "clinical notes must not be written to plaintext persistence metadata");

const moduleSource = readFileSync(
  new URL("../src/modules/provider-offline-sync/provider-offline-sync.module.ts", import.meta.url),
  "utf8",
);
assert.match(moduleSource, /@Controller\("provider\/offline-sync"\)/);
assert.match(moduleSource, /@Get\("conflicts"\)/);
assert.match(moduleSource, /@Get\("conflicts\/:conflictId"\)/);
assert.match(moduleSource, /@Post\("conflicts\/:conflictId\/resolve"\)/);
assert.match(moduleSource, /OTHER_PROVIDER_WORKFLOW_EXECUTE/);
assert.match(moduleSource, /new ConflictException\(result\)/, "sync divergence must surface as HTTP 409 after persisting the conflict");

const schema = readFileSync(
  new URL("../prisma/v2_offline_field_drafts.prisma", import.meta.url),
  "utf8",
);
assert.match(schema, /model OfflineFieldDraft/);
assert.match(schema, /model OfflineFieldDraftRevision/);
assert.match(schema, /model OfflineFieldSyncConflict/);
assert.match(schema, /currentVersion\s+Int/);
assert.match(schema, /clientRevision\s+Int/);
assert.match(schema, /algorithm\s+String[\s\S]*?keyId\s+String[\s\S]*?wrappedKey\s+String[\s\S]*?iv\s+String[\s\S]*?ciphertext\s+String/);
assert.match(schema, /@@unique\(\[draftId, version\]\)/);

const migration = readFileSync(
  new URL("../prisma/migrations/20260922030000_v2_offline_field_drafts/migration.sql", import.meta.url),
  "utf8",
);
assert.match(migration, /OfflineFieldDraftRevision_append_only_trg/);
assert.match(migration, /OfflineFieldSyncConflict_immutable_payload_trg/);
assert.match(migration, /OfflineFieldDraft_no_delete_trg/);
assert.match(migration, /REVOKE UPDATE, DELETE ON "OfflineFieldDraftRevision"/);
assert.match(migration, /KEEP_SERVER/);
assert.match(migration, /USE_CLIENT/);

const api = readFileSync(
  new URL("../../../packages/mobile_core/lib/provider_offline_sync_api.dart", import.meta.url),
  "utf8",
);
assert.match(api, /syncOfflineFieldDraft/);
assert.match(api, /offlineFieldSyncConflicts/);
assert.match(api, /resolveOfflineFieldSyncConflict/);
assert.match(api, /response\.statusCode == 409/);
assert.match(api, /await me\(\)/, "offline API retry must reuse canonical token refresh");

const mobile = readFileSync(
  new URL("../../../packages/mobile_core/lib/provider_offline_drafts.dart", import.meta.url),
  "utf8",
);
assert.match(mobile, /FlutterSecureStorage/, "local offline drafts must use device secure storage");
assert.match(mobile, /'PENDING'/);
assert.match(mobile, /'SYNCED'/);
assert.match(mobile, /'CONFLICT'/);
assert.match(mobile, /'KEEP_SERVER'/);
assert.match(mobile, /'USE_CLIENT'/);
assert.match(mobile, /clientRevision/);
assert.match(mobile, /serverVersion/);
assert.match(mobile, /evidenceRefs/);
assert.match(mobile, /'ar':/);
assert.match(mobile, /'fr':/);
assert.match(mobile, /'es':/);
assert.match(mobile, /Nothing is overwritten automatically/);

const actions = readFileSync(
  new URL("../../../packages/mobile_core/lib/care_provider_actions.dart", import.meta.url),
  "utf8",
);
assert.match(actions, /allowedModalities\.contains\('HOME_VISIT'\).*?'offlineDrafts'/s);
assert.match(actions, /ProviderOfflineDraftsPage/);

const appModule = readFileSync(new URL("../src/app.module.ts", import.meta.url), "utf8");
assert.match(appModule, /ProviderOfflineSyncModule/);

console.log("PRV-075 encrypted offline field drafts, conflict preservation, and explicit reconciliation acceptance passed");
await import("./v2-doctor-offline-clinical-draft-smoke.mjs");
