CREATE TABLE "TransportCompany" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "legalName" TEXT NOT NULL,
  "registrationNumber" TEXT,
  "contactPhone" TEXT,
  "providerIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "unitIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TransportCompany_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TransportCrewMember" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "providerId" TEXT,
  "displayName" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "licenseNumber" TEXT,
  "licenseIssuer" TEXT,
  "licenseValidUntil" TIMESTAMP(3),
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TransportCrewMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TransportCompany_code_key" ON "TransportCompany"("code");
CREATE UNIQUE INDEX "TransportCompany_registrationNumber_key" ON "TransportCompany"("registrationNumber");
CREATE INDEX "TransportCompany_active_displayName_idx" ON "TransportCompany"("active", "displayName");

CREATE INDEX "TransportCrewMember_companyId_providerId_idx"
  ON "TransportCrewMember"("companyId", "providerId");
CREATE INDEX "TransportCrewMember_companyId_active_role_idx"
  ON "TransportCrewMember"("companyId", "active", "role");
CREATE INDEX "TransportCrewMember_providerId_idx"
  ON "TransportCrewMember"("providerId");

ALTER TABLE "TransportCrewMember"
  ADD CONSTRAINT "TransportCrewMember_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "TransportCompany"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
