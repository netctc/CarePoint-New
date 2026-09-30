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
import {
  clearClinicalCookies,
  noStoreClinical,
  readClinicalCookies,
  refreshCarePointClinical,
  validateCarePointClinical,
  writeClinicalCookies,
} from "@/lib/clinical-auth";

export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === "/clinical/login") return noStoreClinical(NextResponse.next());
  if (request.nextUrl.pathname === "/clinical" || request.nextUrl.pathname.startsWith("/clinical/")) {
    return clinicalProxy(request);
  }
  return adminProxy(request);
}

async function clinicalProxy(request: NextRequest) {
  const { accessToken, refreshToken } = readClinicalCookies(request);
  if (accessToken) {
    try {
      await validateCarePointClinical(accessToken);
      return noStoreClinical(NextResponse.next());
    } catch {
      // Short-lived access may have expired; server-side refresh rotation may recover below.
    }
  }

  if (refreshToken) {
    try {
      const result = await refreshCarePointClinical(refreshToken);
      const response = NextResponse.next();
      writeClinicalCookies(response, result.tokens);
      return noStoreClinical(response);
    } catch {
      // Invalid, replayed, expired or ineligible clinical sessions are cleared before redirect.
    }
  }

  const loginUrl = new URL("/clinical/login", request.url);
  const response = NextResponse.redirect(loginUrl);
  clearClinicalCookies(response);
  return noStoreClinical(response);
}

async function adminProxy(request: NextRequest) {
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
    "/telehealth/:path*",
    "/analytics/:path*",
    "/security/:path*",
    "/clinical/:path*",
  ],
};
