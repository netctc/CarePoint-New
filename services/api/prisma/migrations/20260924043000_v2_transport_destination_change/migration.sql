-- CarePoint V2 PRV-086 — controlled transport destination revisions.
-- Existing TransportRouteRevision is already append-only / immutable; these columns preserve old + new destination.

ALTER TABLE "TransportRouteRevision"
  ADD COLUMN "previousDestinationLatitude" DECIMAL(9,6),
  ADD COLUMN "previousDestinationLongitude" DECIMAL(9,6),
  ADD COLUMN "previousDestinationAddress" TEXT,
  ADD COLUMN "destinationLatitude" DECIMAL(9,6),
  ADD COLUMN "destinationLongitude" DECIMAL(9,6),
  ADD COLUMN "destinationAddress" TEXT;

ALTER TABLE "TransportRouteRevision"
ADD CONSTRAINT "TransportRouteRevision_previous_destination_pair_check"
CHECK (
  ("previousDestinationLatitude" IS NULL AND "previousDestinationLongitude" IS NULL)
  OR ("previousDestinationLatitude" IS NOT NULL AND "previousDestinationLongitude" IS NOT NULL)
);

ALTER TABLE "TransportRouteRevision"
ADD CONSTRAINT "TransportRouteRevision_destination_pair_check"
CHECK (
  ("destinationLatitude" IS NULL AND "destinationLongitude" IS NULL)
  OR ("destinationLatitude" IS NOT NULL AND "destinationLongitude" IS NOT NULL)
);
