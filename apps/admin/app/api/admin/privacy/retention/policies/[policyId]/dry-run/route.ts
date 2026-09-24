import { NextRequest } from "next/server";
import { forwardAdminJson } from "@/lib/admin-api";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ policyId: string }> },
) {
  const { policyId } = await params;
  const body = await request.json().catch(() => ({}));
  return forwardAdminJson(request, `/admin/retention/policies/${encodeURIComponent(policyId)}/dry-run`, {
    method: "POST",
    body,
    requireSameOrigin: true,
  });
}
