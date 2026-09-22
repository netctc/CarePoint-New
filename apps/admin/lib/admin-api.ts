import { NextRequest, NextResponse } from "next/server";
import { adminBackendFetch, readBoundedAdminBackendBytes, readBoundedAdminBackendText } from "@/lib/admin-backend-policy.js";
import {
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
    backend = await adminBackendFetch(path, {
      method: options.method || "GET",
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

  let text: string;
  try {
    text = await readBoundedAdminBackendText(backend);
  } catch {
    const response = NextResponse.json({ message: "Invalid CarePoint API response." }, { status: 502 });
    if (auth.rotatedTokens) writeAdminCookies(response, auth.rotatedTokens);
    if (backend.status === 401) clearAdminCookies(response);
    return noStore(response);
  }

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

export async function forwardAdminBinary(request: NextRequest, path: string) {
  const auth = await resolveAdminAccess(request);
  if (!auth.accessToken) {
    const response = NextResponse.json({ message: "Administrator authentication is required." }, { status: 401 });
    clearAdminCookies(response);
    return noStore(response);
  }

  let backend: Response;
  try {
    backend = await adminBackendFetch(path, {
      method: "GET",
      headers: {
        accept: "application/x-ndjson, application/octet-stream;q=0.9",
        authorization: `Bearer ${auth.accessToken}`,
      },
    });
  } catch {
    return noStore(NextResponse.json({ message: "CarePoint API is temporarily unavailable." }, { status: 503 }));
  }

  if (!backend.ok) {
    let message = "CarePoint API request failed.";
    try {
      const text = await readBoundedAdminBackendText(backend);
      if (text) {
        const payload = JSON.parse(text) as { message?: unknown };
        if (typeof payload.message === "string") message = payload.message;
      }
    } catch {
      // Preserve generic bounded failure message.
    }
    const response = NextResponse.json({ message }, { status: backend.status });
    if (auth.rotatedTokens) writeAdminCookies(response, auth.rotatedTokens);
    if (backend.status === 401) clearAdminCookies(response);
    return noStore(response);
  }

  let bytes: Uint8Array;
  try {
    bytes = await readBoundedAdminBackendBytes(backend);
  } catch {
    const response = NextResponse.json({ message: "Invalid or oversized CarePoint API response." }, { status: 502 });
    if (auth.rotatedTokens) writeAdminCookies(response, auth.rotatedTokens);
    return noStore(response);
  }

  const response = new NextResponse(bytes, {
    status: backend.status,
    headers: {
      "content-type": backend.headers.get("content-type") || "application/octet-stream",
      "content-disposition": backend.headers.get("content-disposition") || 'attachment; filename="carepoint-export.bin"',
      "cache-control": "private, no-store, max-age=0",
      pragma: "no-cache",
      "x-content-type-options": "nosniff",
    },
  });
  if (auth.rotatedTokens) writeAdminCookies(response, auth.rotatedTokens);
  return response;
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
