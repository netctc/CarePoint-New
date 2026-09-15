export type CredentialValidity = {
  type: string;
  validFrom?: Date | null;
  validUntil?: Date | null;
};

export function credentialIsCurrent(credential: CredentialValidity, now = new Date()): boolean {
  if (credential.validFrom && credential.validFrom.getTime() > now.getTime()) return false;
  if (credential.validUntil && credential.validUntil.getTime() <= now.getTime()) return false;
  return true;
}

export function missingCurrentCredentialTypes(
  requiredTypes: readonly string[],
  credentials: readonly CredentialValidity[],
  now = new Date(),
): string[] {
  const currentTypes = new Set(
    credentials
      .filter((credential) => credentialIsCurrent(credential, now))
      .map((credential) => credential.type.trim().toLowerCase()),
  );
  return [...new Set(requiredTypes.map((type) => type.trim().toLowerCase()).filter(Boolean))]
    .filter((type) => !currentTypes.has(type));
}

export function jsonStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((value): value is string => typeof value === "string").map((value) => value.trim().toLowerCase()).filter(Boolean))];
}
