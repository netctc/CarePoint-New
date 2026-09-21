import { NextRequest } from "next/server";
import { forwardAdminJson } from "@/lib/admin-api";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  return forwardAdminJson(request, `/admin/clinical/profile-schema${url.search}`);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  return forwardAdminJson(request, "/admin/clinical/profile-schema", {
    method: "POST",
    body,
    requireSameOrigin: true,
  });
}
