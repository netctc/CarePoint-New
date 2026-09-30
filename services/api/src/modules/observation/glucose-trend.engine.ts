import { BadRequestException } from "@nestjs/common";
import { isGlucoseMetricCode, normalizeMetricCode } from "./observation.engine";

export type MedicationOverlayEvent = {
  kind: "MEDICATION_STATEMENT" | "PRESCRIPTION_SIGNED" | "PRESCRIPTION_CANCELLED" | "PRESCRIPTION_COMPLETED";
  sourceId: string;
  detailTarget: string;
  occurredAt: Date;
  status: string | null;
  label: string | null;
  sourceType: string | null;
  verificationStatus: string | null;
};

type JsonRecord = Record<string, unknown>;

export function normalizeGlucoseMetricSelection(value: unknown): string {
  const code = normalizeMetricCode(value);
  if (!isGlucoseMetricCode(code)) {
    throw new BadRequestException("code must identify a glucose observation metric.");
  }
  return code;
}

export function buildMedicationStatementEvents(items: readonly unknown[]): MedicationOverlayEvent[] {
  const events: MedicationOverlayEvent[] = [];
  for (const candidate of items) {
    const item = record(candidate);
    if (!item || item.kind !== "MEDICATION") continue;
    const sourceId = text(item.id);
    const provenance = record(item.provenance);
    const occurredAt = date(provenance?.updatedAt) ?? date(provenance?.recordedAt);
    if (!sourceId || !occurredAt) continue;
    const data = record(item.data);
    events.push({
      kind: "MEDICATION_STATEMENT",
      sourceId,
      detailTarget: `/provider/clinical-profile/medications/${encodeURIComponent(sourceId)}`,
      occurredAt,
      status: text(data?.medicationStatus) ?? text(item.status),
      label: text(data?.name),
      sourceType: text(provenance?.sourceType),
      verificationStatus: text(item.verificationStatus),
    });
  }
  return sortEvents(events);
}

export function buildPrescriptionEvents(items: readonly unknown[]): MedicationOverlayEvent[] {
  const events: MedicationOverlayEvent[] = [];
  for (const candidate of items) {
    const order = record(candidate);
    if (!order || order.type !== "PRESCRIPTION") continue;
    const sourceId = text(order.id);
    if (!sourceId) continue;
    const data = record(order.data);
    const medication = record(data?.medication);
    const label = text(medication?.name);
    const detailTarget = `/provider/clinical-orders/${encodeURIComponent(sourceId)}`;
    const status = text(order.status);
    const signedAt = date(order.signedAt);
    if (signedAt) {
      events.push({
        kind: "PRESCRIPTION_SIGNED",
        sourceId,
        detailTarget,
        occurredAt: signedAt,
        status,
        label,
        sourceType: "CAREPOINT_PRESCRIPTION",
        verificationStatus: "SIGNED",
      });
    }
    const cancelledAt = date(order.cancelledAt);
    if (cancelledAt) {
      events.push({
        kind: "PRESCRIPTION_CANCELLED",
        sourceId,
        detailTarget,
        occurredAt: cancelledAt,
        status,
        label,
        sourceType: "CAREPOINT_PRESCRIPTION",
        verificationStatus: "SIGNED",
      });
    }
    const completedAt = date(order.completedAt);
    if (completedAt) {
      events.push({
        kind: "PRESCRIPTION_COMPLETED",
        sourceId,
        detailTarget,
        occurredAt: completedAt,
        status,
        label,
        sourceType: "CAREPOINT_PRESCRIPTION",
        verificationStatus: "SIGNED",
      });
    }
  }
  return sortEvents(events);
}

function sortEvents(events: MedicationOverlayEvent[]) {
  return events.sort((left, right) =>
    left.occurredAt.getTime() - right.occurredAt.getTime()
    || left.sourceId.localeCompare(right.sourceId)
    || left.kind.localeCompare(right.kind),
  );
}

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function date(value: unknown): Date | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}
