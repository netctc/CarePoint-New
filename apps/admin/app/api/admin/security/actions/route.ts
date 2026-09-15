import { NextRequest, NextResponse } from "next/server";
import { forwardAdminJson } from "@/lib/admin-api";
import { noStore } from "@/lib/admin-auth";

const actions = ["REVOKE_SESSION", "REVOKE_ACCOUNT_SESSIONS"] as const;
type SecurityAction = (typeof actions)[number];
type SecurityActionBody = { action?: string; sessionId?: string };

export async function POST(request: NextRequest) {
  let body: SecurityActionBody;
  try {
    body = await request.json() as SecurityActionBody;
  } catch {
    return noStore(NextResponse.json({ message: "Invalid security action body." }, { status: 400 }));
  }

  const action = cleanAction(body.action);
  const sessionId = cleanText(body.sessionId, 160);
  if (!action) return noStore(NextResponse.json({ message: "Unsupported security action." }, { status: 400 }));
  if (!sessionId) return noStore(NextResponse.json({ message: "sessionId is required." }, { status: 400 }));

  return forwardAdminJson(request, "/admin/security/actions", {
    method: "POST",
    body: { action, sessionId },
    requireSameOrigin: true,
  });
}

function cleanAction(value: unknown): SecurityAction | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return (actions as readonly string[]).includes(normalized) ? normalized as SecurityAction : null;
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned && cleaned.length <= max ? cleaned : null;
}
