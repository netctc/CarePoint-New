-- Slice 6 hardening before release:
-- 1. Derive invoice and receipt numbers from the complete UUID to make uniqueness deterministic.
-- 2. Prevent a partial refund from presenting an invoice as fully REFUNDED.

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
  v_invoice_number := 'INV-' || to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYYMMDD') || '-' || upper(replace(NEW."id", '-', ''));

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

CREATE OR REPLACE FUNCTION carepoint_receipt_number_from_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."number" := 'RCT-' || to_char(COALESCE(NEW."issuedAt", CURRENT_TIMESTAMP) AT TIME ZONE 'UTC', 'YYYYMMDD') || '-' || upper(replace(NEW."paymentIntentId", '-', ''));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS carepoint_receipt_identifier ON "PaymentReceipt";
CREATE TRIGGER carepoint_receipt_identifier
BEFORE INSERT ON "PaymentReceipt"
FOR EACH ROW
EXECUTE FUNCTION carepoint_receipt_number_from_payment();

CREATE OR REPLACE FUNCTION carepoint_guard_partial_refund_status()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."status" = 'REFUNDED'::"InvoiceStatus"
     AND NEW."amountRefundedMinor" < NEW."amountPaidMinor" THEN
    IF OLD."status" IN ('OPEN'::"InvoiceStatus", 'PARTIALLY_PAID'::"InvoiceStatus", 'PAID'::"InvoiceStatus") THEN
      NEW."status" := OLD."status";
    ELSIF NEW."balanceDueMinor" = 0 THEN
      NEW."status" := 'PAID'::"InvoiceStatus";
    ELSE
      NEW."status" := 'PARTIALLY_PAID'::"InvoiceStatus";
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS carepoint_partial_refund_invoice_guard ON "Invoice";
CREATE TRIGGER carepoint_partial_refund_invoice_guard
BEFORE UPDATE OF "status", "amountRefundedMinor" ON "Invoice"
FOR EACH ROW
EXECUTE FUNCTION carepoint_guard_partial_refund_status();
