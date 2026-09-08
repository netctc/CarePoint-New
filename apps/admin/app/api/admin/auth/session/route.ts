import { NextRequest, NextResponse } from "next/server";
import {
  clearAdminCookies,
  noStore,
  readAdminCookies,
  refreshCarePointAdmin,
  validateCarePointAdmin,
  writeAdminCookies,
} from "@/lib/admin-auth";

export async function GET(request: NextRequest) {
  const { accessToken, refreshToken } = readAdminCookies(request);

  if (accessToken) {
    try {
      const account = await validateCarePointAdmin(accessToken);
      return noStore(NextResponse.json({ authenticated: true, account }));
    } catch {
      // Access tokens are intentionally short-lived. A valid HttpOnly refresh cookie may rotate the session below.
    }
  }

  if (refreshToken) {
    try {
      const result = await refreshCarePointAdmin(refreshToken);
      const response = NextResponse.json({ authenticated: true, account: result.account, refreshed: true });
      writeAdminCookies(response, result.tokens);
      return noStore(response);
    } catch {
      // Invalid, expired, replayed, suspended or non-admin refresh sessions are cleared below.
    }
  }

  const response = NextResponse.json({ authenticated: false }, { status: 401 });
  clearAdminCookies(response);
  return noStore(response);
}
