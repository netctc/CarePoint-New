import { NextRequest, NextResponse } from "next/server";
import {
  apiBaseUrl,
  clearAdminCookies,
  isTrustedSameOrigin,
  noStore,
  readAdminCookies,
  refreshCarePointAdmin,
  validateCarePointAdmin,
  writeAdminCookies,
  type AdminSessionTokens,
} from "@/lib/admin-auth";

interface ForwardOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  requireSameOrigin?: boolean;
}

export async function forwardAdminJson(request: NextRequest, path: string, options: ForwardOptions = {}) {
  if (options.requireSameOrigin && !isTrustedSameOrigin(request)) {
    return noStore(NextResponse.json({ message: "Cross-origin admin request denied." }, { status: 403 }));
  }

  const auth = await resolveAdminAccess(request);
  if (!auth.accessToken) {
    const response = NextResponse.json({ message: "Administrator authentication is required." }, { status: 401 });
    clearAdminCookies(response);
    return noStore(response);
  }

  let backend: Response;
  try {
    backend = await fetch(`${apiBaseUrl()}${path}`, {
      method: options.method || "GET",
      cache: "no-store",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${auth.accessToken}`,
        ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
  } catch {
    return noStore(NextResponse.json({ message: "CarePoint API is temporarily unavailable." }, { status: 503 }));
  }

  const text = await backend.text();
  let payload: unknown = {};
  if (text) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      payload = { message: backend.ok ? "Invalid CarePoint API response." : "CarePoint API request failed." };
    }
  }

  const response = NextResponse.json(payload, { status: backend.status });
  if (auth.rotatedTokens) writeAdminCookies(response, auth.rotatedTokens);
  if (backend.status === 401) clearAdminCookies(response);
  return noStore(response);
}

async function resolveAdminAccess(request: NextRequest): Promise<{ accessToken: string | null; rotatedTokens?: AdminSessionTokens }> {
  const { accessToken, refreshToken } = readAdminCookies(request);
  if (accessToken) {
    try {
      await validateCarePointAdmin(accessToken);
      return { accessToken };
    } catch {
      // Short-lived access may have expired; a valid refresh cookie can rotate below.
    }
  }

  if (refreshToken) {
    try {
      const refreshed = await refreshCarePointAdmin(refreshToken);
      return { accessToken: refreshed.tokens.accessToken, rotatedTokens: refreshed.tokens };
    } catch {
      return { accessToken: null };
    }
  }

  return { accessToken: null };
}
