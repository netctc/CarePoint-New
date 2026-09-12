import { NextRequest, NextResponse } from "next/server";
import {
  isTrustedSameOrigin,
  loginWithCarePoint,
  noStore,
  publicAuthError,
  writeAdminCookies,
} from "@/lib/admin-auth";

interface LoginBody {
  email?: unknown;
  password?: unknown;
}

export async function POST(request: NextRequest) {
  if (!isTrustedSameOrigin(request)) return noStore(NextResponse.json({ message: "Cross-origin authentication requests are not allowed." }, { status: 403 }));

  let body: LoginBody;
  try {
    body = await request.json() as LoginBody;
  } catch {
    return noStore(NextResponse.json({ message: "A valid JSON body is required." }, { status: 400 }));
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || email.length > 320 || !password || password.length > 512) {
    return noStore(NextResponse.json({ message: "Email and password are required." }, { status: 400 }));
  }

  try {
    const result = await loginWithCarePoint(email, password);
    if ("requiresMfa" in result) {
      return noStore(NextResponse.json({
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
    writeAdminCookies(response, result.tokens);
    return noStore(response);
  } catch (error) {
    const failure = publicAuthError(error);
    return noStore(NextResponse.json({ message: failure.message }, { status: failure.status }));
  }
}
