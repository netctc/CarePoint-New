import type { IdentityRole } from "./types.js";

export interface AuthPrincipal {
  accountId: string;
  role: IdentityRole;
  sessionId: string;
}

export const Permissions = [
  "IAM_MANAGE_ACCOUNTS",
  "IAM_READ_AUDIT",
  "PROVIDER_REVIEW",
  "PROVIDER_SELF_ONBOARD",
  "PROVIDER_MANAGE_SERVICES",
  "PROVIDER_MANAGE_AVAILABILITY",
  "PATIENT_MANAGE_CONSENT",
  "PATIENT_BOOK_APPOINTMENT",
  "PATIENT_MANAGE_APPOINTMENT",
  "APPOINTMENT_OPERATE",
  "TELEHEALTH_JOIN",
  "TELEHEALTH_OPERATE",
  "CATALOG_MANAGE",
  "EMERGENCY_REQUEST",
  "SELF_SESSION_MANAGE",
] as const;

export type Permission = (typeof Permissions)[number];

const grants: Record<IdentityRole, readonly Permission[]> = {
  ADMIN: [
    "IAM_MANAGE_ACCOUNTS",
    "IAM_READ_AUDIT",
    "PROVIDER_REVIEW",
    "APPOINTMENT_OPERATE",
    "CATALOG_MANAGE",
    "SELF_SESSION_MANAGE",
  ],
  SUPPORT: ["SELF_SESSION_MANAGE"],
  PATIENT: [
    "PATIENT_MANAGE_CONSENT",
    "PATIENT_BOOK_APPOINTMENT",
    "PATIENT_MANAGE_APPOINTMENT",
    "TELEHEALTH_JOIN",
    "EMERGENCY_REQUEST",
    "SELF_SESSION_MANAGE",
  ],
  DOCTOR: [
    "PROVIDER_SELF_ONBOARD",
    "PROVIDER_MANAGE_SERVICES",
    "PROVIDER_MANAGE_AVAILABILITY",
    "TELEHEALTH_JOIN",
    "TELEHEALTH_OPERATE",
    "SELF_SESSION_MANAGE",
  ],
  OTHER_PROVIDER: [
    "PROVIDER_SELF_ONBOARD",
    "PROVIDER_MANAGE_SERVICES",
    "PROVIDER_MANAGE_AVAILABILITY",
    "TELEHEALTH_JOIN",
    "TELEHEALTH_OPERATE",
    "SELF_SESSION_MANAGE",
  ],
};

export function roleHasPermission(role: IdentityRole, permission: Permission): boolean {
  return grants[role].includes(permission);
}

export function principalHasAnyPermission(principal: AuthPrincipal, permissions: readonly Permission[]): boolean {
  return permissions.length === 0 || permissions.some((permission) => roleHasPermission(principal.role, permission));
}

export function canActOnAccount(principal: AuthPrincipal, targetAccountId: string): boolean {
  return principal.accountId === targetAccountId || roleHasPermission(principal.role, "IAM_MANAGE_ACCOUNTS");
}

export function canOwnOnboarding(principal: AuthPrincipal, ownerAccountId: string): boolean {
  return principal.accountId === ownerAccountId && roleHasPermission(principal.role, "PROVIDER_SELF_ONBOARD");
}
