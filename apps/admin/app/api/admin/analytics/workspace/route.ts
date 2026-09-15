import { NextRequest } from "next/server";
import { forwardAdminJson } from "@/lib/admin-api";

export async function GET(request: NextRequest) {
  const days = request.nextUrl.searchParams.get("days");
  const query = days ? `?days=${encodeURIComponent(days)}` : "";
  return forwardAdminJson(request, `/admin/operations/analytics/workspace${query}`);
}
