import type { AuthPrincipal } from "./authorization.js";

export type ClinicalResourceAction = "READ" | "WRITE";
export type ClinicalAccessBasis =
  | "PATIENT_SELF"
  | "OWN_AUTHORSHIP"
  | "TREATMENT_RELATIONSHIP"
  | "PATIENT_CONSENT";

export type ClinicalAccessDenialReason =
  | "ROLE_NOT_ALLOWED"
  | "PATIENT_SCOPE_MISMATCH"
  | "PATIENT_WRITE_NOT_ALLOWED"
  | "PROVIDER_INACTIVE"
  | "CAPABILITY_NOT_GRANTED"
  | "PURPOSE_NOT_ALLOWED"
  | "OUTSIDE_ACCESS_WINDOW"
  | "SENSITIVITY_NOT_ALLOWED"
  | "WRITE_REQUIRES_ASSIGNMENT"
  | "NO_ACCESS_BASIS";

export interface ClinicalResourceAccessInput {
  principal: AuthPrincipal;
  action: ClinicalResourceAction;
  patientOwnsTarget?: boolean;
  providerActive?: boolean;
  capabilityAllowed?: boolean;
  purpose?: string;
  allowedPurposes?: readonly string[];
  withinAccessWindow?: boolean;
  sensitivityAllowed?: boolean;
  isAssignedProvider?: boolean;
  isResourceAuthor?: boolean;
  hasTreatmentRelationship?: boolean;
  hasPatientConsent?: boolean;
}

export type ClinicalResourceAccessDecision =
  | { allowed: true; basis: ClinicalAccessBasis }
  | { allowed: false; reason: ClinicalAccessDenialReason };

export function decideClinicalResourceAccess(
  input: ClinicalResourceAccessInput,
): ClinicalResourceAccessDecision {
  const { principal, action } = input;

  if (principal.role === "PATIENT") {
    if (!input.patientOwnsTarget) return { allowed: false, reason: "PATIENT_SCOPE_MISMATCH" };
    if (action !== "READ") return { allowed: false, reason: "PATIENT_WRITE_NOT_ALLOWED" };
    return { allowed: true, basis: "PATIENT_SELF" };
  }

  if (input.allowedPurposes && input.allowedPurposes.length > 0) {
    if (!input.purpose || !input.allowedPurposes.includes(input.purpose)) {
      return { allowed: false, reason: "PURPOSE_NOT_ALLOWED" };
    }
  }
  if (input.withinAccessWindow === false) {
    return { allowed: false, reason: "OUTSIDE_ACCESS_WINDOW" };
  }
  if (input.sensitivityAllowed === false) {
    return { allowed: false, reason: "SENSITIVITY_NOT_ALLOWED" };
  }

  if (principal.role !== "DOCTOR" && principal.role !== "OTHER_PROVIDER") {
    return { allowed: false, reason: "ROLE_NOT_ALLOWED" };
  }

  if (!input.providerActive) return { allowed: false, reason: "PROVIDER_INACTIVE" };
  if (input.capabilityAllowed === false) return { allowed: false, reason: "CAPABILITY_NOT_GRANTED" };

  if (action === "WRITE") {
    if (input.isAssignedProvider || input.isResourceAuthor) {
      return { allowed: true, basis: "OWN_AUTHORSHIP" };
    }
    return { allowed: false, reason: "WRITE_REQUIRES_ASSIGNMENT" };
  }

  if (input.isAssignedProvider || input.isResourceAuthor) {
    return { allowed: true, basis: "OWN_AUTHORSHIP" };
  }
  if (input.hasTreatmentRelationship) {
    return { allowed: true, basis: "TREATMENT_RELATIONSHIP" };
  }
  if (input.hasPatientConsent) {
    return { allowed: true, basis: "PATIENT_CONSENT" };
  }
  return { allowed: false, reason: "NO_ACCESS_BASIS" };
}
