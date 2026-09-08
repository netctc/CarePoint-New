import type { NextRequest, NextResponse } from "next/server";

export const ADMIN_ACCESS_COOKIE = "carepoint_admin_access";
export const ADMIN_REFRESH_COOKIE = "carepoint_admin_refresh";
export const ADMIN_SESSION_COOKIE = "carepoint_admin_session";

const DEFAULT_API_BASE_URL = "http://127.0.0.1:4000/api/v1";

export interface AdminAccount {
  id: string;
  email: string;
  role: "ADMIN";
  status: "ACTIVE";
  createdAt?: string;
  updatedAt?: string;
}

export interface AdminSessionTokens {
  sessionId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  refreshExpiresAt: string;
}

export interface AdminMfaChallenge {
  requiresMfa: true;
  challengeId: string;
  expiresAt: string;
}

export class AdminAuthError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function apiBaseUrl(): string {
  return (process.env.CAREPOINT_API_URL?.trim() || DEFAULT_API_BASE_URL).replace(/\/$/, "");
}

export function isTrustedSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  return !origin || origin === request.nextUrl.origin;
}

export function safeReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/api/admin/auth")) return "/";
  return value;
}

export async function loginWithCarePoint(email: string, password: string): Promise<AdminMfaChallenge | { account: AdminAccount; tokens: AdminSessionTokens }> {
  const result = await apiJson<unknown>("/iam/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (isMfaChallenge(result)) return result;
  const tokens = sessionTokens(result);
  const account = await verifyIssuedAdminSession(tokens);
  return { account, tokens };
}

export async function completeCarePointMfa(challengeId: string, code: string): Promise<{ account: AdminAccount; tokens: AdminSessionTokens }> {
  const result = await apiJson<unknown>("/iam/mfa/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ challengeId, code }),
  });
  const tokens = sessionTokens(result);
  const account = await verifyIssuedAdminSession(tokens);
  return { account, tokens };
}

export async function refreshCarePointAdmin(refreshToken: string): Promise<{ account: AdminAccount; tokens: AdminSessionTokens }> {
  const result = await apiJson<unknown>("/iam/sessions/refresh", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
  const tokens = sessionTokens(result);
  const account = await verifyIssuedAdminSession(tokens);
  return { account, tokens };
}

export async function validateCarePointAdmin(accessToken: string): Promise<AdminAccount> {
  const account = await apiJson<unknown>("/iam/accounts/me", {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  return adminAccount(account);
}

export async function revokeCarePointSession(accessToken: string, sessionId: string): Promise<void> {
  await apiJson<unknown>(`/iam/sessions/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${accessToken}` },
  });
}

export async function revokeCarePointSessionBestEffort(accessToken: string, sessionId: string): Promise<void> {
  await revokeCarePointSession(accessToken, sessionId).catch(() => undefined);
}

export function readAdminCookies(request: NextRequest): { accessToken: string | null; refreshToken: string | null; sessionId: string | null } {
  return {
    accessToken: request.cookies.get(ADMIN_ACCESS_COOKIE)?.value || null,
    refreshToken: request.cookies.get(ADMIN_REFRESH_COOKIE)?.value || null,
    sessionId: request.cookies.get(ADMIN_SESSION_COOKIE)?.value || null,
  };
}

export function writeAdminCookies(response: NextResponse, tokens: AdminSessionTokens): void {
  const base = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
  };
  response.cookies.set(ADMIN_ACCESS_COOKIE, tokens.accessToken, { ...base, maxAge: secondsUntil(tokens.expiresAt, 15 * 60) });
  response.cookies.set(ADMIN_REFRESH_COOKIE, tokens.refreshToken, { ...base, maxAge: secondsUntil(tokens.refreshExpiresAt, 30 * 24 * 60 * 60) });
  response.cookies.set(ADMIN_SESSION_COOKIE, tokens.sessionId, { ...base, maxAge: secondsUntil(tokens.refreshExpiresAt, 30 * 24 * 60 * 60) });
}

export function clearAdminCookies(response: NextResponse): void {
  const base = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    maxAge: 0,
  };
  response.cookies.set(ADMIN_ACCESS_COOKIE, "", base);
  response.cookies.set(ADMIN_REFRESH_COOKIE, "", base);
  response.cookies.set(ADMIN_SESSION_COOKIE, "", base);
}

export function noStore<T extends NextResponse>(response: T): T {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

export function publicAuthError(error: unknown): { status: number; message: string } {
  const status = error instanceof AdminAuthError ? error.status : 500;
  if (status === 400) return { status, message: "The authentication request is invalid." };
  if (status === 401) return { status, message: "Authentication failed. Check your credentials or verification code." };
  if (status === 403) return { status, message: "Administrator access is required." };
  if (status === 429) return { status, message: "Too many authentication attempts. Try again later." };
  if (status >= 500) return { status: 503, message: "CarePoint authentication is temporarily unavailable." };
  return { status, message: "Authentication could not be completed." };
}

async function verifyIssuedAdminSession(tokens: AdminSessionTokens): Promise<AdminAccount> {
  try {
    return await validateCarePointAdmin(tokens.accessToken);
  } catch (error) {
    await revokeCarePointSessionBestEffort(tokens.accessToken, tokens.sessionId);
    throw error;
  }
}

async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}${path}`, {
      ...init,
      cache: "no-store",
      headers: { accept: "application/json", ...(init.headers || {}) },
    });
  } catch {
    throw new AdminAuthError(503, "CarePoint API is unavailable.");
  }
  const text = await response.text();
  let payload: unknown = {};
  if (text) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      payload = {};
    }
  }
  if (!response.ok) throw new AdminAuthError(response.status, backendMessage(payload));
  return payload as T;
}

function backendMessage(payload: unknown): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "CarePoint API request failed.";
  const message = (payload as Record<string, unknown>).message;
  return typeof message === "string" ? message : "CarePoint API request failed.";
}

function isMfaChallenge(value: unknown): value is AdminMfaChallenge {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return row.requiresMfa === true && typeof row.challengeId === "string" && typeof row.expiresAt === "string";
}

function sessionTokens(value: unknown): AdminSessionTokens {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AdminAuthError(502, "Invalid authentication response.");
  const row = value as Record<string, unknown>;
  const fields = ["sessionId", "accessToken", "refreshToken", "expiresAt", "refreshExpiresAt"] as const;
  for (const field of fields) {
    if (typeof row[field] !== "string" || !(row[field] as string)) throw new AdminAuthError(502, "Invalid authentication response.");
  }
  return {
    sessionId: row.sessionId as string,
    accessToken: row.accessToken as string,
    refreshToken: row.refreshToken as string,
    expiresAt: row.expiresAt as string,
    refreshExpiresAt: row.refreshExpiresAt as string,
  };
}

function adminAccount(value: unknown): AdminAccount {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AdminAuthError(502, "Invalid account response.");
  const row = value as Record<string, unknown>;
  if (row.role !== "ADMIN" || row.status !== "ACTIVE") throw new AdminAuthError(403, "Administrator access is required.");
  if (typeof row.id !== "string" || typeof row.email !== "string") throw new AdminAuthError(502, "Invalid account response.");
  return {
    id: row.id,
    email: row.email,
    role: "ADMIN",
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
