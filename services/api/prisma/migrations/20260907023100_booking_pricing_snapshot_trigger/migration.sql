-- Freeze service pricing at appointment creation time without coupling the scheduling module to billing code.
-- Legacy/test appointments without a matching ServiceModality are intentionally left without a financial snapshot.

CREATE OR REPLACE FUNCTION carepoint_snapshot_appointment_pricing()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_price INTEGER;
  v_currency TEXT;
  v_service_name TEXT;
  v_snapshot_id TEXT;
  v_invoice_id TEXT;
  v_invoice_number TEXT;
BEGIN
  SELECT sm."priceMinor", s."currency", s."name"
    INTO v_price, v_currency, v_service_name
  FROM "ServiceModality" sm
  JOIN "Service" s ON s."id" = sm."serviceId"
  WHERE sm."serviceId" = NEW."serviceId"
    AND sm."modality" = NEW."modality"
    AND sm."active" = TRUE
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  v_snapshot_id := 'price-' || NEW."id";
  v_invoice_id := 'invoice-' || NEW."id";
  v_invoice_number := 'INV-' || to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYYMMDD') || '-' || upper(substr(replace(NEW."id", '-', ''), 1, 10));

  INSERT INTO "PricingSnapshot" (
    "id", "appointmentId", "patientId", "providerId", "serviceId", "modality",
    "serviceName", "currency", "unitPriceMinor", "discountMinor", "taxMinor", "totalMinor", "createdAt"
  ) VALUES (
    v_snapshot_id, NEW."id", NEW."patientId", NEW."providerId", NEW."serviceId", NEW."modality",
    v_service_name, v_currency, v_price, 0, 0, v_price, CURRENT_TIMESTAMP
  );

  INSERT INTO "Invoice" (
    "id", "number", "appointmentId", "pricingSnapshotId", "patientId", "providerId", "currency",
    "totalMinor", "patientResponsibilityMinor", "insurerResponsibilityMinor", "amountPaidMinor",
    "amountRefundedMinor", "balanceDueMinor", "status", "issuedAt", "updatedAt"
  ) VALUES (
    v_invoice_id, v_invoice_number, NEW."id", v_snapshot_id, NEW."patientId", NEW."providerId", v_currency,
    v_price, v_price, 0, 0, 0, v_price,
    CASE WHEN v_price = 0 THEN 'PAID'::"InvoiceStatus" ELSE 'OPEN'::"InvoiceStatus" END,
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS carepoint_appointment_pricing_snapshot ON "Appointment";
CREATE TRIGGER carepoint_appointment_pricing_snapshot
AFTER INSERT ON "Appointment"
FOR EACH ROW
EXECUTE FUNCTION carepoint_snapshot_appointment_pricing();
