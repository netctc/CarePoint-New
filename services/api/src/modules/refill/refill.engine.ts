import { BadRequestException } from "@nestjs/common";

export type RefillReviewAction = "APPROVE" | "DECLINE";

export function normalizeRefillRequestInput(value: unknown) {
  if (value == null) return { reason: null as string | null };
  if (typeof value !== "object" || Array.isArray(value)) throw new BadRequestException("refill request body must be an object.");
  const raw = value as Record<string, unknown>;
  return { reason: optionalText(raw.reason, "reason", 1000) };
}

export function normalizeRefillReviewInput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestException("review body must be an object.");
  const raw = value as Record<string, unknown>;
  const action = enumValue(raw.action, "action", ["APPROVE", "DECLINE"] as const);
  const expectedVersion = positiveInteger(raw.expectedVersion, "expectedVersion");
  const confirm = raw.confirm === true;
  const reason = optionalText(raw.reason, "reason", 2000);
  if (action === "APPROVE" && !confirm) throw new BadRequestException("Approval requires explicit confirm=true.");
  if (action === "DECLINE" && !reason) throw new BadRequestException("Decline requires a patient-visible reason.");
  return { action, expectedVersion, confirm, reason };
}

export function refillAllowance(refillsAllowed: number, approvedCount: number) {
  if (!Number.isInteger(refillsAllowed) || refillsAllowed < 0) throw new BadRequestException("refillsAllowed is invalid.");
  if (!Number.isInteger(approvedCount) || approvedCount < 0) throw new BadRequestException("approvedCount is invalid.");
  const remaining = Math.max(0, refillsAllowed - approvedCount);
  return { refillsAllowed, approvedCount, remaining, eligible: remaining > 0 };
}

function enumValue<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== "string") throw new BadRequestException(field + " is required.");
  const normalized = value.trim().toUpperCase();
  if (!(allowed as readonly string[]).includes(normalized)) throw new BadRequestException(field + " is invalid.");
  return normalized as T;
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || Number(value) < 1) throw new BadRequestException(field + " must be a positive integer.");
  return Number(value);
}

function optionalText(value: unknown, field: string, max: number): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new BadRequestException(field + " must be text.");
  const normalized = value.trim();
  if (!normalized || normalized.length > max || /\p{Cc}/u.test(normalized)) throw new BadRequestException(field + " is invalid.");
  return normalized;
}
