-- CarePoint Next initial PostgreSQL schema.
-- This baseline includes Slice 0, Slice 1 and Slice 1.1 persistence models.

CREATE TYPE "UserRole" AS ENUM ('PATIENT', 'DOCTOR', 'OTHER_PROVIDER', 'ADMIN', 'SUPPORT');
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED');
CREATE TYPE "ProviderClass" AS ENUM ('DOCTOR', 'OTHER_PROVIDER');
CREATE TYPE "ProviderStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'SUSPENDED', 'REJECTED');
CREATE TYPE "ProviderOnboardingState" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'REQUEST_CHANGES', 'APPROVED', 'REJECTED');
CREATE TYPE "CredentialReviewState" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');
CREATE TYPE "ConsentState" AS ENUM ('GRANTED', 'REVOKED');
CREATE TYPE "AuthChallengeType" AS ENUM ('MFA_LOGIN');
CREATE TYPE "AppointmentModality" AS ENUM ('CLINIC', 'TELEMEDICINE', 'HOME_VISIT');
CREATE TYPE "AppointmentStatus" AS ENUM ('REQUESTED', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW');
CREATE TYPE "EmergencyAmbulanceStatus" AS ENUM ('REQUESTED', 'DISPATCHING', 'ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'TRANSPORTING', 'COMPLETED', 'CANCELLED');

CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "role" "UserRole" NOT NULL,
  "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
  "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
  "lockedUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

CREATE TABLE "AuthSession" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "accessTokenHash" TEXT NOT NULL,
  "refreshTokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "refreshExpiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "replacedBySessionId" TEXT,
  "userAgent" TEXT,
  "ipAddress" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AuthSession_accessTokenHash_key" ON "AuthSession"("accessTokenHash");
CREATE UNIQUE INDEX "AuthSession_refreshTokenHash_key" ON "AuthSession"("refreshTokenHash");
CREATE INDEX "AuthSession_userId_revokedAt_idx" ON "AuthSession"("userId", "revokedAt");
CREATE INDEX "AuthSession_refreshExpiresAt_idx" ON "AuthSession"("refreshExpiresAt");

CREATE TABLE "AuthChallenge" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" "AuthChallengeType" NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuthChallenge_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AuthChallenge_userId_type_expiresAt_idx" ON "AuthChallenge"("userId", "type", "expiresAt");
CREATE INDEX "AuthChallenge_expiresAt_consumedAt_idx" ON "AuthChallenge"("expiresAt", "consumedAt");

CREATE TABLE "MfaEnrollment" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "algorithm" TEXT NOT NULL DEFAULT 'AES-256-GCM',
  "keyId" TEXT NOT NULL,
  "wrappedKey" TEXT NOT NULL,
  "iv" TEXT NOT NULL,
  "secretCiphertext" TEXT NOT NULL,
  "enabledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MfaEnrollment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MfaEnrollment_userId_key" ON "MfaEnrollment"("userId");

CREATE TABLE "PatientProfile" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "firstName" TEXT NOT NULL,
  "lastName" TEXT NOT NULL,
  "phone" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PatientProfile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PatientProfile_userId_key" ON "PatientProfile"("userId");

CREATE TABLE "Provider" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "class" "ProviderClass" NOT NULL,
  "displayName" TEXT NOT NULL,
  "legalName" TEXT,
  "status" "ProviderStatus" NOT NULL DEFAULT 'DRAFT',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Provider_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Provider_userId_key" ON "Provider"("userId");

CREATE TABLE "MedicalSpecialty" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "labels" JSONB NOT NULL,
  "parentId" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "MedicalSpecialty_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MedicalSpecialty_code_key" ON "MedicalSpecialty"("code");

CREATE TABLE "ProviderCategory" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "labels" JSONB NOT NULL,
  "family" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "requiredCredentialTypes" JSONB NOT NULL,
  "capabilities" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProviderCategory_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProviderCategory_slug_key" ON "ProviderCategory"("slug");

CREATE TABLE "ProviderOnboarding" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "kind" "ProviderClass" NOT NULL,
  "specialtyId" TEXT,
  "providerCategoryId" TEXT,
  "state" "ProviderOnboardingState" NOT NULL DEFAULT 'DRAFT',
  "submittedAt" TIMESTAMP(3),
  "reviewedAt" TIMESTAMP(3),
  "reviewerActorId" TEXT,
  "reviewNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProviderOnboarding_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProviderOnboarding_state_submittedAt_idx" ON "ProviderOnboarding"("state", "submittedAt");
CREATE INDEX "ProviderOnboarding_userId_kind_idx" ON "ProviderOnboarding"("userId", "kind");

CREATE TABLE "OnboardingCredential" (
  "id" TEXT NOT NULL,
  "onboardingId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "number" TEXT,
  "issuer" TEXT,
  "validUntil" TIMESTAMP(3),
  "documentId" TEXT,
  "state" "CredentialReviewState" NOT NULL DEFAULT 'PENDING',
  "reviewNote" TEXT,
  "reviewedByActorId" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OnboardingCredential_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OnboardingCredential_onboardingId_state_idx" ON "OnboardingCredential"("onboardingId", "state");

CREATE TABLE "DoctorProfile" (
  "id" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "licenseNumber" TEXT NOT NULL,
  "licenseIssuer" TEXT,
  CONSTRAINT "DoctorProfile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DoctorProfile_providerId_key" ON "DoctorProfile"("providerId");

CREATE TABLE "DoctorSpecialty" (
  "doctorId" TEXT NOT NULL,
  "specialtyId" TEXT NOT NULL,
  "primary" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "DoctorSpecialty_pkey" PRIMARY KEY ("doctorId", "specialtyId")
);

CREATE TABLE "OtherProviderProfile" (
  "id" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "categoryId" TEXT NOT NULL,
  CONSTRAINT "OtherProviderProfile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OtherProviderProfile_providerId_key" ON "OtherProviderProfile"("providerId");

CREATE TABLE "ProviderCredential" (
  "id" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "issuer" TEXT,
  "number" TEXT,
  "validFrom" TIMESTAMP(3),
  "validUntil" TIMESTAMP(3),
  "status" TEXT NOT NULL,
  "documentId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProviderCredential_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProviderCredential_providerId_type_status_idx" ON "ProviderCredential"("providerId", "type", "status");

CREATE TABLE "Service" (
  "id" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ServiceModality" (
  "id" TEXT NOT NULL,
  "serviceId" TEXT NOT NULL,
  "modality" "AppointmentModality" NOT NULL,
  "durationMinutes" INTEGER NOT NULL,
  "priceMinor" INTEGER NOT NULL,
  "coverage" JSONB,
  CONSTRAINT "ServiceModality_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ServiceModality_serviceId_modality_key" ON "ServiceModality"("serviceId", "modality");

CREATE TABLE "AvailabilitySlot" (
  "id" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "serviceId" TEXT,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "capacity" INTEGER NOT NULL DEFAULT 1,
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "AvailabilitySlot_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AvailabilitySlot_providerId_startsAt_endsAt_idx" ON "AvailabilitySlot"("providerId", "startsAt", "endsAt");

CREATE TABLE "Appointment" (
  "id" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "serviceId" TEXT NOT NULL,
  "modality" "AppointmentModality" NOT NULL,
  "status" "AppointmentStatus" NOT NULL DEFAULT 'REQUESTED',
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Appointment_providerId_startsAt_status_idx" ON "Appointment"("providerId", "startsAt", "status");
CREATE INDEX "Appointment_patientId_startsAt_idx" ON "Appointment"("patientId", "startsAt");

CREATE TABLE "EmergencyAmbulanceRequest" (
  "id" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "status" "EmergencyAmbulanceStatus" NOT NULL DEFAULT 'REQUESTED',
  "latitude" DECIMAL(9,6) NOT NULL,
  "longitude" DECIMAL(9,6) NOT NULL,
  "pickupAddress" TEXT,
  "callbackPhone" TEXT,
  "note" TEXT,
  "assignedProviderId" TEXT,
  "etaMinutes" INTEGER,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmergencyAmbulanceRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EmergencyAmbulanceRequest_status_requestedAt_idx" ON "EmergencyAmbulanceRequest"("status", "requestedAt");
CREATE INDEX "EmergencyAmbulanceRequest_assignedProviderId_status_idx" ON "EmergencyAmbulanceRequest"("assignedProviderId", "status");

CREATE TABLE "ClinicalRecord" (
  "id" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "encounterRef" TEXT,
  "algorithm" TEXT NOT NULL,
  "keyId" TEXT NOT NULL,
  "wrappedKey" TEXT NOT NULL,
  "iv" TEXT NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClinicalRecord_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ClinicalRecord_patientId_createdAt_idx" ON "ClinicalRecord"("patientId", "createdAt");
CREATE INDEX "ClinicalRecord_providerId_createdAt_idx" ON "ClinicalRecord"("providerId", "createdAt");

CREATE TABLE "Consent" (
  "id" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "providerId" TEXT,
  "scope" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "state" "ConsentState" NOT NULL DEFAULT 'GRANTED',
  "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  CONSTRAINT "Consent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Consent_patientId_providerId_scope_state_idx" ON "Consent"("patientId", "providerId", "scope", "state");

CREATE TABLE "AuditEvent" (
  "id" TEXT NOT NULL,
  "actorId" TEXT,
  "action" TEXT NOT NULL,
  "objectType" TEXT NOT NULL,
  "objectId" TEXT,
  "purpose" TEXT,
  "result" TEXT NOT NULL,
  "metadata" JSONB,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AuditEvent_actorId_occurredAt_idx" ON "AuditEvent"("actorId", "occurredAt");
CREATE INDEX "AuditEvent_objectType_objectId_occurredAt_idx" ON "AuditEvent"("objectType", "objectId", "occurredAt");

ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuthChallenge" ADD CONSTRAINT "AuthChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MfaEnrollment" ADD CONSTRAINT "MfaEnrollment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PatientProfile" ADD CONSTRAINT "PatientProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Provider" ADD CONSTRAINT "Provider_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MedicalSpecialty" ADD CONSTRAINT "MedicalSpecialty_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "MedicalSpecialty"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProviderOnboarding" ADD CONSTRAINT "ProviderOnboarding_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProviderOnboarding" ADD CONSTRAINT "ProviderOnboarding_specialtyId_fkey" FOREIGN KEY ("specialtyId") REFERENCES "MedicalSpecialty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProviderOnboarding" ADD CONSTRAINT "ProviderOnboarding_providerCategoryId_fkey" FOREIGN KEY ("providerCategoryId") REFERENCES "ProviderCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OnboardingCredential" ADD CONSTRAINT "OnboardingCredential_onboardingId_fkey" FOREIGN KEY ("onboardingId") REFERENCES "ProviderOnboarding"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DoctorProfile" ADD CONSTRAINT "DoctorProfile_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DoctorSpecialty" ADD CONSTRAINT "DoctorSpecialty_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "DoctorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DoctorSpecialty" ADD CONSTRAINT "DoctorSpecialty_specialtyId_fkey" FOREIGN KEY ("specialtyId") REFERENCES "MedicalSpecialty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OtherProviderProfile" ADD CONSTRAINT "OtherProviderProfile_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OtherProviderProfile" ADD CONSTRAINT "OtherProviderProfile_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ProviderCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProviderCredential" ADD CONSTRAINT "ProviderCredential_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Service" ADD CONSTRAINT "Service_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServiceModality" ADD CONSTRAINT "ServiceModality_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AvailabilitySlot" ADD CONSTRAINT "AvailabilitySlot_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AvailabilitySlot" ADD CONSTRAINT "AvailabilitySlot_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmergencyAmbulanceRequest" ADD CONSTRAINT "EmergencyAmbulanceRequest_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmergencyAmbulanceRequest" ADD CONSTRAINT "EmergencyAmbulanceRequest_assignedProviderId_fkey" FOREIGN KEY ("assignedProviderId") REFERENCES "Provider"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ClinicalRecord" ADD CONSTRAINT "ClinicalRecord_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Consent" ADD CONSTRAINT "Consent_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
