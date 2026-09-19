export const DataCorrectionReasonCodes = ["INCORRECT", "DUPLICATE", "OUTDATED", "NEEDS_CLARIFICATION", "OTHER"] as const;
export const DataCorrectionStatuses = ["OPEN", "CLARIFICATION_REQUESTED", "RESOLVED", "REJECTED", "CANCELLED"] as const;
export const DataCorrectionActions = ["REQUEST_CLARIFICATION", "RESOLVE_CORRECTION", "REJECT_REQUEST"] as const;

export type DataCorrectionReasonCode = (typeof DataCorrectionReasonCodes)[number];
export type DataCorrectionStatus = (typeof DataCorrectionStatuses)[number];
export type DataCorrectionAction = (typeof DataCorrectionActions)[number];

export type CreateDataCorrectionInput = {
  entryId: string;
  expectedEntryVersion: number;
  reasonCode: DataCorrectionReasonCode;
  note: string;
};

export type DecideDataCorrectionInput = {
  requestId: string;
  action: DataCorrectionAction;
  expectedRequestVersion: number;
  expectedEntryVersion: number;
  reason: string;
  correctedData: Record<string, unknown> | null;
  correctedStatus: string | null;
};

export function normalizeCreateDataCorrectionInput(input: Record<string, unknown>): CreateDataCorrectionInput {
  return {
    entryId: identifier(input.entryId, "entryId"),
    expectedEntryVersion: positiveInteger(input.expectedEntryVersion, "expectedEntryVersion"),
    reasonCode: enumValue(input.reasonCode, DataCorrectionReasonCodes, "reasonCode"),
    note: requiredText(input.note, 1, 4000, "note"),
  };
}

export function normalizeDecideDataCorrectionInput(input: Record<string, unknown>): DecideDataCorrectionInput {
  const action = enumValue(input.action, DataCorrectionActions, "action");
  const correctedData = optionalObject(input.correctedData, "correctedData");
  if (action === "RESOLVE_CORRECTION" && !correctedData) {
    throw new Error("correctedData is required for RESOLVE_CORRECTION.");
  }
  if (action !== "RESOLVE_CORRECTION" && correctedData) {
    throw new Error("correctedData is only allowed for RESOLVE_CORRECTION.");
  }
  return {
    requestId: identifier(input.requestId, "requestId"),
    action,
    expectedRequestVersion: positiveInteger(input.expectedRequestVersion, "expectedRequestVersion"),
    expectedEntryVersion: positiveInteger(input.expectedEntryVersion, "expectedEntryVersion"),
    reason: requiredText(input.reason, 1, 4000, "reason"),
    correctedData,
    correctedStatus: optionalCode(input.correctedStatus, "correctedStatus"),
  };
}

export function targetCorrectionStatus(current: DataCorrectionStatus, action: DataCorrectionAction): DataCorrectionStatus {
  const transitions: Record<DataCorrectionStatus, Partial<Record<DataCorrectionAction, DataCorrectionStatus>>> = {
    OPEN: {
      REQUEST_CLARIFICATION: "CLARIFICATION_REQUESTED",
      RESOLVE_CORRECTION: "RESOLVED",
      REJECT_REQUEST: "REJECTED",
    },
    CLARIFICATION_REQUESTED: {
      RESOLVE_CORRECTION: "RESOLVED",
      REJECT_REQUEST: "REJECTED",
    },
    RESOLVED: {},
    REJECTED: {},
    CANCELLED: {},
  };
  const target = transitions[current]?.[action];
  if (!target) throw new Error(`Action ${action} is not allowed from correction status ${current}.`);
  return target;
}

function optionalObject(value: unknown, field: string): Record<string, unknown> | null {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} must be an object.`);
  return value as Record<string, unknown>;
}

function positiveInteger(value: unknown, field: string): number {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 1) throw new Error(`${field} must be a positive integer.`);
  return normalized;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (!allowed.includes(normalized as T)) throw new Error(`${field} must be one of: ${allowed.join(", ")}.`);
  return normalized as T;
}

function optionalCode(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  const normalized = String(value).trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(normalized)) throw new Error(`${field} is invalid.`);
  return normalized;
}

function identifier(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`${field} is required.`);
  const normalized = value.trim();
  if (!/^[A-Za-z0-9_.:-]{1,180}$/.test(normalized)) throw new Error(`${field} is invalid.`);
  return normalized;
}

function requiredText(value: unknown, min: number, max: number, field: string): string {
  if (typeof value !== "string") throw new Error(`${field} must be text.`);
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max || /\p{Cc}/u.test(normalized)) {
    throw new Error(`${field} must contain between ${min} and ${max} valid characters.`);
  }
  return normalized;
}
