import { BadRequestException } from "@nestjs/common";

export type ClinicalProfileEntryKind = "ALLERGY" | "CONDITION" | "PROCEDURE" | "MEDICATION";
export type ClinicalProfileEntryStatus = "ACTIVE" | "RESOLVED" | "INACTIVE";

export type ClinicalProfilePayload =
  | { kind: "ALLERGY"; classification?: "ALLERGY" | "INTOLERANCE"; substance: string; reaction?: string; severity?: "MILD" | "MODERATE" | "SEVERE" | "UNKNOWN"; onsetDate?: string }
  | { kind: "CONDITION"; display: string; codeSystem?: string; code?: string; clinicalStatus?: "ACTIVE" | "RESOLVED" | "REMISSION" | "INACTIVE" | "UNKNOWN"; onsetDate?: string }
  | { kind: "PROCEDURE"; display: string; performedDate?: string; facility?: string }
  | { kind: "MEDICATION"; name: string; dose?: string; route?: string; frequency?: string; medicationStatus?: "ACTIVE" | "STOPPED" | "COMPLETED" | "UNKNOWN"; startedOn?: string; endedOn?: string };

const KINDS = new Set<ClinicalProfileEntryKind>(["ALLERGY", "CONDITION", "PROCEDURE", "MEDICATION"]);
const STATUSES = new Set<ClinicalProfileEntryStatus>(["ACTIVE", "RESOLVED", "INACTIVE"]);

export function normalizeClinicalProfileKind(value: unknown): ClinicalProfileEntryKind {
  if (typeof value !== "string") throw new BadRequestException("clinical profile entry kind is required.");
  const normalized = value.trim().toUpperCase() as ClinicalProfileEntryKind;
  if (!KINDS.has(normalized)) throw new BadRequestException("Unsupported clinical profile entry kind.");
  return normalized;
}

export function normalizeClinicalProfileStatus(value: unknown): ClinicalProfileEntryStatus {
  if (value === undefined || value === null || value === "") return "ACTIVE";
  if (typeof value !== "string") throw new BadRequestException("clinical profile entry status is invalid.");
  const normalized = value.trim().toUpperCase() as ClinicalProfileEntryStatus;
  if (!STATUSES.has(normalized)) throw new BadRequestException("Unsupported clinical profile entry status.");
  return normalized;
}

export function normalizeClinicalProfilePayload(
  kind: ClinicalProfileEntryKind,
  input: unknown,
  existing?: ClinicalProfilePayload | null,
): ClinicalProfilePayload {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new BadRequestException("clinical profile entry data must be an object.");
  }
  const raw = input as Record<string, unknown>;
  const base = existing && existing.kind === kind ? existing : ({ kind } as ClinicalProfilePayload);
  const merged = { ...base, ...raw, kind } as Record<string, unknown>;

  if (kind === "ALLERGY") {
    rejectUnknown(raw, ["classification", "substance", "reaction", "severity", "onsetDate"]);
    return compact({
      kind,
      classification: optionalEnum(merged.classification ?? "ALLERGY", ["ALLERGY", "INTOLERANCE"], "classification"),
      substance: requiredText(merged.substance, "substance", 200),
      reaction: optionalText(merged.reaction, "reaction", 500),
      severity: optionalEnum(merged.severity, ["MILD", "MODERATE", "SEVERE", "UNKNOWN"], "severity"),
      onsetDate: optionalDate(merged.onsetDate, "onsetDate"),
    }) as ClinicalProfilePayload;
  }

  if (kind === "CONDITION") {
    rejectUnknown(raw, ["display", "codeSystem", "code", "clinicalStatus", "onsetDate"]);
    return compact({
      kind,
      display: requiredText(merged.display, "display", 300),
      codeSystem: optionalText(merged.codeSystem, "codeSystem", 200),
      code: optionalText(merged.code, "code", 100),
      clinicalStatus: optionalEnum(merged.clinicalStatus, ["ACTIVE", "RESOLVED", "REMISSION", "INACTIVE", "UNKNOWN"], "clinicalStatus"),
      onsetDate: optionalDate(merged.onsetDate, "onsetDate"),
    }) as ClinicalProfilePayload;
  }

  if (kind === "PROCEDURE") {
    rejectUnknown(raw, ["display", "performedDate", "facility"]);
    return compact({
      kind,
      display: requiredText(merged.display, "display", 300),
      performedDate: optionalDate(merged.performedDate, "performedDate"),
      facility: optionalText(merged.facility, "facility", 300),
    }) as ClinicalProfilePayload;
  }

  rejectUnknown(raw, ["name", "dose", "route", "frequency", "medicationStatus", "startedOn", "endedOn"]);
  return compact({
    kind,
    name: requiredText(merged.name, "name", 300),
    dose: optionalText(merged.dose, "dose", 120),
    route: optionalText(merged.route, "route", 120),
    frequency: optionalText(merged.frequency, "frequency", 120),
    medicationStatus: optionalEnum(merged.medicationStatus, ["ACTIVE", "STOPPED", "COMPLETED", "UNKNOWN"], "medicationStatus"),
    startedOn: optionalDate(merged.startedOn, "startedOn"),
    endedOn: optionalDate(merged.endedOn, "endedOn"),
  }) as ClinicalProfilePayload;
}

export function changedClinicalProfileFields(
  previous: ClinicalProfilePayload,
  current: ClinicalProfilePayload,
): string[] {
  const keys = new Set([...Object.keys(previous), ...Object.keys(current)]);
  keys.delete("kind");
  return [...keys].filter((key) => JSON.stringify((previous as any)[key] ?? null) !== JSON.stringify((current as any)[key] ?? null)).sort();
}

function rejectUnknown(input: Record<string, unknown>, allowed: string[]): void {
  const set = new Set(allowed);
  for (const key of Object.keys(input)) {
    if (!set.has(key)) throw new BadRequestException(`Unsupported clinical profile field '${key}'.`);
  }
}

function requiredText(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") throw new BadRequestException(`${field} is required.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > max || /\p{Cc}/u.test(normalized)) {
    throw new BadRequestException(`${field} is invalid.`);
  }
  return normalized;
}

function optionalText(value: unknown, field: string, max: number): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return requiredText(value, field, max);
}

function optionalEnum<T extends string>(value: unknown, allowed: readonly T[], field: string): T | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new BadRequestException(`${field} is invalid.`);
  const normalized = value.trim().toUpperCase() as T;
  if (!allowed.includes(normalized)) throw new BadRequestException(`${field} is invalid.`);
  return normalized;
}

function optionalDate(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException(`${field} must use YYYY-MM-DD.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new BadRequestException(`${field} is invalid.`);
  }
  return value;
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
