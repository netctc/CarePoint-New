import { BadRequestException } from "@nestjs/common";

export const PrepTaskTypes = ["QUESTIONNAIRE", "OBSERVATION", "DOCUMENT", "DEVICE_CHECK", "QUESTIONS", "OTHER"] as const;
export type PrepTaskType = (typeof PrepTaskTypes)[number];
export type PrepTaskStatus = "PENDING" | "COMPLETED" | "NOT_APPLICABLE";

const TOKEN = /^[A-Z][A-Z0-9_:-]{1,79}$/;
const REF = /^[A-Za-z0-9_.:@/-]{1,180}$/;

export function normalizePrepTask(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new BadRequestException("prep task must be an object.");
  const raw = input as Record<string, unknown>;
  const code = token(raw.code, "code");
  const taskType = enumValue(raw.taskType, "taskType", PrepTaskTypes);
  const required = raw.required === undefined ? false : bool(raw.required, "required");
  const dueAt = isoOptional(raw.dueAt, "dueAt");
  return { code, taskType, required, dueAt };
}

export function normalizePrepTaskStatus(value: unknown): PrepTaskStatus {
  return enumValue(value, "status", ["PENDING", "COMPLETED", "NOT_APPLICABLE"] as const);
}

export function normalizeSourceRef(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !REF.test(value.trim())) throw new BadRequestException("sourceRef is invalid.");
  return value.trim();
}

export function readinessProjection(tasks: Array<{ code: string; required: boolean; status: string }>) {
  const required = tasks.filter((item) => item.required);
  const complete = required.filter((item) => item.status === "COMPLETED" || item.status === "NOT_APPLICABLE");
  const missing = required.filter((item) => item.status === "PENDING").map((item) => item.code).sort();
  return {
    ready: missing.length === 0,
    requiredCount: required.length,
    completedRequiredCount: complete.length,
    missingRequiredCodes: missing,
    completionPercent: required.length === 0 ? 100 : Math.round((complete.length / required.length) * 100),
  };
}

export function normalizeFollowUpPayload(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestException("followUp must be an object.");
  const raw = value as Record<string, unknown>;
  const recommendedAfterDays = integer(raw.recommendedAfterDays, "recommendedAfterDays", 1, 3650);
  const modality = enumValue(raw.modality, "modality", ["CLINIC", "TELEMEDICINE", "HOME_VISIT"] as const);
  const reasonCode = token(raw.reasonCode, "reasonCode");
  const instructions = optionalText(raw.instructions, "instructions", 2000);
  const careTaskIds = refArray(raw.careTaskIds ?? [], "careTaskIds", 50);
  return { recommendedAfterDays, modality, reasonCode, ...(instructions ? { instructions } : {}), careTaskIds };
}

export function normalizeReasonCode(value: unknown): string | null {
  if (value == null || value === "") return null;
  return token(value, "reasonCode");
}

export function normalizeDueAt(value: unknown): Date | null {
  return isoOptional(value, "dueAt");
}

function token(value: unknown, field: string): string {
  if (typeof value !== "string") throw new BadRequestException(`${field} is required.`);
  const normalized = value.trim().toUpperCase();
  if (!TOKEN.test(normalized)) throw new BadRequestException(`${field} is invalid.`);
  return normalized;
}
function enumValue<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  const normalized = token(value, field);
  if (!(allowed as readonly string[]).includes(normalized)) throw new BadRequestException(`${field} is invalid.`);
  return normalized as T;
}
function bool(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new BadRequestException(`${field} must be boolean.`);
  return value;
}
function integer(value: unknown, field: string, min: number, max: number): number {
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) throw new BadRequestException(`${field} must be an integer between ${min} and ${max}.`);
  return Number(value);
}
function isoOptional(value: unknown, field: string): Date | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new BadRequestException(`${field} must be an ISO date-time.`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new BadRequestException(`${field} must be an ISO date-time.`);
  return parsed;
}
function optionalText(value: unknown, field: string, max: number): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new BadRequestException(`${field} must be text.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > max || /\p{Cc}/u.test(normalized)) throw new BadRequestException(`${field} is invalid.`);
  return normalized;
}
function refArray(value: unknown, field: string, max: number): string[] {
  if (!Array.isArray(value) || value.length > max) throw new BadRequestException(`${field} must be an array with at most ${max} values.`);
  const output = value.map((item) => {
    if (typeof item !== "string" || !REF.test(item.trim())) throw new BadRequestException(`${field} contains an invalid reference.`);
    return item.trim();
  });
  if (new Set(output).size !== output.length) throw new BadRequestException(`${field} cannot contain duplicates.`);
  return output;
}
