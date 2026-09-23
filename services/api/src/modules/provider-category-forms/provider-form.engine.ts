import { BadRequestException } from "@nestjs/common";
import {
  normalizeQuestionnaireAnswers,
  normalizeQuestionnaireSchema,
  type QuestionnaireAnswers,
  type QuestionnaireSchema,
} from "../questionnaire/questionnaire.engine";

export const ProviderFormPurposes = [
  "GENERAL",
  "HOME_VISIT",
  "SERVICE_COMPLETION",
  "PROCEDURE_CHECKLIST",
  "TRANSPORT_EQUIPMENT",
] as const;
export type ProviderFormPurpose = (typeof ProviderFormPurposes)[number];

export const ProviderFormContextTypes = [
  "APPOINTMENT",
  "MEDICAL_TRANSPORT",
  "EMERGENCY_AMBULANCE",
] as const;
export type ProviderFormContextType = (typeof ProviderFormContextTypes)[number];

export function normalizeProviderFormPurpose(value: unknown): ProviderFormPurpose {
  if (typeof value !== "string") throw new BadRequestException("purpose is required.");
  const normalized = value.trim().toUpperCase();
  if (!(ProviderFormPurposes as readonly string[]).includes(normalized)) {
    throw new BadRequestException("Unsupported provider form purpose.");
  }
  return normalized as ProviderFormPurpose;
}

export function normalizeProviderFormContextType(value: unknown): ProviderFormContextType {
  if (typeof value !== "string") throw new BadRequestException("contextType is required.");
  const normalized = value.trim().toUpperCase();
  if (!(ProviderFormContextTypes as readonly string[]).includes(normalized)) {
    throw new BadRequestException("Unsupported provider form contextType.");
  }
  return normalized as ProviderFormContextType;
}

export function normalizeProviderFormSchema(value: unknown): QuestionnaireSchema {
  return normalizeQuestionnaireSchema(value);
}

export function normalizeProviderFormAnswers(
  schema: QuestionnaireSchema,
  value: unknown,
): QuestionnaireAnswers {
  return normalizeQuestionnaireAnswers(schema, value);
}

export function assertProviderFormPurposeContext(
  purpose: ProviderFormPurpose,
  contextType: ProviderFormContextType,
  appointmentModality?: string | null,
): void {
  if (purpose === "HOME_VISIT") {
    if (contextType !== "APPOINTMENT" || appointmentModality !== "HOME_VISIT") {
      throw new BadRequestException("HOME_VISIT forms require a HOME_VISIT appointment context.");
    }
  }
  if ((purpose === "SERVICE_COMPLETION" || purpose === "PROCEDURE_CHECKLIST") && contextType !== "APPOINTMENT") {
    throw new BadRequestException(`${purpose} forms require an appointment context.`);
  }
  if (purpose === "TRANSPORT_EQUIPMENT" && contextType !== "MEDICAL_TRANSPORT") {
    throw new BadRequestException("TRANSPORT_EQUIPMENT forms require a medical transport context.");
  }
}
