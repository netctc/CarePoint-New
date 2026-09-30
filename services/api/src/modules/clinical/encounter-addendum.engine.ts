export type EncounterAddendumInput = {
  reason: string;
  text: string;
};

const MAX_REASON = 1000;
const MAX_TEXT = 20000;

export function normalizeEncounterAddendumInput(input: Record<string, unknown>): EncounterAddendumInput {
  return {
    reason: requiredText(input.reason, "reason", MAX_REASON),
    text: requiredText(input.text, "text", MAX_TEXT),
  };
}

function requiredText(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") throw new Error(`${field} must be text.`);
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > max) {
    throw new Error(`${field} must contain between 1 and ${max} characters.`);
  }
  return normalized;
}
