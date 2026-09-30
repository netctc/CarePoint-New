import { NextRequest } from "next/server";
import { forwardAdminJson } from "@/lib/admin-api";

export async function GET(request: NextRequest) {
  const offset = request.nextUrl.searchParams.get("tzOffsetMinutes");
  const query = offset === null ? "" : `?tzOffsetMinutes=${encodeURIComponent(offset)}`;
  return forwardAdminJson(request, `/admin/operations/command-center${query}`);
}
