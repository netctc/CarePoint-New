export const TRANSPORT_PROVIDER_FAMILIES = [
  "MEDICAL_TRANSPORT_GROUND",
  "MEDICAL_TRANSPORT_AIR",
] as const;

export type TransportProviderFamily = (typeof TRANSPORT_PROVIDER_FAMILIES)[number];

export function isTransportProviderFamily(value: unknown): value is TransportProviderFamily {
  return typeof value === "string"
    && (TRANSPORT_PROVIDER_FAMILIES as readonly string[]).includes(value);
}
