import { BadRequestException } from "@nestjs/common";

export interface ConversionRule {
  fromUnitCode: string;
  toUnitCode: string;
  multiplier: number;
  offset: number;
}

export interface NormalizedMeasurement {
  originalValue: number;
  originalUnitCode: string;
  canonicalValue: number;
  canonicalUnitCode: string;
}

export type GlucoseContext = "FASTING" | "PREPRANDIAL" | "POSTPRANDIAL" | "RANDOM";

const GLUCOSE_CONTEXTS = new Set<GlucoseContext>([
  "FASTING",
  "PREPRANDIAL",
  "POSTPRANDIAL",
  "RANDOM",
]);

export function normalizeUnitCode(value: unknown): string {
  if (typeof value !== "string") throw new BadRequestException("unitCode is required.");
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_/%.-]{0,31}$/.test(normalized)) {
    throw new BadRequestException("unitCode is invalid.");
  }
  return normalized;
}

export function normalizeMetricCode(value: unknown): string {
  if (typeof value !== "string") throw new BadRequestException("metric code is required.");
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{2,79}$/.test(normalized)) {
    throw new BadRequestException("metric code is invalid.");
  }
  return normalized;
}

export function isGlucoseMetricCode(value: unknown): boolean {
  const code = normalizeMetricCode(value);
  return code === "GLUCOSE"
    || code.startsWith("GLUCOSE_")
    || code.endsWith("_GLUCOSE")
    || code.includes("_GLUCOSE_");
}

export function normalizeGlucoseContext(metricCode: unknown, value: unknown): GlucoseContext | null {
  const glucose = isGlucoseMetricCode(metricCode);
  if (value === undefined || value === null || value === "") {
    if (glucose) throw new BadRequestException("glucoseContext is required for glucose observations.");
    return null;
  }
  if (!glucose) throw new BadRequestException("glucoseContext is only valid for glucose observations.");
  if (typeof value !== "string") throw new BadRequestException("glucoseContext is invalid.");
  const normalized = value.trim().toUpperCase() as GlucoseContext;
  if (!GLUCOSE_CONTEXTS.has(normalized)) {
    throw new BadRequestException(
      "glucoseContext must be FASTING, PREPRANDIAL, POSTPRANDIAL, or RANDOM.",
    );
  }
  return normalized;
}

export function convertMeasurement(
  rawValue: unknown,
  fromUnitCode: string,
  canonicalUnitCode: string,
  precision: number,
  conversions: readonly ConversionRule[],
): NormalizedMeasurement {
  if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) {
    throw new BadRequestException("measurement value must be a finite number.");
  }
  if (!Number.isInteger(precision) || precision < 0 || precision > 6) {
    throw new BadRequestException("measurement precision must be between 0 and 6.");
  }

  const from = normalizeUnitCode(fromUnitCode);
  const canonical = normalizeUnitCode(canonicalUnitCode);
  let converted = rawValue;

  if (from !== canonical) {
    const direct = conversions.find((item) => item.fromUnitCode === from && item.toUnitCode === canonical);
    if (direct) {
      converted = rawValue * direct.multiplier + direct.offset;
    } else {
      const reverse = conversions.find((item) => item.fromUnitCode === canonical && item.toUnitCode === from);
      if (!reverse || reverse.multiplier === 0) {
        throw new BadRequestException(`No active conversion exists from ${from} to ${canonical}.`);
      }
      converted = (rawValue - reverse.offset) / reverse.multiplier;
    }
  }

  const factor = 10 ** precision;
  const canonicalValue = Math.round((converted + Number.EPSILON) * factor) / factor;
  return {
    originalValue: rawValue,
    originalUnitCode: from,
    canonicalValue,
    canonicalUnitCode: canonical,
  };
}

export function assertCanonicalRange(
  value: number,
  minCanonical: number | null | undefined,
  maxCanonical: number | null | undefined,
): void {
  if (minCanonical != null && value < minCanonical) {
    throw new BadRequestException("measurement is below the configured clinical range.");
  }
  if (maxCanonical != null && value > maxCanonical) {
    throw new BadRequestException("measurement is above the configured clinical range.");
  }
}

export function calculateBmi(weightKg: number, heightCm: number): number {
  if (!Number.isFinite(weightKg) || weightKg <= 0 || weightKg > 500) {
    throw new BadRequestException("weightKg is invalid.");
  }
  if (!Number.isFinite(heightCm) || heightCm < 30 || heightCm > 300) {
    throw new BadRequestException("heightCm is invalid.");
  }
  const meters = heightCm / 100;
  return Math.round((weightKg / (meters * meters)) * 10) / 10;
}

export function normalizeObservedAt(value: unknown, now = new Date()): Date {
  if (typeof value !== "string" || value.length < 20 || value.length > 40) {
    throw new BadRequestException("observedAt must be an ISO timestamp.");
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new BadRequestException("observedAt must be an ISO timestamp.");
  if (parsed.getTime() > now.getTime() + 5 * 60 * 1000) {
    throw new BadRequestException("observedAt cannot be more than five minutes in the future.");
  }
  return parsed;
}
