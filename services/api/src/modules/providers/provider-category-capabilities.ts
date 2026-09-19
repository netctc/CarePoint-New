export const ClinicalSummarySections = [
  "HEALTH_PROFILE",
  "ALLERGIES",
  "CONDITIONS",
  "MEDICATIONS",
] as const;

export type ClinicalSummarySection = (typeof ClinicalSummarySections)[number];

export const OtherProviderWorkflowCapabilities = [
  "CATEGORY_FORMS",
  "HOME_VISIT_ARRIVAL",
  "SERVICE_COMPLETION_CHECKLIST",
  "TRANSPORT_EQUIPMENT_CHECKLIST",
  "TRANSPORT_REJECT",
] as const;

export type OtherProviderWorkflowCapability =
  (typeof OtherProviderWorkflowCapabilities)[number];

export interface ParsedProviderCategoryCapabilities {
  enabledModalities: string[];
  clinicalOrderCapabilities: string[];
  clinicalSummarySections: ClinicalSummarySection[];
  observationCodes: string[];
  workflowCapabilities: OtherProviderWorkflowCapability[];
}

export function parseProviderCategoryCapabilities(
  raw: unknown,
): ParsedProviderCategoryCapabilities {
  const source = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};

  return {
    enabledModalities: stringList(source.enabledModalities),
    clinicalOrderCapabilities: stringList(source.clinicalOrderCapabilities),
    clinicalSummarySections: enumList(source.clinicalSummarySections, ClinicalSummarySections),
    observationCodes: stringList(source.observationCodes)
      .map((value) => value.toUpperCase())
      .filter((value) => /^[A-Z][A-Z0-9_]{2,79}$/.test(value)),
    workflowCapabilities: enumList(
      source.workflowCapabilities,
      OtherProviderWorkflowCapabilities,
    ),
  };
}

export function providerCategoryCapabilitiesPayload(input: {
  enabledModalities?: readonly string[];
  clinicalOrderCapabilities?: readonly string[];
  clinicalSummarySections?: readonly string[];
  observationCodes?: readonly string[];
  workflowCapabilities?: readonly string[];
}): ParsedProviderCategoryCapabilities {
  return parseProviderCategoryCapabilities({
    enabledModalities: input.enabledModalities ?? [],
    clinicalOrderCapabilities: input.clinicalOrderCapabilities ?? [],
    clinicalSummarySections: input.clinicalSummarySections ?? [],
    observationCodes: input.observationCodes ?? [],
    workflowCapabilities: input.workflowCapabilities ?? [],
  });
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean),
  )];
}

function enumList<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T[] {
  const valid = new Set<string>(allowed);
  return stringList(value)
    .map((item) => item.toUpperCase())
    .filter((item): item is T => valid.has(item));
}
