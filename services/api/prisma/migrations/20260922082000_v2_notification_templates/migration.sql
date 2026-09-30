CREATE TABLE "NotificationTemplate" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "currentVersion" INTEGER NOT NULL DEFAULT 1,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NotificationTemplate_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NotificationTemplate_version_check" CHECK ("currentVersion" >= 1)
);

CREATE TABLE "NotificationTemplateVersion" (
  "id" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "locale" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "createdByActorId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NotificationTemplateVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NotificationTemplateVersion_version_check" CHECK ("version" >= 1),
  CONSTRAINT "NotificationTemplateVersion_locale_check" CHECK ("locale" IN ('en','ar','fr','es')),
  CONSTRAINT "NotificationTemplateVersion_text_check" CHECK (char_length("text") BETWEEN 1 AND 240)
);

CREATE TABLE "NotificationEventTemplateBinding" (
  "id" TEXT NOT NULL,
  "notificationId" TEXT NOT NULL,
  "titleKey" TEXT NOT NULL,
  "titleVersion" INTEGER,
  "bodyKey" TEXT NOT NULL,
  "bodyVersion" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NotificationEventTemplateBinding_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotificationTemplate_key_key" ON "NotificationTemplate"("key");
CREATE INDEX "NotificationTemplate_active_key_idx" ON "NotificationTemplate"("active", "key");
CREATE UNIQUE INDEX "NotificationTemplateVersion_templateId_version_locale_key" ON "NotificationTemplateVersion"("templateId", "version", "locale");
CREATE INDEX "NotificationTemplateVersion_templateId_version_idx" ON "NotificationTemplateVersion"("templateId", "version");
CREATE INDEX "NotificationTemplateVersion_locale_createdAt_idx" ON "NotificationTemplateVersion"("locale", "createdAt");
CREATE UNIQUE INDEX "NotificationEventTemplateBinding_notificationId_key" ON "NotificationEventTemplateBinding"("notificationId");
CREATE INDEX "NotificationEventTemplateBinding_titleKey_titleVersion_idx" ON "NotificationEventTemplateBinding"("titleKey", "titleVersion");
CREATE INDEX "NotificationEventTemplateBinding_bodyKey_bodyVersion_idx" ON "NotificationEventTemplateBinding"("bodyKey", "bodyVersion");

ALTER TABLE "NotificationTemplateVersion"
  ADD CONSTRAINT "NotificationTemplateVersion_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "NotificationTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NotificationTemplateVersion"
  ADD CONSTRAINT "NotificationTemplateVersion_createdByActorId_fkey"
  FOREIGN KEY ("createdByActorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NotificationEventTemplateBinding"
  ADD CONSTRAINT "NotificationEventTemplateBinding_notificationId_fkey"
  FOREIGN KEY ("notificationId") REFERENCES "NotificationEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION carepoint_reject_notification_template_version_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'notification template versions are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION carepoint_reject_notification_binding_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'notification template bindings are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "NotificationTemplateVersion_append_only"
BEFORE UPDATE OR DELETE ON "NotificationTemplateVersion"
FOR EACH ROW EXECUTE FUNCTION carepoint_reject_notification_template_version_mutation();

CREATE TRIGGER "NotificationEventTemplateBinding_immutable"
BEFORE UPDATE OR DELETE ON "NotificationEventTemplateBinding"
FOR EACH ROW EXECUTE FUNCTION carepoint_reject_notification_binding_mutation();

REVOKE UPDATE, DELETE ON "NotificationTemplateVersion" FROM PUBLIC;
REVOKE UPDATE, DELETE ON "NotificationEventTemplateBinding" FROM PUBLIC;
