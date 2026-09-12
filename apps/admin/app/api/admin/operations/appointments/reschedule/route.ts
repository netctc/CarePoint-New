import { NextRequest, NextResponse } from "next/server";
import { forwardAdminJson } from "@/lib/admin-api";
import { noStore } from "@/lib/admin-auth";

interface RescheduleBody {
  appointmentId?: string;
  slotId?: string;
}

export async function POST(request: NextRequest) {
  let body: RescheduleBody;
  try {
    body = await request.json() as RescheduleBody;
  } catch {
    return noStore(NextResponse.json({ message: "Invalid reschedule body." }, { status: 400 }));
  }

  const appointmentId = cleanId(body.appointmentId);
  const slotId = cleanId(body.slotId);
  if (!appointmentId || !slotId) {
    return noStore(NextResponse.json({ message: "appointmentId and slotId are required." }, { status: 400 }));
  }

  return forwardAdminJson(
    request,
    `/admin/operations/appointments/${encodeURIComponent(appointmentId)}/reschedule`,
    { method: "POST", body: { slotId }, requireSameOrigin: true },
  );
}

function cleanId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned && cleaned.length <= 128 ? cleaned : null;
}
