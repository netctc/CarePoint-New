import { NextRequest, NextResponse } from "next/server";
import {
  clearAdminCookies,
  isTrustedSameOrigin,
  noStore,
  readAdminCookies,
  refreshCarePointAdmin,
  revokeCarePointSession,
  revokeCarePointSessionBestEffort,
} from "@/lib/admin-auth";

export async function POST(request: NextRequest) {
  if (!isTrustedSameOrigin(request)) return noStore(NextResponse.json({ message: "Cross-origin authentication requests are not allowed." }, { status: 403 }));

  const { accessToken, refreshToken, sessionId } = readAdminCookies(request);
  let revoked = false;
  if (accessToken && sessionId) {
    try {
      await revokeCarePointSession(accessToken, sessionId);
      revoked = true;
    } catch {
      revoked = false;
    }
  }

  if (!revoked && refreshToken) {
    try {
      const rotated = await refreshCarePointAdmin(refreshToken);
      await revokeCarePointSessionBestEffort(rotated.tokens.accessToken, rotated.tokens.sessionId);
    } catch {
      // Logout remains fail-closed in the browser even when the backend session is already invalid or unavailable.
    }
  }

  const response = new NextResponse(null, { status: 204 });
  clearAdminCookies(response);
  return noStore(response);
}
