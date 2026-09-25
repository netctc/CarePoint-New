-- CarePoint V2 BE-047 — pseudonymized analytics fact stream and population materialization.
-- Runtime dashboards read PopulationMetric only; the one-time bootstrap below is the only OLTP backfill.

CREATE TABLE "AnalyticsFact" (
  "id" TEXT NOT NULL,
  "sourceEventKey" TEXT NOT NULL,
  "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  "factType" TEXT NOT NULL,
  "subjectKey" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "month" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnalyticsFact_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AnalyticsFact_schema_version_check" CHECK ("schemaVersion" > 0),
  CONSTRAINT "AnalyticsFact_fact_type_check" CHECK (
    "factType" IN ('OBSERVATION','RPM_ALERT','CARE_PLAN','QUESTIONNAIRE','LABORATORY_RESULT')
  ),
  CONSTRAINT "AnalyticsFact_subject_key_check" CHECK ("subjectKey" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "AnalyticsFact_source_event_key_check" CHECK ("sourceEventKey" ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX "AnalyticsFact_sourceEventKey_key"
ON "AnalyticsFact"("sourceEventKey");

CREATE INDEX "AnalyticsFact_factType_month_subjectKey_idx"
ON "AnalyticsFact"("factType","month","subjectKey");

CREATE INDEX "AnalyticsFact_month_factType_idx"
ON "AnalyticsFact"("month","factType");

CREATE TABLE "PopulationMetric" (
  "id" TEXT NOT NULL,
  "metricType" TEXT NOT NULL,
  "month" TIMESTAMP(3) NOT NULL,
  "patientCount" INTEGER NOT NULL,
  "eventCount" INTEGER NOT NULL,
  "sourceWatermark" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "refreshedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PopulationMetric_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PopulationMetric_patient_count_check" CHECK ("patientCount" >= 0),
  CONSTRAINT "PopulationMetric_event_count_check" CHECK ("eventCount" >= 0)
);

CREATE UNIQUE INDEX "PopulationMetric_metricType_month_key"
ON "PopulationMetric"("metricType","month");

CREATE INDEX "PopulationMetric_month_metricType_idx"
ON "PopulationMetric"("month","metricType");

CREATE OR REPLACE FUNCTION carepoint_analytics_hash(raw_value TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
  SELECT encode(sha256(convert_to(raw_value, 'UTF8')), 'hex')
$$;

CREATE OR REPLACE FUNCTION carepoint_emit_analytics_fact(
  p_fact_type TEXT,
  p_patient_id TEXT,
  p_occurred_at TIMESTAMP,
  p_source_identity TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_source_key TEXT;
  v_subject_key TEXT;
  v_month TIMESTAMP;
  v_inserted_id TEXT;
  v_new_subject INTEGER;
BEGIN
  IF p_patient_id IS NULL OR p_patient_id = '' OR p_occurred_at IS NULL OR p_source_identity IS NULL OR p_source_identity = '' THEN
    RETURN;
  END IF;

  v_source_key := carepoint_analytics_hash(p_source_identity);
  v_subject_key := carepoint_analytics_hash(p_patient_id);
  v_month := date_trunc('month', p_occurred_at);

  INSERT INTO "AnalyticsFact" (
    "id","sourceEventKey","schemaVersion","factType","subjectKey","occurredAt","month"
  )
  VALUES (
    v_source_key,v_source_key,1,p_fact_type,v_subject_key,p_occurred_at,v_month
  )
  ON CONFLICT ("sourceEventKey") DO NOTHING
  RETURNING "id" INTO v_inserted_id;

  IF v_inserted_id IS NULL THEN
    RETURN;
  END IF;

  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM "AnalyticsFact"
    WHERE "factType" = p_fact_type
      AND "month" = v_month
      AND "subjectKey" = v_subject_key
      AND "id" <> v_inserted_id
  ) THEN 0 ELSE 1 END
  INTO v_new_subject;

  INSERT INTO "PopulationMetric" (
    "id","metricType","month","patientCount","eventCount","sourceWatermark","refreshedAt"
  )
  VALUES (
    carepoint_analytics_hash('POPULATION:' || p_fact_type || ':' || v_month::TEXT),
    p_fact_type,
    v_month,
    v_new_subject,
    1,
    p_occurred_at,
    CURRENT_TIMESTAMP
  )
  ON CONFLICT ("metricType","month") DO UPDATE
  SET "patientCount" = "PopulationMetric"."patientCount" + EXCLUDED."patientCount",
      "eventCount" = "PopulationMetric"."eventCount" + 1,
      "sourceWatermark" = GREATEST(
        COALESCE("PopulationMetric"."sourceWatermark", EXCLUDED."sourceWatermark"),
        EXCLUDED."sourceWatermark"
      ),
      "refreshedAt" = CURRENT_TIMESTAMP;
END;
$$;

CREATE OR REPLACE FUNCTION carepoint_analytics_observation_insert()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM carepoint_emit_analytics_fact(
    'OBSERVATION', NEW."patientId", NEW."observedAt", 'OBSERVATION:' || NEW."id"
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION carepoint_analytics_rpm_alert_insert()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM carepoint_emit_analytics_fact(
    'RPM_ALERT', NEW."patientId", NEW."createdAt", 'RPM_ALERT:' || NEW."id"
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION carepoint_analytics_care_plan_insert()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM carepoint_emit_analytics_fact(
    'CARE_PLAN', NEW."patientId", NEW."createdAt", 'CARE_PLAN:' || NEW."id"
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION carepoint_analytics_questionnaire_insert()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM carepoint_emit_analytics_fact(
    'QUESTIONNAIRE', NEW."patientId", NEW."completedAt", 'QUESTIONNAIRE:' || NEW."id"
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION carepoint_analytics_lab_release()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_patient_id TEXT;
BEGIN
  IF NEW."status" = 'RELEASED'
     AND NEW."releasedAt" IS NOT NULL
     AND (
       TG_OP = 'INSERT'
       OR OLD."status" IS DISTINCT FROM NEW."status"
       OR OLD."releasedAt" IS DISTINCT FROM NEW."releasedAt"
     ) THEN
    SELECT "patientId" INTO v_patient_id
    FROM "ClinicalOrder"
    WHERE "id" = NEW."orderId";

    PERFORM carepoint_emit_analytics_fact(
      'LABORATORY_RESULT', v_patient_id, NEW."releasedAt", 'LABORATORY_RESULT:' || NEW."id"
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "AnalyticsFact_observation_insert"
AFTER INSERT ON "Observation"
FOR EACH ROW EXECUTE FUNCTION carepoint_analytics_observation_insert();

CREATE TRIGGER "AnalyticsFact_rpm_alert_insert"
AFTER INSERT ON "ClinicalAlert"
FOR EACH ROW EXECUTE FUNCTION carepoint_analytics_rpm_alert_insert();

CREATE TRIGGER "AnalyticsFact_care_plan_insert"
AFTER INSERT ON "CarePlan"
FOR EACH ROW EXECUTE FUNCTION carepoint_analytics_care_plan_insert();

CREATE TRIGGER "AnalyticsFact_questionnaire_insert"
AFTER INSERT ON "QuestionnaireResponse"
FOR EACH ROW EXECUTE FUNCTION carepoint_analytics_questionnaire_insert();

CREATE TRIGGER "AnalyticsFact_lab_release"
AFTER INSERT OR UPDATE OF "status","releasedAt" ON "LaboratoryResult"
FOR EACH ROW EXECUTE FUNCTION carepoint_analytics_lab_release();

-- One-time historical bootstrap. Direct identifiers are transformed before insertion and are never retained.
INSERT INTO "AnalyticsFact" ("id","sourceEventKey","schemaVersion","factType","subjectKey","occurredAt","month")
SELECT source_key, source_key, 1, fact_type, subject_key, occurred_at, date_trunc('month', occurred_at)
FROM (
  SELECT
    carepoint_analytics_hash('OBSERVATION:' || o."id") AS source_key,
    'OBSERVATION'::TEXT AS fact_type,
    carepoint_analytics_hash(o."patientId") AS subject_key,
    o."observedAt" AS occurred_at
  FROM "Observation" o

  UNION ALL

  SELECT
    carepoint_analytics_hash('RPM_ALERT:' || a."id"),
    'RPM_ALERT',
    carepoint_analytics_hash(a."patientId"),
    a."createdAt"
  FROM "ClinicalAlert" a

  UNION ALL

  SELECT
    carepoint_analytics_hash('CARE_PLAN:' || cp."id"),
    'CARE_PLAN',
    carepoint_analytics_hash(cp."patientId"),
    cp."createdAt"
  FROM "CarePlan" cp

  UNION ALL

  SELECT
    carepoint_analytics_hash('QUESTIONNAIRE:' || qr."id"),
    'QUESTIONNAIRE',
    carepoint_analytics_hash(qr."patientId"),
    qr."completedAt"
  FROM "QuestionnaireResponse" qr

  UNION ALL

  SELECT
    carepoint_analytics_hash('LABORATORY_RESULT:' || lr."id"),
    'LABORATORY_RESULT',
    carepoint_analytics_hash(co."patientId"),
    lr."releasedAt"
  FROM "LaboratoryResult" lr
  JOIN "ClinicalOrder" co ON co."id" = lr."orderId"
  WHERE lr."status" = 'RELEASED' AND lr."releasedAt" IS NOT NULL
) bootstrap(source_key, fact_type, subject_key, occurred_at)
ON CONFLICT ("sourceEventKey") DO NOTHING;

INSERT INTO "PopulationMetric" (
  "id","metricType","month","patientCount","eventCount","sourceWatermark","refreshedAt"
)
SELECT
  carepoint_analytics_hash('POPULATION:' || "factType" || ':' || "month"::TEXT),
  "factType",
  "month",
  COUNT(DISTINCT "subjectKey")::INTEGER,
  COUNT(*)::INTEGER,
  MAX("occurredAt"),
  CURRENT_TIMESTAMP
FROM "AnalyticsFact"
GROUP BY "factType","month"
ON CONFLICT ("metricType","month") DO UPDATE
SET "patientCount" = EXCLUDED."patientCount",
    "eventCount" = EXCLUDED."eventCount",
    "sourceWatermark" = EXCLUDED."sourceWatermark",
    "refreshedAt" = CURRENT_TIMESTAMP;

CREATE OR REPLACE FUNCTION carepoint_analytics_fact_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'AnalyticsFact is append-only';
END;
$$;

CREATE TRIGGER "AnalyticsFact_no_update"
BEFORE UPDATE ON "AnalyticsFact"
FOR EACH ROW EXECUTE FUNCTION carepoint_analytics_fact_immutable();

CREATE TRIGGER "AnalyticsFact_no_delete"
BEFORE DELETE ON "AnalyticsFact"
FOR EACH ROW EXECUTE FUNCTION carepoint_analytics_fact_immutable();

REVOKE UPDATE, DELETE ON "AnalyticsFact" FROM PUBLIC;
