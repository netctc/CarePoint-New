import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const prisma = readFileSync(new URL("../prisma/v2_notification_templates.prisma", import.meta.url), "utf8");
const migration = readFileSync(
  new URL("../prisma/migrations/20260922082000_v2_notification_templates/migration.sql", import.meta.url),
  "utf8",
);
const templates = readFileSync(
  new URL("../src/modules/communications/notification-template.service.ts", import.meta.url),
  "utf8",
);
const notifications = readFileSync(
  new URL("../src/modules/communications/notifications.service.ts", import.meta.url),
  "utf8",
);
const store = readFileSync(
  new URL("../src/modules/communications/notification-outbox-store.service.ts", import.meta.url),
  "utf8",
);
const worker = readFileSync(
  new URL("../src/modules/communications/notification-outbox-worker.service.ts", import.meta.url),
  "utf8",
);
const gateway = readFileSync(
  new URL("../src/modules/communications/notification-gateway.service.ts", import.meta.url),
  "utf8",
);
const moduleSource = readFileSync(
  new URL("../src/modules/communications/communications.module.ts", import.meta.url),
  "utf8",
);

// Canonical BE-042 extends the existing four-channel outbox; it must not replace it.
assert.match(notifications, /OUTBOX_CHANNELS = \["IN_APP", "PUSH", "EMAIL", "SMS"\]/);
assert.match(notifications, /notificationDelivery\.createMany/);
assert.match(worker, /retryBaseSeconds \* \(2 \*\*/);
assert.match(gateway, /"idempotency-key": `\$\{input\.notificationId\}:\$\{input\.channel\}`/);

// Templates are stable-key anchors with immutable locale/version rows.
assert.match(prisma, /model NotificationTemplate\s*\{/);
assert.match(prisma, /key\s+String\s+@unique/);
assert.match(prisma, /currentVersion\s+Int\s+@default\(1\)/);
assert.match(prisma, /model NotificationTemplateVersion\s*\{/);
assert.match(prisma, /@@unique\(\[templateId, version, locale\]\)/);
assert.match(migration, /NotificationTemplateVersion_append_only/);
assert.match(migration, /REVOKE UPDATE, DELETE ON "NotificationTemplateVersion" FROM PUBLIC/);

// All supported locales are published together and text is deliberately static/PHI-neutral.
assert.match(templates, /const LOCALES = \["en", "ar", "fr", "es"\] as const/);
assert.match(templates, /translations must contain en, ar, fr and es static text/);
assert.match(templates, /PHI-neutral fixed text with no placeholders or sensitive clinical terms/);
assert.match(templates, /PROHIBITED_TEMPLATE_TEXT/);
assert.match(templates, /NotificationTemplateVersion/);

// Publication is optimistic, serializable and append-only rather than rewriting history.
assert.match(templates, /expectedVersion/);
assert.match(templates, /FOR UPDATE/);
assert.match(templates, /TransactionIsolationLevel\.Serializable/);
assert.match(templates, /reserveIntegrityChainForSerializableTransaction/);
assert.match(templates, /notificationTemplateVersion\.createMany/);
assert.doesNotMatch(templates, /notificationTemplateVersion\.update/);
assert.doesNotMatch(templates, /notificationTemplateVersion\.delete/);

// Each event pins exact versions when a local template exists; unregistered legacy keys remain compatible.
assert.match(prisma, /model NotificationEventTemplateBinding\s*\{/);
assert.match(prisma, /titleVersion\s+Int\?/);
assert.match(prisma, /bodyVersion\s+Int\?/);
assert.match(migration, /NotificationEventTemplateBinding_immutable/);
assert.match(notifications, /notificationEventTemplateBinding\.createMany/);
assert.match(notifications, /titleVersion: titleTemplate\?\.active \? titleTemplate\.currentVersion : null/);
assert.match(notifications, /bodyVersion: bodyTemplate\?\.active \? bodyTemplate\.currentVersion : null/);
assert.match(store, /safeTitleVersion: binding\?\.titleVersion \?\? null/);
assert.match(store, /safeBodyVersion: binding\?\.bodyVersion \?\? null/);
assert.match(worker, /safeTitleVersion: item\.notification\.safeTitleVersion \?\? undefined/);
assert.match(worker, /safeBodyVersion: item\.notification\.safeBodyVersion \?\? undefined/);
assert.match(gateway, /safeTitleVersion\?: number \| undefined/);
assert.match(gateway, /safeBodyVersion\?: number \| undefined/);

// Admin governance stays in the existing notification domain permission boundary.
assert.match(moduleSource, /@Controller\("admin\/notification-templates"\)/);
assert.match(moduleSource, /RequirePermissions\("NOTIFICATION_OPERATE"\)/);
assert.match(moduleSource, /@Post\(":templateId\/versions"\)/);
assert.match(moduleSource, /NotificationTemplateService/);

console.log("BE-042 versioned multichannel notification template acceptance passed");
