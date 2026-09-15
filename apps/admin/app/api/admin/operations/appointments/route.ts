import { NextRequest } from "next/server";
import { forwardAdminJson } from "@/lib/admin-api";

const FORWARDED_PARAMS = ["from", "to", "modality", "status", "providerId", "tzOffsetMinutes"] as const;

export async function GET(request: NextRequest) {
  const target = new URLSearchParams();
  for (const key of FORWARDED_PARAMS) {
    const value = request.nextUrl.searchParams.get(key);
    if (value) target.set(key, value);
  }
  const query = target.toString();
  return forwardAdminJson(request, `/admin/operations/appointments${query ? `?${query}` : ""}`);
}
