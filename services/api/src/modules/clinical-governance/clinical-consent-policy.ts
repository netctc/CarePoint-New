import { BadRequestException } from "@nestjs/common";
import type { IdentityRole } from "@carepoint/identity";

export interface ClinicalConsentPolicy {
  scopePattern: string;
  version: string;
  resource: string;
  access: "READ" | "WRITE";
  allowedPurposes: readonly ["TREATMENT"];
  eligibleRoles: readonly IdentityRole[];
  temporaryShareable: boolean;
}

export const ClinicalConsentPolicies: readonly ClinicalConsentPolicy[] = [
  {
    scopePattern: "CLINICAL_RECORD_READ",
    version: "clinical-record-v1",
    resource: "CLINICAL_RECORD",
    access: "READ",
    allowedPurposes: ["TREATMENT"],
    eligibleRoles: ["DOCTOR", "OTHER_PROVIDER"],
    temporaryShareable: true,
  },
  {
    scopePattern: "HEALTH_PROFILE_READ",
    version: "health-profile-v1",
    resource: "HEALTH_PROFILE",
    access: "READ",
    allowedPurposes: ["TREATMENT"],
    eligibleRoles: ["DOCTOR", "OTHER_PROVIDER"],
    temporaryShareable: true,
  },
  {
    scopePattern: "QUESTIONNAIRE_READ",
    version: "questionnaire-read-v1",
    resource: "QUESTIONNAIRE",
    access: "READ",
    allowedPurposes: ["TREATMENT"],
    eligibleRoles: ["DOCTOR"],
    temporaryShareable: true,
  },
  {
    scopePattern: "OBSERVATION_READ",
    version: "observation-read-v1",
    resource: "OBSERVATION",
    access: "READ",
    allowedPurposes: ["TREATMENT"],
    eligibleRoles: ["DOCTOR", "OTHER_PROVIDER"],
    temporaryShareable: true,
  },
  {
    scopePattern: "OBSERVATION_READ:*",
    version: "observation-read-v1",
    resource: "OBSERVATION",
    access: "READ",
    allowedPurposes: ["TREATMENT"],
    eligibleRoles: ["DOCTOR", "OTHER_PROVIDER"],
    temporaryShareable: true,
  },
  {
    scopePattern: "CLINICAL_PROFILE_READ",
    version: "clinical-profile-v1",
    resource: "CLINICAL_PROFILE",
    access: "READ",
    allowedPurposes: ["TREATMENT"],
    eligibleRoles: ["DOCTOR", "OTHER_PROVIDER"],
    temporaryShareable: true,
  },
  {
    scopePattern: "CLINICAL_PROFILE_WRITE",
    version: "clinical-profile-v1",
    resource: "CLINICAL_PROFILE",
    access: "WRITE",
    allowedPurposes: ["TREATMENT"],
    eligibleRoles: ["DOCTOR"],
    temporaryShareable: false,
  },
  {
    scopePattern: "CLINICAL_MEDIA_CAPTURE",
    version: "clinical-media-v1",
    resource: "CLINICAL_MEDIA",
    access: "WRITE",
    allowedPurposes: ["TREATMENT"],
    eligibleRoles: ["DOCTOR", "OTHER_PROVIDER"],
    temporaryShareable: false,
  },
] as const;

const SCOPE_TOKEN = /^[A-Z][A-Z0-9_:-]{2,127}$/;
const MAX_SHARE_SCOPES = 20;
export const TEMPORARY_SHARE_MAX_MINUTES = 24 * 60;
export const TEMPORARY_SHARE_MIN_MINUTES = 5;

export function resolveClinicalConsentPolicy(scope: string): ClinicalConsentPolicy | null {
  const normalized = normalizeScope(scope);
  const direct = ClinicalConsentPolicies.find((item) => item.scopePattern === normalized);
  if (direct) return direct;
  if (normalized.startsWith("OBSERVATION_READ:") && normalized.length > "OBSERVATION_READ:".length) {
    return ClinicalConsentPolicies.find((item) => item.scopePattern === "OBSERVATION_READ:*") ?? null;
  }
  return null;
}

export function normalizeTemporaryShareScopes(input: unknown): Array<{
  scope: string;
  version: string;
}> {
  if (!Array.isArray(input) || input.length < 1 || input.length > MAX_SHARE_SCOPES) {
    throw new BadRequestException(`scopes must contain between 1 and ${MAX_SHARE_SCOPES} items.`);
  }
  const unique = [...new Set(input.map((value) => {
    if (typeof value !== "string") throw new BadRequestException("scope values must be strings.");
    return normalizeScope(value);
  }))];
  return unique.map((scope) => {
    const policy = resolveClinicalConsentPolicy(scope);
    if (!policy || !policy.temporaryShareable || policy.access !== "READ") {
      throw new BadRequestException(`Scope '${scope}' is not temporary-share eligible.`);
    }
    return { scope, version: policy.version };
  });
}

export function normalizeTemporaryShareExpiry(
  input: unknown,
  now = new Date(),
): Date {
  if (typeof input !== "string") throw new BadRequestException("expiresAt is required.");
  const expiresAt = new Date(input);
  if (!Number.isFinite(expiresAt.getTime())) throw new BadRequestException("expiresAt must be a valid ISO date-time.");
  const deltaMinutes = (expiresAt.getTime() - now.getTime()) / 60000;
  if (deltaMinutes < TEMPORARY_SHARE_MIN_MINUTES || deltaMinutes > TEMPORARY_SHARE_MAX_MINUTES) {
    throw new BadRequestException(
      `Temporary clinical share expiry must be between ${TEMPORARY_SHARE_MIN_MINUTES} and ${TEMPORARY_SHARE_MAX_MINUTES} minutes.`,
    );
  }
  return expiresAt;
}

export function normalizeScope(scope: string): string {
  const normalized = scope.trim().toUpperCase();
  if (!SCOPE_TOKEN.test(normalized)) throw new BadRequestException("Clinical consent scope is invalid.");
  if (normalized.startsWith("OBSERVATION_READ:")) {
    const code = normalized.slice("OBSERVATION_READ:".length);
    if (!/^[A-Z][A-Z0-9_]{2,79}$/.test(code)) {
      throw new BadRequestException("Observation sharing scope has an invalid metric code.");
    }
  }
  return normalized;
}

export function validateClinicalConsentGrantContract(input: {
  scope: string;
  version: string;
  purpose: string | null;
  providerRole?: IdentityRole | null;
}): { scope: string; version: string; purpose: string | null } {
  const rawScope = input.scope.trim();
  const candidate = rawScope.toUpperCase();
  const isV2ClinicalScope =
    candidate === "CLINICAL_RECORD_READ" ||
    candidate === "HEALTH_PROFILE_READ" ||
    candidate === "QUESTIONNAIRE_READ" ||
    candidate === "OBSERVATION_READ" ||
    candidate.startsWith("OBSERVATION_READ:") ||
    candidate === "CLINICAL_PROFILE_READ" ||
    candidate === "CLINICAL_PROFILE_WRITE" ||
    candidate === "CLINICAL_MEDIA_CAPTURE";

  if (!isV2ClinicalScope) {
    return {
      scope: rawScope,
      version: input.version.trim(),
      purpose: input.purpose,
    };
  }

  const scope = normalizeScope(candidate);
  const policy = resolveClinicalConsentPolicy(scope);
  if (!policy) throw new BadRequestException("Clinical consent scope is not registered.");
  if (input.version.trim() !== policy.version) {
    throw new BadRequestException(
      `Clinical consent version for '${scope}' must be '${policy.version}'.`,
    );
  }
  if (input.purpose !== "TREATMENT") {
    throw new BadRequestException(
      `Clinical consent purpose for '${scope}' must be TREATMENT.`,
    );
  }
  if (input.providerRole && !policy.eligibleRoles.includes(input.providerRole)) {
    throw new BadRequestException(
      `Target provider role is not eligible for clinical consent scope '${scope}'.`,
    );
  }
  return { scope, version: policy.version, purpose: "TREATMENT" };
}
