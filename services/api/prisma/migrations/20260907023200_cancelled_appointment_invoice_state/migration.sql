CREATE OR REPLACE FUNCTION carepoint_void_unpaid_cancelled_invoice()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."status" = 'CANCELLED'::"AppointmentStatus" AND OLD."status" <> 'CANCELLED'::"AppointmentStatus" THEN
    UPDATE "Invoice"
    SET "status" = 'VOID'::"InvoiceStatus",
        "balanceDueMinor" = 0,
        "voidedAt" = CURRENT_TIMESTAMP,
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "appointmentId" = NEW."id"
      AND "amountPaidMinor" = 0
      AND "status" IN ('OPEN'::"InvoiceStatus", 'PARTIALLY_PAID'::"InvoiceStatus", 'PAID'::"InvoiceStatus");
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS carepoint_cancelled_appointment_invoice ON "Appointment";
CREATE TRIGGER carepoint_cancelled_appointment_invoice
AFTER UPDATE OF "status" ON "Appointment"
FOR EACH ROW
EXECUTE FUNCTION carepoint_void_unpaid_cancelled_invoice();
