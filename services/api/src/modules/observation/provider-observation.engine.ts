export type ProviderObservationInput = {
  code: string;
  value: number;
  unitCode: string;
  observedAt: string;
  encounterId: string | null;
};

export type EncounterBinding = {
  id: string;
  patientId: string;
  providerId: string;
  status: string;
};

export function normalizeProviderObservationInput(input: Record<string, unknown>): ProviderObservationInput {
  return {
    code: token(input.code, "code", 80),
    value: finite(input.value, "value"),
    unitCode: token(input.unitCode, "unitCode", 40),
    observedAt: iso(input.observedAt, "observedAt"),
    encounterId: optionalId(input.encounterId, "encounterId"),
  };
}

export function assertProviderEncounterBinding(
  encounter: EncounterBinding | null,
  patientId: string,
  providerId: string,
) {
  if (!encounter) throw new Error("Encounter not found.");
  if (encounter.patientId !== patientId) throw new Error("Encounter does not belong to the target patient.");
  if (encounter.providerId !== providerId) throw new Error("Encounter is not assigned to the current provider.");
  if (!new Set(["CONFIRMED", "COMPLETED"]).has(encounter.status)) {
    throw new Error("Encounter must be confirmed or completed.");
  }
  return encounter;
}

export function providerObservationProvenance(providerId: string, encounterId: string | null) {
  if (!/^[A-Za-z0-9_.:-]{1,180}$/.test(providerId)) throw new Error("providerId is invalid.");
  return {
    sourceType: "PROVIDER" as const,
    sourceId: providerId,
    verificationStatus: "PROVIDER_VERIFIED" as const,
    encounterId,
    automatedDiagnosis: false,
  };
}

function finite(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${field} must be a finite number.`);
  return value;
}

function iso(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`${field} is required.`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${field} must be a valid ISO date-time.`);
  return parsed.toISOString();
}

function token(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") throw new Error(`${field} is required.`);
  const normalized = value.trim().toUpperCase();
  if (!normalized || normalized.length > max || !/^[A-Z][A-Z0-9_.:-]*$/.test(normalized)) throw new Error(`${field} is invalid.`);
  return normalized;
}

function optionalId(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new Error(`${field} is invalid.`);
  const normalized = value.trim();
  if (!/^[A-Za-z0-9_.:-]{1,180}$/.test(normalized)) throw new Error(`${field} is invalid.`);
  return normalized;
}
