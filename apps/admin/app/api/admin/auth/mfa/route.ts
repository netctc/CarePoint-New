import { NextRequest, NextResponse } from "next/server";
import {
  completeCarePointMfa,
  isTrustedSameOrigin,
  noStore,
  publicAuthError,
  writeAdminCookies,
} from "@/lib/admin-auth";

interface MfaBody {
  challengeId?: unknown;
  code?: unknown;
}

export async function POST(request: NextRequest) {
  if (!isTrustedSameOrigin(request)) return noStore(NextResponse.json({ message: "Cross-origin authentication requests are not allowed." }, { status: 403 }));

  let body: MfaBody;
  try {
    body = await request.json() as MfaBody;
  } catch {
    return noStore(NextResponse.json({ message: "A valid JSON body is required." }, { status: 400 }));
  }

  const challengeId = typeof body.challengeId === "string" ? body.challengeId.trim() : "";
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!challengeId || challengeId.length > 256 || !/^\d{6}$/.test(code)) {
    return noStore(NextResponse.json({ message: "A valid MFA challenge and six-digit code are required." }, { status: 400 }));
  }

  try {
    const result = await completeCarePointMfa(challengeId, code);
    const response = NextResponse.json({ authenticated: true, account: result.account });
    writeAdminCookies(response, result.tokens);
    return noStore(response);
  } catch (error) {
    const failure = publicAuthError(error);
    return noStore(NextResponse.json({ message: failure.message }, { status: failure.status }));
  }
}
