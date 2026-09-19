import { BadRequestException } from "@nestjs/common";

export type ProviderFormContextType = "GENERAL" | "HOME_VISIT" | "TRANSPORT";
export type ProviderFormPurpose = "GENERAL_SERVICE" | "HOME_VISIT_COMPLETION" | "TRANSPORT_CHECKLIST";

const CONTEXTS = new Set<ProviderFormContextType>(["GENERAL", "HOME_VISIT", "TRANSPORT"]);
const PURPOSES = new Set<ProviderFormPurpose>(["GENERAL_SERVICE", "HOME_VISIT_COMPLETION", "TRANSPORT_CHECKLIST"]);

export function normalizeProviderFormCode(value: unknown): string {
  if (typeof value !== "string") throw new BadRequestException("form code is required.");
  const code = value.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{2,79}$/.test(code)) throw new BadRequestException("form code is invalid.");
  return code;
}

export function normalizeProviderFormPurpose(value: unknown): ProviderFormPurpose {
  if (typeof value !== "string") throw new BadRequestException("form purpose is required.");
  const purpose = value.trim().toUpperCase() as ProviderFormPurpose;
  if (!PURPOSES.has(purpose)) throw new BadRequestException("Unsupported provider form purpose.");
  return purpose;
}

export function normalizeProviderFormContext(value: unknown): ProviderFormContextType {
  if (typeof value !== "string") throw new BadRequestException("contextType is required.");
  const context = value.trim().toUpperCase() as ProviderFormContextType;
  if (!CONTEXTS.has(context)) throw new BadRequestException("Unsupported provider form contextType.");
  return context;
}

export function normalizeOptionalContextId(value: unknown, context: ProviderFormContextType): string | null {
  if (context === "GENERAL") {
    if (value !== undefined && value !== null && String(value).trim()) {
      throw new BadRequestException("GENERAL provider forms cannot bind a contextId.");
    }
    return null;
  }
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(value.trim())) {
    throw new BadRequestException("contextId is required for contextual provider forms.");
  }
  return value.trim();
}
