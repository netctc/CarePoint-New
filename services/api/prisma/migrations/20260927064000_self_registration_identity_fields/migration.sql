ALTER TABLE "User"
  ADD COLUMN "username" TEXT;

CREATE UNIQUE INDEX "User_username_key"
  ON "User"("username");

ALTER TABLE "PatientProfile"
  ADD COLUMN "dateOfBirth" DATE,
  ADD COLUMN "sex" TEXT;

ALTER TABLE "Provider"
  ADD COLUMN "contactPhone" TEXT;
