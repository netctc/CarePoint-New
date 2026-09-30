import { BadRequestException } from "@nestjs/common";
import { MedicalTransportEquipmentOptions } from "@carepoint/contracts";

const REASON_CODE = /^[A-Z][A-Z0-9_:-]{1,63}$/;

export function normalizeWorkflowReasonCode(value: unknown): string {
  if (typeof value !== "string") throw new BadRequestException("reasonCode is required.");
  const normalized = value.trim().toUpperCase();
  if (!REASON_CODE.test(normalized)) throw new BadRequestException("reasonCode is invalid.");
  return normalized;
}

export function normalizeTransportEquipmentConfirmation(
  required: readonly string[],
  provided: unknown,
): string[] {
  if (!Array.isArray(provided)) throw new BadRequestException("equipment must be an array.");
  const valid = new Set<string>(MedicalTransportEquipmentOptions as readonly string[]);
  const normalized = provided.map((item) => {
    if (typeof item !== "string") throw new BadRequestException("equipment values must be strings.");
    const value = item.trim().toUpperCase();
    if (!valid.has(value)) throw new BadRequestException(`Unsupported equipment value: ${value}`);
    return value;
  });
  if (new Set(normalized).size !== normalized.length) {
    throw new BadRequestException("equipment cannot contain duplicates.");
  }
  const expected = [...new Set(required.map((item) => item.toUpperCase()))].sort();
  const actual = [...normalized].sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new BadRequestException("Confirmed equipment must exactly match the assigned transport requirements.");
  }
  return actual;
}
