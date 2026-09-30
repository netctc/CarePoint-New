import { NextRequest } from "next/server";
import { forwardAdminJson } from "@/lib/admin-api";

export async function GET(request: NextRequest) {
  return forwardAdminJson(request, "/admin/retention/policies");
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  return forwardAdminJson(request, "/admin/retention/policies", {
    method: "POST",
    body,
    requireSameOrigin: true,
  });
}
