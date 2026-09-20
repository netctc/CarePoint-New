import { BadRequestException } from "@nestjs/common";

export const DependentRelationshipTypes = [
  "PARENT",
  "LEGAL_GUARDIAN",
  "CAREGIVER",
  "OTHER_AUTHORIZED_REPRESENTATIVE",
] as const;
export type DependentRelationshipType = (typeof DependentRelationshipTypes)[number];

export const DependentAuthorityScopes = [
  "PROFILE_READ",
  "BOOKING_MANAGE",
  "CONSENT_MANAGE",
  "CLINICAL_READ",
  "CLINICAL_WRITE",
  "DOCUMENTS_MANAGE",
  "BILLING_MANAGE",
] as const;
export type DependentAuthorityScope = (typeof DependentAuthorityScopes)[number];

export function normalizeRelationshipType(value: unknown): DependentRelationshipType {
  return enumValue(value, "relationshipType", DependentRelationshipTypes);
}

export function normalizeAuthorityScopes(value: unknown): DependentAuthorityScope[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > DependentAuthorityScopes.length) {
    throw new BadRequestException("scopes must contain one or more supported authority scopes.");
  }
  const scopes = value.map((item) => enumValue(item, "scopes", DependentAuthorityScopes));
  if (new Set(scopes).size !== scopes.length) throw new BadRequestException("scopes cannot contain duplicates.");
  return scopes.sort();
}

export function normalizeEvidenceType(value: unknown): string {
  if (typeof value !== "string") throw new BadRequestException("evidenceType is required.");
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_:-]{1,63}$/.test(normalized)) throw new BadRequestException("evidenceType is invalid.");
  return normalized;
}

export function normalizeReferenceId(value: unknown): string {
  if (typeof value !== "string") throw new BadRequestException("referenceId is required.");
  const normalized = value.trim();
  if (!/^[A-Za-z0-9_.:@/-]{1,180}$/.test(normalized)) throw new BadRequestException("referenceId is invalid.");
  return normalized;
}

export function normalizeAuthorityReviewDecision(value: unknown): "APPROVE" | "REJECT" {
  return enumValue(value, "decision", ["APPROVE", "REJECT"] as const);
}

export function normalizeEvidenceReviewStatus(value: unknown): "VERIFIED" | "REJECTED" {
  return enumValue(value, "status", ["VERIFIED", "REJECTED"] as const);
}

export function normalizeReasonCode(value: unknown, required = false): string | null {
  if ((value == null || value === "") && !required) return null;
  if (typeof value !== "string") throw new BadRequestException("reasonCode is required.");
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_:-]{1,63}$/.test(normalized)) throw new BadRequestException("reasonCode is invalid.");
  return normalized;
}

export function authorityIsEffective(
  relation: {
    status: string;
    validFrom: Date;
    validUntil: Date | null;
    revokedAt: Date | null;
  },
  at = new Date(),
): boolean {
  return relation.status === "VERIFIED" &&
    relation.revokedAt == null &&
    relation.validFrom.getTime() <= at.getTime() &&
    (relation.validUntil == null || relation.validUntil.getTime() > at.getTime());
}

export function contextExpiry(validUntil: Date | null, now = new Date()): Date {
  const twelveHours = new Date(now.getTime() + 12 * 60 * 60 * 1000);
  return validUntil && validUntil.getTime() < twelveHours.getTime() ? validUntil : twelveHours;
}

export function hasAuthorityScope(scopes: unknown, required: DependentAuthorityScope): boolean {
  if (!Array.isArray(scopes)) return false;
  return scopes.includes(required);
}

function enumValue<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== "string") throw new BadRequestException(`${field} is required.`);
  const normalized = value.trim().toUpperCase();
  if (!(allowed as readonly string[]).includes(normalized)) throw new BadRequestException(`${field} is invalid.`);
  return normalized as T;
}
