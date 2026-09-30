export type LaboratorySeriesPoint = {
  orderId: string;
  laboratoryResultId: string;
  display: string;
  codeSystem: string | null;
  code: string | null;
  value: string | number;
  unit: string | null;
  referenceRange: string | null;
  flag: string | null;
  status: "VALIDATED" | "RELEASED";
  validatedAt: string | Date | null;
  releasedAt: string | Date | null;
  observedAt: Date;
  orderingProviderId: string | null;
};

export type LaboratorySeries = {
  key: string;
  analyteKey: string;
  display: string;
  codeSystem: string | null;
  code: string | null;
  unit: string | null;
  points: LaboratorySeriesPoint[];
};

export type LaboratorySeriesProjection = {
  state: "READY" | "EMPTY";
  series: LaboratorySeries[];
  pointCount: number;
  automatedClinicalInference: false;
};

type JsonRecord = Record<string, unknown>;

export function buildLaboratorySeries(items: readonly unknown[]): LaboratorySeriesProjection {
  const groups = new Map<string, LaboratorySeries>();

  for (const candidate of items) {
    const order = record(candidate);
    if (!order || order.type !== "LABORATORY") continue;
    const orderId = text(order.id);
    if (!orderId) continue;

    const labResult = record(order.labResult);
    if (!labResult) continue;
    const status = labStatus(labResult.status);
    if (!status) continue;
    const laboratoryResultId = text(labResult.id);
    if (!laboratoryResultId) continue;

    const resultData = record(labResult.data);
    const observations = Array.isArray(resultData?.observations) ? resultData.observations : [];
    for (const rawObservation of observations) {
      const observation = record(rawObservation);
      if (!observation) continue;
      const display = text(observation.display);
      const value = scalarValue(observation.value);
      if (!display || value === null) continue;

      const codeSystem = text(observation.codeSystem);
      const code = text(observation.code);
      const unit = text(observation.unit);
      const referenceRange = text(observation.referenceRange);
      const flag = text(observation.flag);
      const analyteKey = comparableAnalyteKey(display, codeSystem, code);
      const unitKey = unit ? normalizeToken(unit) : "UNSPECIFIED";
      const key = `${analyteKey}|UNIT:${unitKey}`;
      const observedAt = resultTime(labResult, order);
      const point: LaboratorySeriesPoint = {
        orderId,
        laboratoryResultId,
        display,
        codeSystem,
        code,
        value,
        unit,
        referenceRange,
        flag,
        status,
        validatedAt: dateLike(labResult.validatedAt),
        releasedAt: dateLike(labResult.releasedAt),
        observedAt,
        orderingProviderId: text(order.providerId),
      };

      const existing = groups.get(key);
      if (existing) {
        existing.points.push(point);
      } else {
        groups.set(key, {
          key,
          analyteKey,
          display,
          codeSystem,
          code,
          unit,
          points: [point],
        });
      }
    }
  }

  const series = [...groups.values()]
    .map((item) => ({
      ...item,
      points: item.points.sort((left, right) =>
        left.observedAt.getTime() - right.observedAt.getTime()
        || left.laboratoryResultId.localeCompare(right.laboratoryResultId),
      ),
    }))
    .sort((left, right) =>
      left.analyteKey.localeCompare(right.analyteKey)
      || String(left.unit ?? "").localeCompare(String(right.unit ?? "")),
    );

  const pointCount = series.reduce((count, item) => count + item.points.length, 0);
  return {
    state: pointCount > 0 ? "READY" : "EMPTY",
    series,
    pointCount,
    automatedClinicalInference: false,
  };
}

export function comparableAnalyteKey(display: string, codeSystem: string | null, code: string | null): string {
  const normalizedCode = code ? normalizeToken(code) : null;
  if (normalizedCode) {
    return `CODE:${normalizeToken(codeSystem ?? "UNSPECIFIED")}|${normalizedCode}`;
  }
  return `DISPLAY:${normalizeDisplay(display)}`;
}

function resultTime(labResult: JsonRecord, order: JsonRecord): Date {
  for (const value of [labResult.releasedAt, labResult.validatedAt, order.completedAt, order.signedAt]) {
    const parsed = date(value);
    if (parsed) return parsed;
  }
  return new Date(0);
}

function labStatus(value: unknown): "VALIDATED" | "RELEASED" | null {
  return value === "VALIDATED" || value === "RELEASED" ? value : null;
}

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function scalarValue(value: unknown): string | number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized ? normalized : null;
  }
  return null;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function dateLike(value: unknown): string | Date | null {
  return value instanceof Date || typeof value === "string" ? value : null;
}

function date(value: unknown): Date | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function normalizeToken(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, "_");
}

function normalizeDisplay(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, " ");
}
