import { NextRequest, NextResponse } from "next/server";
import {
  clearClinicalCookies,
  isTrustedClinicalSameOrigin,
  noStoreClinical,
  readClinicalCookies,
  revokeCarePointClinicalSessionBestEffort,
} from "@/lib/clinical-auth";

export async function POST(request: NextRequest) {
  if (!isTrustedClinicalSameOrigin(request)) {
    return noStoreClinical(NextResponse.json({ message: "Cross-origin logout requests are not allowed." }, { status: 403 }));
  }
  const { accessToken, sessionId } = readClinicalCookies(request);
  if (accessToken && sessionId) await revokeCarePointClinicalSessionBestEffort(accessToken, sessionId);
  const response = NextResponse.json({ authenticated: false });
  clearClinicalCookies(response);
  return noStoreClinical(response);
}
