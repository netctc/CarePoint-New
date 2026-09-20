export type TrendSourceType = "MANUAL" | "DEVICE" | "PROVIDER";

export type TrendObservation = {
  id: string;
  observedAt: Date | string;
  value: number;
  unitCode: string;
  canonicalValue: number;
  canonicalUnitCode: string;
  sourceType: string;
  sourceId: string | null;
  verificationStatus: string;
};

export function normalizeTrendSourceType(value: unknown): TrendSourceType | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new Error("sourceType is invalid.");
  const normalized = value.trim().toUpperCase();
  if (!new Set(["MANUAL", "DEVICE", "PROVIDER"]).has(normalized)) {
    throw new Error("sourceType must be MANUAL, DEVICE or PROVIDER.");
  }
  return normalized as TrendSourceType;
}

export function buildObservationTrend(items: TrendObservation[], sourceType: TrendSourceType | null = null) {
  const filtered = items
    .filter((item) => !sourceType || item.sourceType === sourceType)
    .map((item) => ({ ...item, observedAt: new Date(item.observedAt) }))
    .sort((left, right) => left.observedAt.getTime() - right.observedAt.getTime());

  const groups = new Map<string, typeof filtered>();
  for (const item of filtered) {
    const bucket = groups.get(item.canonicalUnitCode) ?? [];
    bucket.push(item);
    groups.set(item.canonicalUnitCode, bucket);
  }

  const series = [...groups.entries()].flatMap(([canonicalUnitCode, points]) => {
    const first = points.at(0);
    const last = points.at(-1);
    if (!first || !last) return [];
    const values = points.map((point) => point.canonicalValue);
    return [{
      canonicalUnitCode,
      count: points.length,
      minimum: Math.min(...values),
      maximum: Math.max(...values),
      average: round(values.reduce((sum, value) => sum + value, 0) / values.length),
      firstObservedAt: first.observedAt,
      lastObservedAt: last.observedAt,
      points: points.map((point) => ({
        observationId: point.id,
        observedAt: point.observedAt,
        canonicalValue: point.canonicalValue,
        canonicalUnitCode: point.canonicalUnitCode,
        sourceType: point.sourceType,
      })),
    }];
  });

  return {
    state: filtered.length > 0 ? "READY" as const : "EMPTY" as const,
    sourceType,
    unitConsistency: series.length <= 1,
    series,
    table: filtered.map((item) => ({
      observationId: item.id,
      observedAt: item.observedAt,
      value: item.value,
      unitCode: item.unitCode,
      canonicalValue: item.canonicalValue,
      canonicalUnitCode: item.canonicalUnitCode,
      sourceType: item.sourceType,
      sourceId: item.sourceId,
      verificationStatus: item.verificationStatus,
    })),
    automatedDiagnosis: false,
  };
}

function round(value: number) {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}
