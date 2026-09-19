import { BadRequestException } from "@nestjs/common";

export type CarePlanStatus = "ACTIVE" | "PAUSED" | "CLOSED";
export type GoalStatus = "ACTIVE" | "ACHIEVED" | "CANCELLED";
export type TaskStatus = "ACTIVE" | "PAUSED" | "CLOSED";
export type TaskAssigneeType = "PATIENT" | "PROVIDER";
export type TaskOutcome = "DONE" | "OMITTED";

const TOKEN = /^[A-Za-z0-9_.:@/-]{1,160}$/;
const REASON = /^[A-Z][A-Z0-9_:-]{1,63}$/;

export function normalizePlanPayload(value: unknown) {
  const raw = object(value, "data");
  return {
    title: text(raw.title, "title", 200, true),
    ...(optionalText(raw.summary, "summary", 1200) !== undefined ? { summary: optionalText(raw.summary, "summary", 1200) } : {}),
    ...(optionalToken(raw.problemRef, "problemRef") !== undefined ? { problemRef: optionalToken(raw.problemRef, "problemRef") } : {}),
  };
}

export function normalizeGoalPayload(value: unknown) {
  const raw = object(value, "data");
  const kind = enumValue(raw.kind, "kind", ["MEASURABLE", "QUALITATIVE"] as const);
  const result: Record<string, unknown> = {
    kind,
    label: text(raw.label, "label", 240, true),
    criterion: text(raw.criterion, "criterion", 600, true),
  };
  if (kind === "MEASURABLE") {
    result.comparator = enumValue(raw.comparator, "comparator", ["LT", "LTE", "GT", "GTE", "BETWEEN"] as const);
    result.targetValue = finite(raw.targetValue, "targetValue");
    if (result.comparator === "BETWEEN") result.targetUpperValue = finite(raw.targetUpperValue, "targetUpperValue");
    const unitCode = optionalToken(raw.unitCode, "unitCode");
    if (unitCode !== undefined) result.unitCode = unitCode;
  }
  return result;
}

export function normalizeTaskPayload(value: unknown) {
  const raw = object(value, "data");
  return {
    kind: enumValue(raw.kind, "kind", ["MEASUREMENT", "EXERCISE", "MEDICATION", "EDUCATION", "FOLLOW_UP", "OTHER"] as const),
    label: text(raw.label, "label", 240, true),
    ...(optionalText(raw.instructions, "instructions", 1200) !== undefined ? { instructions: optionalText(raw.instructions, "instructions", 1200) } : {}),
  };
}

export function normalizeRecurrence(value: unknown): Record<string, unknown> | null {
  if (value == null) return null;
  const raw = object(value, "recurrence");
  const frequency = enumValue(raw.frequency, "recurrence.frequency", ["DAILY", "WEEKLY"] as const);
  const interval = integer(raw.interval ?? 1, "recurrence.interval", 1, 90);
  const result: Record<string, unknown> = { frequency, interval };
  if (raw.weekdays !== undefined) {
    if (!Array.isArray(raw.weekdays)) throw new BadRequestException("recurrence.weekdays must be an array.");
    const days = raw.weekdays.map((item) => integer(item, "recurrence.weekdays", 1, 7));
    if (new Set(days).size !== days.length) throw new BadRequestException("recurrence.weekdays cannot contain duplicates.");
    result.weekdays = days.sort((a, b) => a - b);
  }
  return result;
}

export function normalizePlanStatus(value: unknown): CarePlanStatus {
  return enumValue(value, "status", ["ACTIVE", "PAUSED", "CLOSED"] as const);
}

export function normalizeGoalStatus(value: unknown): GoalStatus {
  return enumValue(value, "status", ["ACTIVE", "ACHIEVED", "CANCELLED"] as const);
}

export function normalizeTaskStatus(value: unknown): TaskStatus {
  return enumValue(value, "status", ["ACTIVE", "PAUSED", "CLOSED"] as const);
}

export function normalizeTaskAssignee(value: unknown): TaskAssigneeType {
  return enumValue(value, "assigneeType", ["PATIENT", "PROVIDER"] as const);
}

export function normalizeTaskOutcome(value: unknown): TaskOutcome {
  return enumValue(value, "outcome", ["DONE", "OMITTED"] as const);
}

export function normalizeReasonCode(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new BadRequestException("reasonCode must be text.");
  const normalized = value.trim().toUpperCase();
  if (!REASON.test(normalized)) throw new BadRequestException("reasonCode is invalid.");
  return normalized;
}

export function normalizeMetricCode(value: unknown): string | null {
  if (value == null || value === "") return null;
  const token = optionalToken(value, "metricCode");
  return token ? token.toUpperCase() : null;
}

export function normalizeOccurrenceKey(value: unknown): string {
  if (typeof value !== "string") throw new BadRequestException("occurrenceKey is required.");
  const normalized = value.trim();
  if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(normalized)) throw new BadRequestException("occurrenceKey is invalid.");
  return normalized;
}

export function normalizeIsoDate(value: unknown, field: string, required = true): Date | null {
  if ((value == null || value === "") && !required) return null;
  if (typeof value !== "string") throw new BadRequestException(`${field} must be an ISO date-time.`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new BadRequestException(`${field} must be an ISO date-time.`);
  return parsed;
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestException(`${field} must be an object.`);
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string, max: number, required: boolean): string {
  if (typeof value !== "string") throw new BadRequestException(`${field} ${required ? "is required" : "must be text"}.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > max || /\p{Cc}/u.test(normalized)) throw new BadRequestException(`${field} is invalid.`);
  return normalized;
}

function optionalText(value: unknown, field: string, max: number): string | undefined {
  if (value == null || value === "") return undefined;
  return text(value, field, max, false);
}

function optionalToken(value: unknown, field: string): string | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value !== "string" || !TOKEN.test(value.trim())) throw new BadRequestException(`${field} is invalid.`);
  return value.trim();
}

function enumValue<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== "string") throw new BadRequestException(`${field} is required.`);
  const normalized = value.trim().toUpperCase();
  if (!(allowed as readonly string[]).includes(normalized)) throw new BadRequestException(`${field} is invalid.`);
  return normalized as T;
}

function finite(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new BadRequestException(`${field} must be a finite number.`);
  return value;
}

function integer(value: unknown, field: string, min: number, max: number): number {
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) throw new BadRequestException(`${field} must be an integer between ${min} and ${max}.`);
  return Number(value);
}
