import { NextRequest, NextResponse } from "next/server";
import {
  completeCarePointClinicalMfa,
  isTrustedClinicalSameOrigin,
  noStoreClinical,
  publicClinicalAuthError,
  writeClinicalCookies,
} from "@/lib/clinical-auth";

interface MfaBody { challengeId?: unknown; code?: unknown }

export async function POST(request: NextRequest) {
  if (!isTrustedClinicalSameOrigin(request)) {
    return noStoreClinical(NextResponse.json({ message: "Cross-origin authentication requests are not allowed." }, { status: 403 }));
  }
  let body: MfaBody;
  try { body = await request.json() as MfaBody; }
  catch { return noStoreClinical(NextResponse.json({ message: "A valid JSON body is required." }, { status: 400 })); }

  const challengeId = typeof body.challengeId === "string" ? body.challengeId.trim() : "";
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!challengeId || challengeId.length > 256 || !/^\d{6}$/.test(code)) {
    return noStoreClinical(NextResponse.json({ message: "A valid MFA challenge and six-digit code are required." }, { status: 400 }));
  }

  try {
    const result = await completeCarePointClinicalMfa(challengeId, code);
    const response = NextResponse.json({ authenticated: true, account: result.account });
    writeClinicalCookies(response, result.tokens);
    return noStoreClinical(response);
  } catch (error) {
    const failure = publicClinicalAuthError(error);
    return noStoreClinical(NextResponse.json({ message: failure.message }, { status: failure.status }));
  }
}
