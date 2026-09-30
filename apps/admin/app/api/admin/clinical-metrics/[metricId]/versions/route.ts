import { NextRequest } from "next/server";
import { forwardAdminJson } from "@/lib/admin-api";

export async function POST(request: NextRequest, context: { params: Promise<{ metricId: string }> }) {
  const { metricId } = await context.params;
  const body = await request.json();
  return forwardAdminJson(request, `/admin/clinical-metrics/${encodeURIComponent(metricId)}/versions`, {
    method: "POST",
    body,
    requireSameOrigin: true,
  });
}
