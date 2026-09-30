import { NextRequest, NextResponse } from "next/server";
import { forwardAdminJson } from "@/lib/admin-api";
import { noStore } from "@/lib/admin-auth";

const actions = ["RESET_READINESS", "TERMINATE_SESSION"] as const;
const reasons = ["TECHNICAL_FAILURE", "SECURITY", "PROVIDER_REQUEST", "OPERATIONS"] as const;
type TelehealthAction = (typeof actions)[number];
type TerminationReason = (typeof reasons)[number];
type Body = { action?: string; sessionId?: string; reasonCode?: string };

export async function POST(request: NextRequest) {
  let body: Body;
  try {
    body = await request.json() as Body;
  } catch {
    return noStore(NextResponse.json({ message: "Invalid telehealth action body." }, { status: 400 }));
  }

  const action = cleanEnum(body.action, actions);
  const sessionId = cleanText(body.sessionId, 160);
  if (!action) return noStore(NextResponse.json({ message: "Unsupported telehealth action." }, { status: 400 }));
  if (!sessionId) return noStore(NextResponse.json({ message: "sessionId is required." }, { status: 400 }));

  let reasonCode: TerminationReason | undefined;
  if (action === "TERMINATE_SESSION") {
    const reason = cleanEnum(body.reasonCode, reasons);
    if (!reason) return noStore(NextResponse.json({ message: "A valid termination reasonCode is required." }, { status: 400 }));
    reasonCode = reason;
  }

  return forwardAdminJson(request, "/admin/operations/telehealth/actions", {
    method: "POST",
    body: { action: action as TelehealthAction, sessionId, ...(reasonCode ? { reasonCode } : {}) },
    requireSameOrigin: true,
  });
}

function cleanEnum<T extends readonly string[]>(value: unknown, allowed: T): T[number] | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return (allowed as readonly string[]).includes(normalized) ? normalized as T[number] : null;
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned && cleaned.length <= max ? cleaned : null;
}
