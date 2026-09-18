import { BadRequestException } from "@nestjs/common";

export type ClinicalFactKind = "ALLERGY" | "PROBLEM" | "MEDICATION" | "PROCEDURE";
export type VerificationStatus = "PATIENT_DECLARED" | "VERIFIED" | "NEEDS_REVIEW";
export type ReconciliationStatus = "UNRECONCILED" | "CONFIRMED" | "NOT_TAKING" | "NEEDS_REVIEW";

export type ClinicalFactPayload = Record<string, unknown>;

const FACT_KINDS = new Set<ClinicalFactKind>(["ALLERGY", "PROBLEM", "MEDICATION", "PROCEDURE"]);
const STRUCTURED_CODE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/;

export function normalizeClinicalFactKind(value: unknown): ClinicalFactKind {
  if (typeof value !== "string") throw new BadRequestException("kind is required.");
  const normalized = value.trim().toUpperCase() as ClinicalFactKind;
  if (!FACT_KINDS.has(normalized)) throw new BadRequestException("Unsupported clinical fact kind.");
  return normalized;
}

export function normalizeClinicalFactPayload(kind: ClinicalFactKind, input: unknown): ClinicalFactPayload {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new BadRequestException("data must be an object.");
  }
  const raw = input as Record<string, unknown>;
  const allowedByKind: Record<ClinicalFactKind, Set<string>> = {
    ALLERGY: new Set(["label", "code", "category", "reaction", "severity"]),
    PROBLEM: new Set(["label", "code", "onsetDate", "clinicalStatus"]),
    MEDICATION: new Set(["name", "code", "strength", "form", "route", "schedule"]),
    PROCEDURE: new Set(["label", "code", "occurredDate"]),
  };
  for (const key of Object.keys(raw)) {
    if (!allowedByKind[kind].has(key)) throw new BadRequestException(`Unsupported ${kind} field '${key}'.`);
  }

  if (kind === "MEDICATION") {
    const result: ClinicalFactPayload = {
      name: requiredText(raw.name, "name", 200),
    };
    optionalToken(result, "code", raw.code);
    optionalText(result, "strength", raw.strength, 120);
    optionalText(result, "form", raw.form, 80);
    optionalText(result, "route", raw.route, 80);
    optionalText(result, "schedule", raw.schedule, 240);
    return result;
  }

  const result: ClinicalFactPayload = {
    label: requiredText(raw.label, "label", 200),
  };
  optionalToken(result, "code", raw.code);

  if (kind === "ALLERGY") {
    optionalEnum(result, "category", raw.category, ["FOOD", "MEDICATION", "ENVIRONMENT", "OTHER", "UNKNOWN"]);
    optionalText(result, "reaction", raw.reaction, 500);
    optionalEnum(result, "severity", raw.severity, ["MILD", "MODERATE", "SEVERE", "UNKNOWN"]);
  } else if (kind === "PROBLEM") {
    optionalDate(result, "onsetDate", raw.onsetDate);
    optionalEnum(result, "clinicalStatus", raw.clinicalStatus, ["ACTIVE", "RESOLVED", "REMISSION", "UNKNOWN"]);
  } else if (kind === "PROCEDURE") {
    optionalDate(result, "occurredDate", raw.occurredDate);
  }
  return result;
}

export function mergeClinicalFactPayload(
  kind: ClinicalFactKind,
  current: ClinicalFactPayload,
  patch: unknown,
): { payload: ClinicalFactPayload; changedFields: string[] } {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new BadRequestException("data must be an object.");
  }
  const normalizedPatch = normalizePartial(kind, patch as Record<string, unknown>);
  const next = { ...current, ...normalizedPatch };
  const validated = normalizeClinicalFactPayload(kind, next);
  const changedFields = Object.keys(validated)
    .filter((key) => JSON.stringify(current[key] ?? null) !== JSON.stringify(validated[key] ?? null))
    .sort();
  return { payload: validated, changedFields };
}

export function normalizeDoctorVerification(value: unknown): Exclude<VerificationStatus, "PATIENT_DECLARED"> {
  if (typeof value !== "string") throw new BadRequestException("verificationStatus is required.");
  const normalized = value.trim().toUpperCase();
  if (normalized !== "VERIFIED" && normalized !== "NEEDS_REVIEW") {
    throw new BadRequestException("verificationStatus must be VERIFIED or NEEDS_REVIEW.");
  }
  return normalized;
}

export function normalizeMedicationReconciliation(value: unknown): Exclude<ReconciliationStatus, "UNRECONCILED"> {
  if (typeof value !== "string") throw new BadRequestException("reconciliationStatus is required.");
  const normalized = value.trim().toUpperCase();
  if (!["CONFIRMED", "NOT_TAKING", "NEEDS_REVIEW"].includes(normalized)) {
    throw new BadRequestException("Unsupported reconciliationStatus.");
  }
  return normalized as Exclude<ReconciliationStatus, "UNRECONCILED">;
}

function normalizePartial(kind: ClinicalFactKind, raw: Record<string, unknown>): ClinicalFactPayload {
  const output: ClinicalFactPayload = {};
  if (kind === "MEDICATION") {
    if ("name" in raw) output.name = requiredText(raw.name, "name", 200);
    if ("code" in raw) optionalToken(output, "code", raw.code);
    if ("strength" in raw) optionalText(output, "strength", raw.strength, 120);
    if ("form" in raw) optionalText(output, "form", raw.form, 80);
    if ("route" in raw) optionalText(output, "route", raw.route, 80);
    if ("schedule" in raw) optionalText(output, "schedule", raw.schedule, 240);
  } else {
    if ("label" in raw) output.label = requiredText(raw.label, "label", 200);
    if ("code" in raw) optionalToken(output, "code", raw.code);
    if (kind === "ALLERGY") {
      if ("category" in raw) optionalEnum(output, "category", raw.category, ["FOOD", "MEDICATION", "ENVIRONMENT", "OTHER", "UNKNOWN"]);
      if ("reaction" in raw) optionalText(output, "reaction", raw.reaction, 500);
      if ("severity" in raw) optionalEnum(output, "severity", raw.severity, ["MILD", "MODERATE", "SEVERE", "UNKNOWN"]);
    }
    if (kind === "PROBLEM") {
      if ("onsetDate" in raw) optionalDate(output, "onsetDate", raw.onsetDate);
      if ("clinicalStatus" in raw) optionalEnum(output, "clinicalStatus", raw.clinicalStatus, ["ACTIVE", "RESOLVED", "REMISSION", "UNKNOWN"]);
    }
    if (kind === "PROCEDURE" && "occurredDate" in raw) optionalDate(output, "occurredDate", raw.occurredDate);
  }
  if (Object.keys(output).length === 0) throw new BadRequestException("At least one supported field is required.");
  return output;
}

function requiredText(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") throw new BadRequestException(`${field} is required.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > max || /\p{Cc}/u.test(normalized)) {
    throw new BadRequestException(`${field} is invalid.`);
  }
  return normalized;
}

function optionalText(target: ClinicalFactPayload, key: string, value: unknown, max: number): void {
  if (value === undefined) return;
  if (value === null || value === "") {
    target[key] = null;
    return;
  }
  if (typeof value !== "string") throw new BadRequestException(`${key} must be text or null.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > max || /\p{Cc}/u.test(normalized)) throw new BadRequestException(`${key} is invalid.`);
  target[key] = normalized;
}

function optionalToken(target: ClinicalFactPayload, key: string, value: unknown): void {
  if (value === undefined) return;
  if (value === null || value === "") {
    target[key] = null;
    return;
  }
  if (typeof value !== "string" || !STRUCTURED_CODE.test(value.trim())) throw new BadRequestException(`${key} is invalid.`);
  target[key] = value.trim();
}

function optionalEnum(target: ClinicalFactPayload, key: string, value: unknown, allowed: readonly string[]): void {
  if (value === undefined) return;
  if (value === null || value === "") {
    target[key] = null;
    return;
  }
  if (typeof value !== "string") throw new BadRequestException(`${key} is invalid.`);
  const normalized = value.trim().toUpperCase();
  if (!allowed.includes(normalized)) throw new BadRequestException(`${key} is invalid.`);
  target[key] = normalized;
}

function optionalDate(target: ClinicalFactPayload, key: string, value: unknown): void {
  if (value === undefined) return;
  if (value === null || value === "") {
    target[key] = null;
    return;
  }
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException(`${key} must use YYYY-MM-DD.`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new BadRequestException(`${key} is invalid.`);
  }
  target[key] = value;
}
