CREATE TABLE "CredentialExpiryPolicy" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "notificationsEnabled" BOOLEAN NOT NULL DEFAULT true,
  "warningDays" JSONB NOT NULL,
  "updatedByActorId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CredentialExpiryPolicy_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CredentialExpiryPolicy_warningDays_check" CHECK (jsonb_typeof("warningDays") = 'array')
);
CREATE UNIQUE INDEX "CredentialExpiryPolicy_code_key" ON "CredentialExpiryPolicy"("code");
CREATE INDEX "CredentialExpiryPolicy_notificationsEnabled_code_idx" ON "CredentialExpiryPolicy"("notificationsEnabled", "code");
INSERT INTO "CredentialExpiryPolicy" ("id","code","notificationsEnabled","warningDays","updatedAt")
VALUES ('00000000-0000-4000-8000-000000000108','GLOBAL',true,'[90,30,7]'::jsonb,CURRENT_TIMESTAMP);
