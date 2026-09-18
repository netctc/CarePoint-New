import { NextRequest, NextResponse } from "next/server";
import {
  isTrustedClinicalSameOrigin,
  loginWithCarePointClinical,
  noStoreClinical,
  publicClinicalAuthError,
  writeClinicalCookies,
} from "@/lib/clinical-auth";

interface LoginBody { email?: unknown; password?: unknown }

export async function POST(request: NextRequest) {
  if (!isTrustedClinicalSameOrigin(request)) {
    return noStoreClinical(NextResponse.json({ message: "Cross-origin authentication requests are not allowed." }, { status: 403 }));
  }
  let body: LoginBody;
  try { body = await request.json() as LoginBody; }
  catch { return noStoreClinical(NextResponse.json({ message: "A valid JSON body is required." }, { status: 400 })); }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || email.length > 320 || !password || password.length > 512) {
    return noStoreClinical(NextResponse.json({ message: "Email and password are required." }, { status: 400 }));
  }

  try {
    const result = await loginWithCarePointClinical(email, password);
    if ("requiresMfa" in result) {
      return noStoreClinical(NextResponse.json({
        requiresMfa: true,
        challengeId: result.challengeId,
        expiresAt: result.expiresAt,
        ...(result.enrollmentRequired ? {
          enrollmentRequired: true,
          enrollmentSecret: result.enrollmentSecret,
          otpauthUri: result.otpauthUri,
        } : {}),
      }));
    }
    const response = NextResponse.json({ authenticated: true, account: result.account });
    writeClinicalCookies(response, result.tokens);
    return noStoreClinical(response);
  } catch (error) {
    const failure = publicClinicalAuthError(error);
    return noStoreClinical(NextResponse.json({ message: failure.message }, { status: failure.status }));
  }
}
