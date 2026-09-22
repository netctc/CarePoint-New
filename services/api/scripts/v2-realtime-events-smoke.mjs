import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const service = readFileSync(new URL("../src/modules/realtime/realtime.service.ts", import.meta.url), "utf8");
const moduleSource = readFileSync(new URL("../src/modules/realtime/realtime.module.ts", import.meta.url), "utf8");
const appModule = readFileSync(new URL("../src/app.module.ts", import.meta.url), "utf8");
const prisma = readFileSync(new URL("../prisma/v2_realtime.prisma", import.meta.url), "utf8");
const migration = readFileSync(new URL("../prisma/migrations/20260922090000_v2_realtime/migration.sql", import.meta.url), "utf8");

for (const topic of ["CLINICAL_ALERTS", "QUESTIONNAIRE_COMPLETIONS", "OBSERVATIONS", "PROVIDER_JOB_STATUS"]) {
  assert.match(service, new RegExp(`\\b${topic}\\b`), `Missing realtime topic ${topic}`);
}

assert.match(moduleSource, /@Sse\("stream"\)/, "Realtime stream must use Nest SSE transport");
assert.match(moduleSource, /X-Accel-Buffering["'],\s*["']no/, "SSE proxy buffering must be disabled");
assert.match(moduleSource, /Cache-Control["'],\s*["']no-store/, "Realtime responses must not be cached");
assert.match(appModule, /import \{ RealtimeModule \} from "\.\/modules\/realtime\/realtime\.module";/, "RealtimeModule import missing");
assert.match(appModule, /\bRealtimeModule,/, "RealtimeModule must be registered in AppModule");

assert.match(service, /REPLAY_WINDOW_MS\s*=\s*10 \* 60 \* 1000/, "Replay must remain bounded to ten minutes");
assert.match(service, /this\.assertLiveSession\(principal\)/, "Every authorization cycle must revalidate the live session");
assert.match(service, /this\.prisma\.authSession\.findUnique/, "Realtime authorization must check persisted AuthSession state");
assert.match(service, /session\.revokedAt/, "Revoked sessions must terminate realtime access");
assert.match(service, /session\.expiresAt\.getTime\(\) <= Date\.now\(\)/, "Expired sessions must terminate realtime access");
assert.match(service, /this\.prisma\.appointment\.findFirst/, "Provider clinical streams must revalidate treatment relationship");
assert.match(service, /Current treatment relationship required for realtime clinical data/, "Treatment relationship denial invariant missing");
assert.match(service, /OTHER_PROVIDER_WORKFLOW_EXECUTE/, "Provider job topic must require workflow permission");
assert.match(service, /Active provider profile required/, "Provider realtime access must require active profile");
assert.match(service, /REALTIME_SUBSCRIPTION_OPENED/, "Subscription open must be audited");
assert.match(service, /REALTIME_SUBSCRIPTION_CLOSED/, "Subscription close must be audited");

const dtoStart = service.indexOf("export interface RealtimeMessage");
const dtoEnd = service.indexOf("type Cursor", dtoStart);
assert.ok(dtoStart >= 0 && dtoEnd > dtoStart, "Realtime message DTO block not found");
const dto = service.slice(dtoStart, dtoEnd);
for (const forbidden of [
  "patientId",
  "providerId",
  "severity",
  "metricCode",
  "value",
  "evidence",
  "ciphertext",
  "answer",
  "responsePayload",
  "clinicalNote",
]) {
  assert.equal(dto.includes(forbidden), false, `Realtime SSE DTO must not expose ${forbidden}`);
}
for (const required of ["topic", "eventType", "entityType", "entityId", "occurredAt"]) {
  assert.equal(dto.includes(required), true, `Realtime SSE DTO must include structural field ${required}`);
}

assert.match(service, /select:\s*\{ id: true, createdAt: true \}/, "Clinical alert/observation queries must select structural metadata only");
assert.match(service, /select:\s*\{ id: true, completedAt: true \}/, "Questionnaire query must select structural metadata only");
assert.match(service, /select:\s*\{ id: true, occurredAt: true \}/, "Provider workflow query must select structural metadata only");
assert.doesNotMatch(service, /ClinicalEnvelopeService|decrypt|ciphertext:\s*true/, "Realtime service must never decrypt clinical payloads");

assert.match(prisma, /model RealtimeSubscription/, "Realtime subscription evidence model missing");
assert.match(prisma, /actorId\s+String/, "Subscription actor evidence missing");
assert.match(prisma, /sessionId\s+String/, "Subscription session evidence missing");
assert.match(prisma, /scopeKey\s+String/, "Subscription scope evidence missing");
assert.match(prisma, /lastAuthorizedAt\s+DateTime/, "Periodic authorization evidence missing");
assert.match(prisma, /disconnectedAt\s+DateTime\?/, "Disconnect evidence missing");

assert.match(migration, /RealtimeSubscription_guard_identity_update/, "Database must protect immutable subscription identity evidence");
assert.match(migration, /identity evidence is immutable/, "Immutable evidence trigger missing");
assert.match(migration, /RealtimeSubscription_no_hard_delete/, "Hard delete protection missing");
assert.match(migration, /REVOKE DELETE ON "RealtimeSubscription" FROM PUBLIC/, "Delete privilege must be revoked");

console.log("V2 BE-053 authorized realtime SSE acceptance passed");
await import("./v2-feature-flags-smoke.mjs");
