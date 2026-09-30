import { NextRequest, NextResponse } from "next/server";
import { adminBackendFetch, readBoundedAdminBackendText } from "@/lib/admin-backend-policy.js";
import {
  clearClinicalCookies,
  isTrustedClinicalSameOrigin,
  noStoreClinical,
  readClinicalCookies,
  refreshCarePointClinical,
  validateCarePointClinical,
  writeClinicalCookies,
  type ClinicalSessionTokens,
} from "@/lib/clinical-auth";

interface ForwardOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  requireSameOrigin?: boolean;
}

export async function forwardClinicalJson(request: NextRequest, path: string, options: ForwardOptions = {}) {
  if (options.requireSameOrigin && !isTrustedClinicalSameOrigin(request)) {
    return noStoreClinical(NextResponse.json({ message: "Cross-origin clinical request denied." }, { status: 403 }));
  }

  const auth = await resolveClinicalAccess(request);
  if (!auth.accessToken) {
    const response = NextResponse.json({ message: "Clinical provider authentication is required." }, { status: 401 });
    clearClinicalCookies(response);
    return noStoreClinical(response);
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
    return noStoreClinical(NextResponse.json({ message: "CarePoint API is temporarily unavailable." }, { status: 503 }));
  }

  let text: string;
  try {
    text = await readBoundedAdminBackendText(backend);
  } catch {
    const response = NextResponse.json({ message: "Invalid CarePoint API response." }, { status: 502 });
    if (auth.rotatedTokens) writeClinicalCookies(response, auth.rotatedTokens);
    if (backend.status === 401) clearClinicalCookies(response);
    return noStoreClinical(response);
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
  if (auth.rotatedTokens) writeClinicalCookies(response, auth.rotatedTokens);
  if (backend.status === 401) clearClinicalCookies(response);
  return noStoreClinical(response);
}

async function resolveClinicalAccess(request: NextRequest): Promise<{ accessToken: string | null; rotatedTokens?: ClinicalSessionTokens }> {
  const { accessToken, refreshToken } = readClinicalCookies(request);
  if (accessToken) {
    try {
      await validateCarePointClinical(accessToken);
      return { accessToken };
    } catch {
      // A short-lived access token may have expired. Refresh rotation remains server-side only.
    }
  }

  if (refreshToken) {
    try {
      const refreshed = await refreshCarePointClinical(refreshToken);
      return { accessToken: refreshed.tokens.accessToken, rotatedTokens: refreshed.tokens };
    } catch {
      return { accessToken: null };
    }
  }

  return { accessToken: null };
}
