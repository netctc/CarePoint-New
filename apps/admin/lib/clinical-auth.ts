import type { NextRequest, NextResponse } from "next/server";
import { adminBackendFetch, readBoundedAdminBackendText } from "./admin-backend-policy.js";
import { isTrustedAdminPublicOriginRequest } from "./admin-origin-policy.js";

export const CLINICAL_ACCESS_COOKIE = "carepoint_clinical_access";
export const CLINICAL_REFRESH_COOKIE = "carepoint_clinical_refresh";
export const CLINICAL_SESSION_COOKIE = "carepoint_clinical_session";

export interface ClinicalAccount {
  id: string;
  email: string;
  role: "DOCTOR" | "OTHER_PROVIDER";
  status: "ACTIVE";
  createdAt?: string;
  updatedAt?: string;
}

export interface ClinicalSessionTokens {
  sessionId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  refreshExpiresAt: string;
}

export interface ClinicalMfaChallenge {
  requiresMfa: true;
  challengeId: string;
  expiresAt: string;
  enrollmentRequired?: boolean;
  enrollmentSecret?: string;
  otpauthUri?: string;
}

export class ClinicalAuthError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

export function isTrustedClinicalSameOrigin(request: NextRequest): boolean {
  return isTrustedAdminPublicOriginRequest(request);
}

export async function loginWithCarePointClinical(
  email: string,
  password: string,
): Promise<ClinicalMfaChallenge | { account: ClinicalAccount; tokens: ClinicalSessionTokens }> {
  const result = await apiJson<unknown>("/iam/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (isMfaChallenge(result)) {
    if (result.challengeId.startsWith("mfaenroll_")) {
      const enrollment = await beginRequiredMfaEnrollment(result.challengeId);
      return {
        ...result,
        enrollmentRequired: true,
        enrollmentSecret: enrollment.secret,
        otpauthUri: enrollment.otpauthUri,
      };
    }
    return result;
  }
  const tokens = sessionTokens(result);
  const account = await verifyIssuedClinicalSession(tokens);
  return { account, tokens };
}

export async function completeCarePointClinicalMfa(
  challengeId: string,
  code: string,
): Promise<{ account: ClinicalAccount; tokens: ClinicalSessionTokens }> {
  const result = await apiJson<unknown>("/iam/mfa/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ challengeId, code }),
  });
  const tokens = sessionTokens(result);
  const account = await verifyIssuedClinicalSession(tokens);
  return { account, tokens };
}

export async function refreshCarePointClinical(
  refreshToken: string,
): Promise<{ account: ClinicalAccount; tokens: ClinicalSessionTokens }> {
  const result = await apiJson<unknown>("/iam/sessions/refresh", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
  const tokens = sessionTokens(result);
  const account = await verifyIssuedClinicalSession(tokens);
  return { account, tokens };
}

export async function validateCarePointClinical(accessToken: string): Promise<ClinicalAccount> {
  const account = await apiJson<unknown>("/iam/accounts/me", {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  return clinicalAccount(account);
}

export async function revokeCarePointClinicalSession(accessToken: string, sessionId: string): Promise<void> {
  await apiJson<unknown>(`/iam/sessions/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${accessToken}` },
  });
}

export async function revokeCarePointClinicalSessionBestEffort(accessToken: string, sessionId: string): Promise<void> {
  await revokeCarePointClinicalSession(accessToken, sessionId).catch(() => undefined);
}

export function readClinicalCookies(request: NextRequest): { accessToken: string | null; refreshToken: string | null; sessionId: string | null } {
  return {
    accessToken: request.cookies.get(CLINICAL_ACCESS_COOKIE)?.value || null,
    refreshToken: request.cookies.get(CLINICAL_REFRESH_COOKIE)?.value || null,
    sessionId: request.cookies.get(CLINICAL_SESSION_COOKIE)?.value || null,
  };
}

export function writeClinicalCookies(response: NextResponse, tokens: ClinicalSessionTokens): void {
  const base = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
  };
  response.cookies.set(CLINICAL_ACCESS_COOKIE, tokens.accessToken, { ...base, maxAge: secondsUntil(tokens.expiresAt, 15 * 60) });
  response.cookies.set(CLINICAL_REFRESH_COOKIE, tokens.refreshToken, { ...base, maxAge: secondsUntil(tokens.refreshExpiresAt, 30 * 24 * 60 * 60) });
  response.cookies.set(CLINICAL_SESSION_COOKIE, tokens.sessionId, { ...base, maxAge: secondsUntil(tokens.refreshExpiresAt, 30 * 24 * 60 * 60) });
}

export function clearClinicalCookies(response: NextResponse): void {
  const base = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    maxAge: 0,
  };
  response.cookies.set(CLINICAL_ACCESS_COOKIE, "", base);
  response.cookies.set(CLINICAL_REFRESH_COOKIE, "", base);
  response.cookies.set(CLINICAL_SESSION_COOKIE, "", base);
}

export function noStoreClinical<T extends NextResponse>(response: T): T {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

export function publicClinicalAuthError(error: unknown): { status: number; message: string } {
  const status = error instanceof ClinicalAuthError ? error.status : 500;
  if (status === 400) return { status, message: "The authentication request is invalid." };
  if (status === 401) return { status, message: "Authentication failed. Check your credentials or verification code." };
  if (status === 403) return { status, message: "An active Doctor or Other Provider clinical account is required." };
  if (status === 409) return { status, message: "MFA enrollment state changed. Sign in again." };
  if (status === 429) return { status, message: "Too many authentication attempts. Try again later." };
  if (status >= 500) return { status: 503, message: "CarePoint clinical authentication is temporarily unavailable." };
  return { status, message: "Clinical authentication could not be completed." };
}

async function beginRequiredMfaEnrollment(challengeId: string): Promise<{ secret: string; otpauthUri: string }> {
  const result = await apiJson<unknown>("/iam/mfa/enrollment/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ challengeId }),
  });
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new ClinicalAuthError(502, "Invalid MFA enrollment response.");
  const row = result as Record<string, unknown>;
  if (typeof row.secret !== "string" || row.secret.length < 16 || typeof row.otpauthUri !== "string" || !row.otpauthUri.startsWith("otpauth://")) {
    throw new ClinicalAuthError(502, "Invalid MFA enrollment response.");
  }
  return { secret: row.secret, otpauthUri: row.otpauthUri };
}

async function verifyIssuedClinicalSession(tokens: ClinicalSessionTokens): Promise<ClinicalAccount> {
  try {
    return await validateCarePointClinical(tokens.accessToken);
  } catch (error) {
    await revokeCarePointClinicalSessionBestEffort(tokens.accessToken, tokens.sessionId);
    throw error;
  }
}

async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await adminBackendFetch(path, {
      ...init,
      headers: { accept: "application/json", ...(init.headers || {}) },
    });
  } catch {
    throw new ClinicalAuthError(503, "CarePoint API is unavailable.");
  }

  let text: string;
  try {
    text = await readBoundedAdminBackendText(response);
  } catch {
    throw new ClinicalAuthError(502, "Invalid CarePoint API response.");
  }

  let payload: unknown = {};
  if (text) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      payload = {};
    }
  }
  if (!response.ok) throw new ClinicalAuthError(response.status, backendMessage(payload));
  return payload as T;
}

function backendMessage(payload: unknown): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "CarePoint API request failed.";
  const message = (payload as Record<string, unknown>).message;
  return typeof message === "string" ? message : "CarePoint API request failed.";
}

function isMfaChallenge(value: unknown): value is ClinicalMfaChallenge {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return row.requiresMfa === true && typeof row.challengeId === "string" && typeof row.expiresAt === "string";
}

function sessionTokens(value: unknown): ClinicalSessionTokens {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ClinicalAuthError(502, "Invalid authentication response.");
  const row = value as Record<string, unknown>;
  const fields = ["sessionId", "accessToken", "refreshToken", "expiresAt", "refreshExpiresAt"] as const;
  for (const field of fields) {
    if (typeof row[field] !== "string" || !(row[field] as string)) throw new ClinicalAuthError(502, "Invalid authentication response.");
  }
  return {
    sessionId: row.sessionId as string,
    accessToken: row.accessToken as string,
    refreshToken: row.refreshToken as string,
    expiresAt: row.expiresAt as string,
    refreshExpiresAt: row.refreshExpiresAt as string,
  };
}

function clinicalAccount(value: unknown): ClinicalAccount {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ClinicalAuthError(502, "Invalid account response.");
  const row = value as Record<string, unknown>;
  if ((row.role !== "DOCTOR" && row.role !== "OTHER_PROVIDER") || row.status !== "ACTIVE") {
    throw new ClinicalAuthError(403, "An active Doctor or Other Provider clinical account is required.");
  }
  if (typeof row.id !== "string" || typeof row.email !== "string") throw new ClinicalAuthError(502, "Invalid account response.");
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    status: "ACTIVE",
    ...(typeof row.createdAt === "string" ? { createdAt: row.createdAt } : {}),
    ...(typeof row.updatedAt === "string" ? { updatedAt: row.updatedAt } : {}),
  };
}

function secondsUntil(value: string, fallback: number): number {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return fallback;
  return Math.max(1, Math.ceil((time - Date.now()) / 1000));
}
