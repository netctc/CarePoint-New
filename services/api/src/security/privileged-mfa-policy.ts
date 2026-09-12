import type { IdentityRole } from "@carepoint/identity";

const PRIVILEGED_MFA_ROLES: ReadonlySet<IdentityRole> = new Set([
  "ADMIN",
  "SUPPORT",
  "DOCTOR",
  "OTHER_PROVIDER",
]);

export function isPrivilegedMfaRole(role: IdentityRole): boolean {
  return PRIVILEGED_MFA_ROLES.has(role);
}

export function isMfaRequiredForRole(role: IdentityRole, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!isPrivilegedMfaRole(role)) return false;
  if (env.NODE_ENV === "production") return true;
  return env.CAREPOINT_TEST_ENFORCE_PRIVILEGED_MFA === "true";
}

export function isMfaAssuredSessionId(sessionId: string): boolean {
  return sessionId.startsWith("sesmfa_");
}
