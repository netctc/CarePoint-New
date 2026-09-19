-- CarePoint V2 / ADM-107.
-- Backfill newly explicit capability arrays without weakening existing category restrictions.

UPDATE "ProviderCategory"
SET "capabilities" = jsonb_set(
  COALESCE("capabilities", '{}'::jsonb),
  '{clinicalReadCapabilities}',
  '[]'::jsonb,
  true
)
WHERE NOT (COALESCE("capabilities", '{}'::jsonb) ? 'clinicalReadCapabilities');

UPDATE "ProviderCategory"
SET "capabilities" = jsonb_set(
  COALESCE("capabilities", '{}'::jsonb),
  '{workflowCapabilities}',
  CASE
    WHEN "family" IN ('MEDICAL_TRANSPORT_GROUND', 'MEDICAL_TRANSPORT_AIR') THEN '["TRANSPORT"]'::jsonb
    WHEN COALESCE("capabilities" -> 'enabledModalities', '[]'::jsonb) ? 'HOME_VISIT' THEN '["HOME_VISIT"]'::jsonb
    ELSE '[]'::jsonb
  END,
  true
)
WHERE NOT (COALESCE("capabilities", '{}'::jsonb) ? 'workflowCapabilities');
