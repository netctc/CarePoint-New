import { NextRequest, NextResponse } from "next/server";
import { forwardAdminJson } from "@/lib/admin-api";
import { noStore } from "@/lib/admin-auth";

const SAFE_ID = /^[A-Za-z0-9_.:-]{1,180}$/;
const OUTCOMES = new Set(["APPROPRIATE", "INAPPROPRIATE", "NEEDS_FOLLOW_UP"]);
const REASONS = new Set(["POLICY_CONFORMANT", "PATIENT_SAFETY_JUSTIFIED", "INSUFFICIENT_JUSTIFICATION", "SCOPE_EXCESSIVE", "FOLLOW_UP_REQUIRED"]);

type Context = { params: Promise<{ grantId: string }> };

export async function POST(request: NextRequest, context: Context) {
  const { grantId } = await context.params;
  if (!SAFE_ID.test(grantId)) return invalid("Invalid emergency-access grant ID.");
  let body: { outcome?: unknown; reasonCode?: unknown };
  try {
    body = await request.json() as { outcome?: unknown; reasonCode?: unknown };
  } catch {
    return invalid("Invalid emergency-access review body.");
  }
  const outcome = String(body.outcome ?? "").trim().toUpperCase();
  const reasonCode = String(body.reasonCode ?? "").trim().toUpperCase();
  if (!OUTCOMES.has(outcome) || !REASONS.has(reasonCode)) return invalid("Invalid emergency-access review decision.");
  return forwardAdminJson(request, `/admin/emergency-access/${encodeURIComponent(grantId)}/review`, {
    method: "POST",
    body: { outcome, reasonCode },
    requireSameOrigin: true,
  });
}

function invalid(message: string) {
  return noStore(NextResponse.json({ message }, { status: 400 }));
}
