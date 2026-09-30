import { NextRequest, NextResponse } from "next/server";
import { forwardAdminJson } from "@/lib/admin-api";
import { noStore } from "@/lib/admin-auth";

const statuses = new Set(["PENDING", "REVIEWED"]);

export async function GET(request: NextRequest) {
  const status = (request.nextUrl.searchParams.get("status") || "PENDING").trim().toUpperCase();
  if (!statuses.has(status)) {
    return noStore(NextResponse.json({ message: "Unsupported break-glass review status." }, { status: 400 }));
  }
  return forwardAdminJson(request, `/admin/emergency-access/reviews?status=${encodeURIComponent(status)}`, { method: "GET" });
}
