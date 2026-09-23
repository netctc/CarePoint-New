import { BadRequestException } from "@nestjs/common";

export type ClinicalProfileEntryKind =
  | "ALLERGY"
  | "CONDITION"
  | "PROCEDURE"
  | "MEDICATION"
  | "IMPLANT_DEVICE"
  | "FAMILY_HISTORY"
  | "REPRODUCTIVE_HEALTH";
export type ClinicalProfileEntryStatus = "ACTIVE" | "RESOLVED" | "INACTIVE";

export type ClinicalProfilePayload =
  | { kind: "ALLERGY"; substance: string; reaction?: string; severity?: "MILD" | "MODERATE" | "SEVERE" | "UNKNOWN"; onsetDate?: string }
  | { kind: "CONDITION"; display: string; codeSystem?: string; code?: string; clinicalStatus?: "ACTIVE" | "RESOLVED" | "REMISSION" | "INACTIVE" | "UNKNOWN"; onsetDate?: string }
  | { kind: "PROCEDURE"; display: string; performedDate?: string; facility?: string }
  | { kind: "MEDICATION"; name: string; dose?: string; route?: string; frequency?: string; medicationStatus?: "ACTIVE" | "STOPPED" | "COMPLETED" | "UNKNOWN"; startedOn?: string; endedOn?: string }
  | { kind: "IMPLANT_DEVICE"; display: string; deviceType?: string; implantedOn?: string; facility?: string; notes?: string; deviceStatus: "ACTIVE" | "RETIRED"; retiredOn?: string }
  | { kind: "FAMILY_HISTORY"; relationship: "PARENT" | "SIBLING" | "CHILD" | "GRANDPARENT" | "OTHER"; conditionDisplay: string; codeSystem?: string; code?: string; notes?: string }
  | { kind: "REPRODUCTIVE_HEALTH"; pregnancyStatus?: "PREGNANT" | "NOT_PREGNANT" | "UNKNOWN"; lactating?: boolean; gravida?: number; para?: number; effectiveDate?: string; notes?: string };

const KINDS = new Set<ClinicalProfileEntryKind>([
  "ALLERGY", "CONDITION", "PROCEDURE", "MEDICATION",
  "IMPLANT_DEVICE", "FAMILY_HISTORY", "REPRODUCTIVE_HEALTH",
]);
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
    rejectUnknown(raw, ["substance", "reaction", "severity", "onsetDate"]);
    return compact({
      kind,
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

  if (kind === "MEDICATION") {
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

  if (kind === "IMPLANT_DEVICE") {
    rejectUnknown(raw, ["display", "deviceType", "implantedOn", "facility", "notes", "deviceStatus", "retiredOn"]);
    const deviceStatus = optionalEnum(merged.deviceStatus, ["ACTIVE", "RETIRED"], "deviceStatus") ?? "ACTIVE";
    const implantedOn = optionalDate(merged.implantedOn, "implantedOn");
    const retiredOn = optionalDate(merged.retiredOn, "retiredOn");
    if (retiredOn && deviceStatus !== "RETIRED") throw new BadRequestException("retiredOn requires deviceStatus RETIRED.");
    if (implantedOn && retiredOn && retiredOn < implantedOn) throw new BadRequestException("retiredOn cannot be before implantedOn.");
    return compact({
      kind,
      display: requiredText(merged.display, "display", 300),
      deviceType: optionalText(merged.deviceType, "deviceType", 160),
      implantedOn,
      facility: optionalText(merged.facility, "facility", 300),
      notes: optionalText(merged.notes, "notes", 1000),
      deviceStatus,
      retiredOn,
    }) as ClinicalProfilePayload;
  }

  if (kind === "FAMILY_HISTORY") {
    rejectUnknown(raw, ["relationship", "conditionDisplay", "codeSystem", "code", "notes"]);
    const relationship = optionalEnum(merged.relationship, ["PARENT", "SIBLING", "CHILD", "GRANDPARENT", "OTHER"], "relationship");
    if (!relationship) throw new BadRequestException("relationship is required.");
    return compact({
      kind,
      relationship,
      conditionDisplay: requiredText(merged.conditionDisplay, "conditionDisplay", 300),
      codeSystem: optionalText(merged.codeSystem, "codeSystem", 160),
      code: optionalText(merged.code, "code", 100),
      notes: optionalText(merged.notes, "notes", 1000),
    }) as ClinicalProfilePayload;
  }

  rejectUnknown(raw, ["pregnancyStatus", "lactating", "gravida", "para", "effectiveDate", "notes"]);
  const pregnancyStatus = optionalEnum(merged.pregnancyStatus, ["PREGNANT", "NOT_PREGNANT", "UNKNOWN"], "pregnancyStatus");
  const lactating = optionalBoolean(merged.lactating, "lactating");
  const gravida = optionalNonNegativeInteger(merged.gravida, "gravida");
  const para = optionalNonNegativeInteger(merged.para, "para");
  const effectiveDate = optionalDate(merged.effectiveDate, "effectiveDate");
  const notes = optionalText(merged.notes, "notes", 1000);
  if (pregnancyStatus === undefined && lactating === undefined && gravida === undefined && para === undefined && !effectiveDate && !notes) {
    throw new BadRequestException("Reproductive health entry requires at least one explicitly supplied field.");
  }
  return compact({ kind, pregnancyStatus, lactating, gravida, para, effectiveDate, notes }) as ClinicalProfilePayload;
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

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "boolean") throw new BadRequestException(`${field} must be boolean.`);
  return value;
}

function optionalNonNegativeInteger(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 99) {
    throw new BadRequestException(`${field} must be an integer between 0 and 99.`);
  }
  return Number(value);
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
