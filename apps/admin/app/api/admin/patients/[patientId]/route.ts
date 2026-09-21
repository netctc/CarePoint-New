import { NextRequest } from "next/server";
import { forwardAdminJson } from "@/lib/admin-api";

type RouteContext = { params: Promise<{ patientId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { patientId } = await context.params;
  return forwardAdminJson(request, `/admin/patients/${encodeURIComponent(patientId)}`, { method: "GET" });
}
