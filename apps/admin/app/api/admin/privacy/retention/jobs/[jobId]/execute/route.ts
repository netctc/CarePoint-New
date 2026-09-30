import { NextRequest } from "next/server";
import { forwardAdminJson } from "@/lib/admin-api";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const body = await request.json().catch(() => ({}));
  return forwardAdminJson(request, `/admin/retention/jobs/${encodeURIComponent(jobId)}/execute`, {
    method: "POST",
    body,
    requireSameOrigin: true,
  });
}
