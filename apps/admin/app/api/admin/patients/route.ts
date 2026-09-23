import { NextRequest, NextResponse } from "next/server";
import { forwardAdminJson } from "@/lib/admin-api";

const ACCOUNT_STATUSES = new Set(["ACTIVE", "SUSPENDED", "ARCHIVED"]);

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length > 120 || /[\r\n\0]/.test(q)) {
    return NextResponse.json({ message: "q is invalid." }, { status: 400 });
  }

  const status = request.nextUrl.searchParams.get("status")?.trim().toUpperCase() ?? "";
  if (status && !ACCOUNT_STATUSES.has(status)) {
    return NextResponse.json({ message: "status is invalid." }, { status: 400 });
  }

  const limitRaw = request.nextUrl.searchParams.get("limit")?.trim() ?? "";
  if (limitRaw && (!/^\d{1,3}$/.test(limitRaw) || Number(limitRaw) < 1 || Number(limitRaw) > 100)) {
    return NextResponse.json({ message: "limit must be between 1 and 100." }, { status: 400 });
  }

  const query = new URLSearchParams();
  if (q) query.set("q", q);
  if (status) query.set("status", status);
  if (limitRaw) query.set("limit", limitRaw);
  const encoded = query.toString();
  return forwardAdminJson(request, encoded ? `/admin/patients?${encoded}` : "/admin/patients");
}
