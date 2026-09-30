CREATE TABLE "LocalizationCatalog" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "currentVersion" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LocalizationCatalog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TranslationKey" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "namespace" TEXT NOT NULL DEFAULT 'common',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "currentVersion" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TranslationKey_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TranslationVersion" (
  "id" TEXT NOT NULL,
  "translationKeyId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "textEn" TEXT NOT NULL,
  "textAr" TEXT,
  "textFr" TEXT,
  "textEs" TEXT,
  "createdByActorId" TEXT,
  "reasonCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TranslationVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LocalizationCatalog_code_key" ON "LocalizationCatalog"("code");
CREATE INDEX "LocalizationCatalog_code_currentVersion_idx" ON "LocalizationCatalog"("code", "currentVersion");
CREATE UNIQUE INDEX "TranslationKey_key_key" ON "TranslationKey"("key");
CREATE INDEX "TranslationKey_namespace_active_key_idx" ON "TranslationKey"("namespace", "active", "key");
CREATE UNIQUE INDEX "TranslationVersion_translationKeyId_version_key" ON "TranslationVersion"("translationKeyId", "version");
CREATE INDEX "TranslationVersion_translationKeyId_createdAt_idx" ON "TranslationVersion"("translationKeyId", "createdAt");

ALTER TABLE "LocalizationCatalog"
  ADD CONSTRAINT "LocalizationCatalog_current_version_check" CHECK ("currentVersion" > 0);
ALTER TABLE "TranslationKey"
  ADD CONSTRAINT "TranslationKey_current_version_check" CHECK ("currentVersion" > 0);
ALTER TABLE "TranslationVersion"
  ADD CONSTRAINT "TranslationVersion_version_check" CHECK ("version" > 0);
ALTER TABLE "TranslationVersion"
  ADD CONSTRAINT "TranslationVersion_text_en_nonempty_check" CHECK (length(btrim("textEn")) > 0);

ALTER TABLE "TranslationVersion"
  ADD CONSTRAINT "TranslationVersion_translationKeyId_fkey"
  FOREIGN KEY ("translationKeyId") REFERENCES "TranslationKey"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION carepoint_reject_translation_history_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'translation history is immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "TranslationVersion_immutable"
BEFORE UPDATE OR DELETE ON "TranslationVersion"
FOR EACH ROW EXECUTE FUNCTION carepoint_reject_translation_history_mutation();
REVOKE UPDATE, DELETE ON "TranslationVersion" FROM PUBLIC;

INSERT INTO "LocalizationCatalog" ("id", "code", "currentVersion", "createdAt", "updatedAt")
VALUES ('00000000-0000-4000-8000-000000000056', 'GLOBAL', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
