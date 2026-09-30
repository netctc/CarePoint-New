import { NextRequest } from "next/server";
import { forwardAdminJson } from "@/lib/admin-api";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ holdId: string }> },
) {
  const { holdId } = await params;
  const body = await request.json().catch(() => ({}));
  return forwardAdminJson(request, `/admin/retention/legal-holds/${encodeURIComponent(holdId)}/release`, {
    method: "POST",
    body,
    requireSameOrigin: true,
  });
}
