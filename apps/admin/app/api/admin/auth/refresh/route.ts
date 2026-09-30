import { NextRequest, NextResponse } from "next/server";
import {
  clearAdminCookies,
  isTrustedSameOrigin,
  noStore,
  publicAuthError,
  readAdminCookies,
  refreshCarePointAdmin,
  writeAdminCookies,
} from "@/lib/admin-auth";

export async function POST(request: NextRequest) {
  if (!isTrustedSameOrigin(request)) return noStore(NextResponse.json({ message: "Cross-origin authentication requests are not allowed." }, { status: 403 }));

  const { refreshToken } = readAdminCookies(request);
  if (!refreshToken) {
    const response = NextResponse.json({ message: "No refresh session is available." }, { status: 401 });
    clearAdminCookies(response);
    return noStore(response);
  }

  try {
    const result = await refreshCarePointAdmin(refreshToken);
    const response = NextResponse.json({ refreshed: true, account: result.account });
    writeAdminCookies(response, result.tokens);
    return noStore(response);
  } catch (error) {
    const failure = publicAuthError(error);
    const response = NextResponse.json({ message: failure.message }, { status: failure.status });
    clearAdminCookies(response);
    return noStore(response);
  }
}
