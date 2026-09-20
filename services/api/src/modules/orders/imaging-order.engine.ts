export const ImagingModalities = [
  "XRAY",
  "CT",
  "MRI",
  "ULTRASOUND",
  "MAMMOGRAPHY",
  "NUCLEAR_MEDICINE",
  "PET",
  "OTHER",
] as const;

export const ImagingPriorities = ["ROUTINE", "URGENT", "STAT"] as const;

export type ImagingModality = (typeof ImagingModalities)[number];
export type ImagingPriority = (typeof ImagingPriorities)[number];

export type ImagingOrderInput = {
  idempotencyKey: string;
  appointmentId: string | null;
  modality: ImagingModality;
  priority: ImagingPriority;
  reason: string;
  bodySite: string | null;
  instructions: string | null;
};

export function normalizeImagingOrderInput(input: Record<string, unknown>): ImagingOrderInput {
  const idempotencyKey = requiredText(input.idempotencyKey, 8, 128, "idempotencyKey");
  const modality = enumValue(input.modality, ImagingModalities, "modality");
  const priority = input.priority === undefined || input.priority === null || input.priority === ""
    ? "ROUTINE"
    : enumValue(input.priority, ImagingPriorities, "priority");
  const reason = requiredText(input.reason, 1, 2000, "reason");
  const appointmentId = optionalText(input.appointmentId, 1, 120, "appointmentId");
  const bodySite = optionalText(input.bodySite, 1, 500, "bodySite");
  const instructions = optionalText(input.instructions, 1, 2000, "instructions");
  return { idempotencyKey, appointmentId, modality, priority, reason, bodySite, instructions };
}

export function normalizeImagingOrderAction(input: Record<string, unknown>): { action: "CANCEL"; expectedVersion: number } {
  const action = String(input.action ?? "").trim().toUpperCase();
  if (action !== "CANCEL") throw new Error("action must be CANCEL.");
  const expectedVersion = Number(input.expectedVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw new Error("expectedVersion must be a positive integer.");
  return { action: "CANCEL", expectedVersion };
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (!allowed.includes(normalized as T)) throw new Error(`${field} must be one of: ${allowed.join(", ")}.`);
  return normalized as T;
}

function requiredText(value: unknown, min: number, max: number, field: string): string {
  if (typeof value !== "string") throw new Error(`${field} must be text.`);
  const text = value.trim();
  if (text.length < min || text.length > max) throw new Error(`${field} must contain between ${min} and ${max} characters.`);
  return text;
}

function optionalText(value: unknown, min: number, max: number, field: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  return requiredText(value, min, max, field);
}
