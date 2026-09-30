import { NextRequest, NextResponse } from "next/server";
import {
  clearClinicalCookies,
  noStoreClinical,
  readClinicalCookies,
  refreshCarePointClinical,
  validateCarePointClinical,
  writeClinicalCookies,
} from "@/lib/clinical-auth";

export async function GET(request: NextRequest) {
  const { accessToken, refreshToken } = readClinicalCookies(request);
  if (accessToken) {
    try {
      const account = await validateCarePointClinical(accessToken);
      return noStoreClinical(NextResponse.json({ authenticated: true, account }));
    } catch {
      // Continue to server-side refresh rotation if available.
    }
  }
  if (refreshToken) {
    try {
      const result = await refreshCarePointClinical(refreshToken);
      const response = NextResponse.json({ authenticated: true, account: result.account, refreshed: true });
      writeClinicalCookies(response, result.tokens);
      return noStoreClinical(response);
    } catch {
      // Invalid, replayed, expired or no-longer-eligible clinical sessions are cleared below.
    }
  }
  const response = NextResponse.json({ authenticated: false }, { status: 401 });
  clearClinicalCookies(response);
  return noStoreClinical(response);
}
