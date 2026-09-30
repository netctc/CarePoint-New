import { NextRequest, NextResponse } from "next/server";
import { forwardAdminJson } from "@/lib/admin-api";

export async function GET(request: NextRequest) {
  const jurisdiction = request.nextUrl.searchParams.get("jurisdiction")?.trim().toUpperCase() ?? "";
  if (jurisdiction && !/^[A-Z][A-Z0-9_-]{1,31}$/.test(jurisdiction)) {
    return NextResponse.json({ message: "jurisdiction is invalid." }, { status: 400 });
  }

  const query = new URLSearchParams();
  if (jurisdiction) query.set("jurisdiction", jurisdiction);
  const encoded = query.toString();
  return forwardAdminJson(request, encoded ? `/admin/clinical/profile-schema?${encoded}` : "/admin/clinical/profile-schema");
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  return forwardAdminJson(request, "/admin/clinical/profile-schema", {
    method: "POST",
    body,
    requireSameOrigin: true,
  });
}
