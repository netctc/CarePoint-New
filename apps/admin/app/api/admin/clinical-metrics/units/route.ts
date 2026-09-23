import { NextRequest } from "next/server";
import { forwardAdminJson } from "@/lib/admin-api";

export async function POST(request: NextRequest) {
  const body = await request.json();
  return forwardAdminJson(request, "/admin/clinical-metrics/units", {
    method: "POST",
    body,
    requireSameOrigin: true,
  });
}
