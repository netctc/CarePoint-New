CREATE TYPE "CareConversationStatus" AS ENUM ('OPEN', 'CLOSED');
CREATE TYPE "CareParticipantKind" AS ENUM ('PATIENT', 'PROVIDER');
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'PUSH', 'EMAIL', 'SMS');
CREATE TYPE "NotificationEventType" AS ENUM ('SECURE_MESSAGE', 'APPOINTMENT_UPDATE', 'CLINICAL_UPDATE', 'INSURANCE_UPDATE', 'CARE_COORDINATION');
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

CREATE TABLE "CareConversation" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "patientId" UUID NOT NULL,
  "appointmentId" UUID,
  "createdByAccountId" UUID NOT NULL,
  "clientConversationId" TEXT NOT NULL,
  "status" "CareConversationStatus" NOT NULL DEFAULT 'OPEN',
  "subjectAlgorithm" TEXT NOT NULL,
  "subjectKeyId" TEXT NOT NULL,
  "subjectWrappedKey" TEXT NOT NULL,
  "subjectIv" TEXT NOT NULL,
  "subjectCiphertext" TEXT NOT NULL,
  "lastMessageAt" TIMESTAMPTZ,
  "closedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CareConversation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CareConversationParticipant" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "conversationId" UUID NOT NULL,
  "accountId" UUID NOT NULL,
  "providerId" UUID,
  "kind" "CareParticipantKind" NOT NULL,
  "joinedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leftAt" TIMESTAMPTZ,
  CONSTRAINT "CareConversationParticipant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CareMessage" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "conversationId" UUID NOT NULL,
  "senderAccountId" UUID NOT NULL,
  "clientMessageId" TEXT NOT NULL,
  "algorithm" TEXT NOT NULL,
  "keyId" TEXT NOT NULL,
  "wrappedKey" TEXT NOT NULL,
  "iv" TEXT NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "sentAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CareMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CareMessageAttachment" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "messageId" UUID NOT NULL,
  "clinicalDocumentId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CareMessageAttachment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CareMessageReadReceipt" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "messageId" UUID NOT NULL,
  "accountId" UUID NOT NULL,
  "readAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CareMessageReadReceipt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationPreference" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "accountId" UUID NOT NULL,
  "locale" TEXT NOT NULL DEFAULT 'en',
  "inAppEnabled" BOOLEAN NOT NULL DEFAULT TRUE,
  "pushEnabled" BOOLEAN NOT NULL DEFAULT FALSE,
  "emailEnabled" BOOLEAN NOT NULL DEFAULT FALSE,
  "smsEnabled" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NotificationPreference_locale_check" CHECK ("locale" IN ('en', 'ar', 'fr', 'es'))
);

CREATE TABLE "NotificationEndpoint" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "accountId" UUID NOT NULL,
  "channel" "NotificationChannel" NOT NULL,
  "externalEndpointRef" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NotificationEndpoint_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NotificationEndpoint_channel_check" CHECK ("channel" IN ('PUSH', 'SMS'))
);

CREATE TABLE "NotificationEvent" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "accountId" UUID NOT NULL,
  "type" "NotificationEventType" NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "safeTitleKey" TEXT NOT NULL,
  "safeBodyKey" TEXT NOT NULL,
  "readAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NotificationEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationDelivery" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "notificationId" UUID NOT NULL,
  "channel" "NotificationChannel" NOT NULL,
  "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "providerRef" TEXT,
  "attemptedAt" TIMESTAMPTZ,
  "lastErrorCode" TEXT,
  CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CareConversation_createdByAccountId_clientConversationId_key" ON "CareConversation"("createdByAccountId", "clientConversationId");
CREATE INDEX "CareConversation_patientId_status_lastMessageAt_idx" ON "CareConversation"("patientId", "status", "lastMessageAt");
CREATE INDEX "CareConversation_appointmentId_idx" ON "CareConversation"("appointmentId");
CREATE UNIQUE INDEX "CareConversationParticipant_conversationId_accountId_key" ON "CareConversationParticipant"("conversationId", "accountId");
CREATE INDEX "CareConversationParticipant_accountId_leftAt_idx" ON "CareConversationParticipant"("accountId", "leftAt");
CREATE INDEX "CareConversationParticipant_providerId_leftAt_idx" ON "CareConversationParticipant"("providerId", "leftAt");
CREATE UNIQUE INDEX "CareMessage_senderAccountId_clientMessageId_key" ON "CareMessage"("senderAccountId", "clientMessageId");
CREATE INDEX "CareMessage_conversationId_sentAt_idx" ON "CareMessage"("conversationId", "sentAt");
CREATE UNIQUE INDEX "CareMessageAttachment_messageId_clinicalDocumentId_key" ON "CareMessageAttachment"("messageId", "clinicalDocumentId");
CREATE INDEX "CareMessageAttachment_clinicalDocumentId_idx" ON "CareMessageAttachment"("clinicalDocumentId");
CREATE UNIQUE INDEX "CareMessageReadReceipt_messageId_accountId_key" ON "CareMessageReadReceipt"("messageId", "accountId");
CREATE INDEX "CareMessageReadReceipt_accountId_readAt_idx" ON "CareMessageReadReceipt"("accountId", "readAt");
CREATE UNIQUE INDEX "NotificationPreference_accountId_key" ON "NotificationPreference"("accountId");
CREATE UNIQUE INDEX "NotificationEndpoint_accountId_channel_externalEndpointRef_key" ON "NotificationEndpoint"("accountId", "channel", "externalEndpointRef");
CREATE INDEX "NotificationEndpoint_accountId_channel_active_idx" ON "NotificationEndpoint"("accountId", "channel", "active");
CREATE INDEX "NotificationEvent_accountId_readAt_createdAt_idx" ON "NotificationEvent"("accountId", "readAt", "createdAt");
CREATE INDEX "NotificationEvent_type_createdAt_idx" ON "NotificationEvent"("type", "createdAt");
CREATE UNIQUE INDEX "NotificationDelivery_notificationId_channel_key" ON "NotificationDelivery"("notificationId", "channel");
CREATE INDEX "NotificationDelivery_status_attemptedAt_idx" ON "NotificationDelivery"("status", "attemptedAt");

ALTER TABLE "CareConversation" ADD CONSTRAINT "CareConversation_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CareConversation" ADD CONSTRAINT "CareConversation_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CareConversation" ADD CONSTRAINT "CareConversation_createdByAccountId_fkey" FOREIGN KEY ("createdByAccountId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CareConversationParticipant" ADD CONSTRAINT "CareConversationParticipant_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "CareConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CareConversationParticipant" ADD CONSTRAINT "CareConversationParticipant_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CareConversationParticipant" ADD CONSTRAINT "CareConversationParticipant_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CareMessage" ADD CONSTRAINT "CareMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "CareConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CareMessage" ADD CONSTRAINT "CareMessage_senderAccountId_fkey" FOREIGN KEY ("senderAccountId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CareMessageAttachment" ADD CONSTRAINT "CareMessageAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "CareMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CareMessageAttachment" ADD CONSTRAINT "CareMessageAttachment_clinicalDocumentId_fkey" FOREIGN KEY ("clinicalDocumentId") REFERENCES "ClinicalDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CareMessageReadReceipt" ADD CONSTRAINT "CareMessageReadReceipt_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "CareMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CareMessageReadReceipt" ADD CONSTRAINT "CareMessageReadReceipt_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationEndpoint" ADD CONSTRAINT "NotificationEndpoint_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationEvent" ADD CONSTRAINT "NotificationEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "NotificationEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
