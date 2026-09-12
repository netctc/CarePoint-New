import { NextRequest, NextResponse } from "next/server";
import { forwardAdminJson } from "@/lib/admin-api";
import { noStore } from "@/lib/admin-auth";

export async function GET(request: NextRequest) {
  const appointmentId = cleanId(request.nextUrl.searchParams.get("appointmentId"));
  if (!appointmentId) return noStore(NextResponse.json({ message: "appointmentId is required." }, { status: 400 }));

  const target = new URLSearchParams();
  for (const key of ["from", "to"] as const) {
    const value = request.nextUrl.searchParams.get(key);
    if (value) target.set(key, value);
  }
  const query = target.toString();
  return forwardAdminJson(
    request,
    `/admin/operations/appointments/${encodeURIComponent(appointmentId)}/reschedule-options${query ? `?${query}` : ""}`,
  );
}

function cleanId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned && cleaned.length <= 128 ? cleaned : null;
}
