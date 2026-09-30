export const ReferralPriorities = ["ROUTINE", "URGENT"] as const;
export const ReferralStatuses = ["REQUESTED", "ACCEPTED", "IN_PROGRESS", "COMPLETED", "DECLINED", "CANCELLED"] as const;
export const ReferralShareBaseScopes = [
  "CLINICAL_RECORD_READ",
  "HEALTH_PROFILE_READ",
  "QUESTIONNAIRE_READ",
  "OBSERVATION_READ",
  "CLINICAL_PROFILE_READ",
] as const;

export type ReferralPriority = (typeof ReferralPriorities)[number];
export type ReferralStatus = (typeof ReferralStatuses)[number];
export type ReferralAction = "ACCEPT" | "START" | "COMPLETE" | "DECLINE" | "CANCEL";

export type ReferralInput = {
  idempotencyKey: string;
  destinationProviderId: string;
  priority: ReferralPriority;
  reason: string;
  specialtyCode: string | null;
  scopes: string[];
  documentIds: string[];
  expiresAt: Date | null;
};

export type ReferralActionInput = {
  action: ReferralAction;
  expectedVersion: number;
  reasonCode: string | null;
  completionOutcome?: string;
};

const MAX_SHARE_SCOPES = 20;
const MAX_DOCUMENTS = 25;
const MAX_SHARE_DAYS = 90;
const OBSERVATION_SCOPE = /^OBSERVATION_READ:[A-Z][A-Z0-9_]{2,79}$/;
const CODE = /^[A-Z][A-Z0-9_:-]{1,63}$/;

export function normalizeReferralInput(input: Record<string, unknown>, now = new Date()): ReferralInput {
  const idempotencyKey = requiredText(input.idempotencyKey, 8, 128, "idempotencyKey");
  const destinationProviderId = requiredText(input.destinationProviderId, 1, 180, "destinationProviderId");
  const priority = input.priority == null || input.priority === ""
    ? "ROUTINE"
    : enumValue(input.priority, ReferralPriorities, "priority");
  const reason = requiredText(input.reason, 1, 4000, "reason");
  const specialtyCode = optionalCode(input.specialtyCode, "specialtyCode");
  const scopes = normalizeReferralShareScopes(input.scopes);
  const documentIds = normalizeIdArray(input.documentIds, "documentIds", MAX_DOCUMENTS, true);
  const expiresAt = optionalFutureExpiry(input.expiresAt, now);
  return { idempotencyKey, destinationProviderId, priority, reason, specialtyCode, scopes, documentIds, expiresAt };
}

export function normalizeReferralAction(input: Record<string, unknown>): ReferralActionInput {
  const action = enumValue(input.action, ["ACCEPT", "START", "COMPLETE", "DECLINE", "CANCEL"] as const, "action");
  const expectedVersion = Number(input.expectedVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw new Error("expectedVersion must be a positive integer.");
  }
  const reasonCode = optionalCode(input.reasonCode, "reasonCode");
  if ((action === "DECLINE" || action === "CANCEL") && !reasonCode) {
    throw new Error(`reasonCode is required for ${action}.`);
  }
  if (action === "COMPLETE") {
    const completionOutcome = requiredText(input.completionOutcome, 1, 4000, "completionOutcome");
    return { action, expectedVersion, reasonCode, completionOutcome };
  }
  if (input.completionOutcome !== undefined && input.completionOutcome !== null && input.completionOutcome !== "") {
    throw new Error("completionOutcome is only allowed for COMPLETE.");
  }
  return { action, expectedVersion, reasonCode };
}

export function referralTargetStatus(status: ReferralStatus, action: ReferralAction): ReferralStatus {
  const transitions: Record<ReferralStatus, Partial<Record<ReferralAction, ReferralStatus>>> = {
    REQUESTED: { ACCEPT: "ACCEPTED", DECLINE: "DECLINED", CANCEL: "CANCELLED" },
    ACCEPTED: { START: "IN_PROGRESS", COMPLETE: "COMPLETED", CANCEL: "CANCELLED" },
    IN_PROGRESS: { COMPLETE: "COMPLETED", CANCEL: "CANCELLED" },
    COMPLETED: {},
    DECLINED: {},
    CANCELLED: {},
  };
  const target = transitions[status]?.[action];
  if (!target) throw new Error(`Action ${action} is not allowed from referral status ${status}.`);
  return target;
}

export function normalizeReferralShareScopes(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_SHARE_SCOPES) {
    throw new Error(`scopes must contain between 1 and ${MAX_SHARE_SCOPES} items.`);
  }
  const allowed = new Set<string>(ReferralShareBaseScopes);
  const normalized = value.map((item) => {
    if (typeof item !== "string") throw new Error("scope values must be strings.");
    const scope = item.trim().toUpperCase();
    if (!allowed.has(scope) && !OBSERVATION_SCOPE.test(scope)) {
      throw new Error(`Scope '${scope}' is not referral-share eligible.`);
    }
    return scope;
  });
  const unique = [...new Set(normalized)];
  if (unique.length !== normalized.length) throw new Error("scopes cannot contain duplicates.");
  return unique.sort();
}

function normalizeIdArray(value: unknown, field: string, max: number, optional: boolean): string[] {
  if ((value === undefined || value === null) && optional) return [];
  if (!Array.isArray(value) || value.length > max) throw new Error(`${field} must contain at most ${max} items.`);
  const normalized = value.map((item) => requiredText(item, 1, 180, field));
  if (new Set(normalized).size !== normalized.length) throw new Error(`${field} cannot contain duplicates.`);
  return normalized;
}

function optionalFutureExpiry(value: unknown, now: Date): Date | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new Error("expiresAt must be an ISO date-time string.");
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("expiresAt must be a valid ISO date-time.");
  if (date.getTime() <= now.getTime()) throw new Error("expiresAt must be in the future.");
  if (date.getTime() > now.getTime() + MAX_SHARE_DAYS * 24 * 60 * 60 * 1000) {
    throw new Error(`expiresAt cannot exceed ${MAX_SHARE_DAYS} days.`);
  }
  return date;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (!allowed.includes(normalized as T)) throw new Error(`${field} must be one of: ${allowed.join(", ")}.`);
  return normalized as T;
}

function optionalCode(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new Error(`${field} must be text.`);
  const normalized = value.trim().toUpperCase();
  if (!CODE.test(normalized)) throw new Error(`${field} is invalid.`);
  return normalized;
}

function requiredText(value: unknown, min: number, max: number, field: string): string {
  if (typeof value !== "string") throw new Error(`${field} must be text.`);
  const text = value.trim();
  if (text.length < min || text.length > max) throw new Error(`${field} must contain between ${min} and ${max} characters.`);
  return text;
}
