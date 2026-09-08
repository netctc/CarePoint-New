import { NextRequest, NextResponse } from "next/server";
import {
  clearAdminCookies,
  noStore,
  readAdminCookies,
  refreshCarePointAdmin,
  safeReturnTo,
  validateCarePointAdmin,
  writeAdminCookies,
} from "@/lib/admin-auth";

export async function proxy(request: NextRequest) {
  const { accessToken, refreshToken } = readAdminCookies(request);

  if (accessToken) {
    try {
      await validateCarePointAdmin(accessToken);
      return noStore(NextResponse.next());
    } catch {
      // Short-lived access may have expired. Refresh rotation is attempted only through the HttpOnly cookie below.
    }
  }

  if (refreshToken) {
    try {
      const result = await refreshCarePointAdmin(refreshToken);
      const response = NextResponse.next();
      writeAdminCookies(response, result.tokens);
      return noStore(response);
    } catch {
      // Invalid, expired, replayed or non-admin refresh state is cleared before redirecting to login.
    }
  }

  const returnTo = safeReturnTo(`${request.nextUrl.pathname}${request.nextUrl.search}`);
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", returnTo);
  const response = NextResponse.redirect(loginUrl);
  clearAdminCookies(response);
  return noStore(response);
}

export const config = {
  matcher: [
    "/",
    "/providers/:path*",
    "/doctors/:path*",
    "/appointments/:path*",
    "/security/:path*",
  ],
};
