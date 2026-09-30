CREATE TABLE "ClinicalProfileRevisionAnnotation" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "entryVersion" INTEGER NOT NULL,
    "domain" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "createdByActorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClinicalProfileRevisionAnnotation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ClinicalProfileRevisionAnnotation_entryVersion_check" CHECK ("entryVersion" > 0),
    CONSTRAINT "ClinicalProfileRevisionAnnotation_domain_check" CHECK ("domain" IN ('ALLERGY_RECONCILIATION')),
    CONSTRAINT "ClinicalProfileRevisionAnnotation_reasonCode_check" CHECK ("reasonCode" IN ('CONFIRMED','CORRECTED','PATIENT_CLARIFIED','DUPLICATE','OTHER'))
);

CREATE UNIQUE INDEX "ClinicalProfileRevisionAnnotation_entryId_entryVersion_domain_key"
ON "ClinicalProfileRevisionAnnotation"("entryId", "entryVersion", "domain");
CREATE INDEX "ClinicalProfileRevisionAnnotation_entryId_createdAt_idx"
ON "ClinicalProfileRevisionAnnotation"("entryId", "createdAt");
CREATE INDEX "ClinicalProfileRevisionAnnotation_domain_createdAt_idx"
ON "ClinicalProfileRevisionAnnotation"("domain", "createdAt");

ALTER TABLE "ClinicalProfileRevisionAnnotation" ADD CONSTRAINT "ClinicalProfileRevisionAnnotation_entryId_fkey"
FOREIGN KEY ("entryId") REFERENCES "ClinicalProfileEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
