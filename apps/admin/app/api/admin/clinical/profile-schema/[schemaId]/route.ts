import { NextRequest } from "next/server";
import { forwardAdminJson } from "@/lib/admin-api";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ schemaId: string }> },
) {
  const { schemaId } = await params;
  const body = await request.json();
  return forwardAdminJson(request, `/admin/clinical/profile-schema/${encodeURIComponent(schemaId)}`, {
    method: "PATCH",
    body,
    requireSameOrigin: true,
  });
}
