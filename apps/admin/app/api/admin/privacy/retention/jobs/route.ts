import { NextRequest } from "next/server";
import { forwardAdminJson } from "@/lib/admin-api";

export async function GET(request: NextRequest) {
  const limit = request.nextUrl.searchParams.get("limit") ?? "100";
  const safeLimit = /^\d{1,3}$/.test(limit) ? limit : "100";
  return forwardAdminJson(request, `/admin/retention/jobs?limit=${encodeURIComponent(safeLimit)}`);
}
