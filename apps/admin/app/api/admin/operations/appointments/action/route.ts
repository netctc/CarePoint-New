import { NextRequest, NextResponse } from "next/server";
import { forwardAdminJson } from "@/lib/admin-api";
import { noStore } from "@/lib/admin-auth";

const ACTIONS = ["CANCEL", "COMPLETE", "NO_SHOW"] as const;
const REASONS = ["PATIENT_REQUEST", "PROVIDER_UNAVAILABLE", "OPERATIONS", "DUPLICATE", "OTHER"] as const;
type Action = (typeof ACTIONS)[number];
type Reason = (typeof REASONS)[number];

interface AppointmentActionBody {
  appointmentId?: string;
  action?: string;
  reasonCode?: string;
}

export async function POST(request: NextRequest) {
  let body: AppointmentActionBody;
  try {
    body = await request.json() as AppointmentActionBody;
  } catch {
    return noStore(NextResponse.json({ message: "Invalid appointment intervention body." }, { status: 400 }));
  }

  const appointmentId = cleanId(body.appointmentId);
  const action = normalize(body.action, ACTIONS);
  if (!appointmentId || !action) {
    return noStore(NextResponse.json({ message: "appointmentId and a supported action are required." }, { status: 400 }));
  }

  let reasonCode: Reason | null = null;
  if (action === "CANCEL") {
    reasonCode = normalize(body.reasonCode, REASONS);
    if (!reasonCode) return noStore(NextResponse.json({ message: "A supported cancellation reason is required." }, { status: 400 }));
  }

  return forwardAdminJson(request, `/admin/operations/appointments/${encodeURIComponent(appointmentId)}/intervention`, {
    method: "POST",
    body: { action, ...(reasonCode ? { reasonCode } : {}) },
    requireSameOrigin: true,
  });
}

function cleanId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned && cleaned.length <= 128 ? cleaned : null;
}

function normalize<T extends readonly string[]>(value: unknown, allowed: T): T[number] | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return (allowed as readonly string[]).includes(normalized) ? normalized as T[number] : null;
}
