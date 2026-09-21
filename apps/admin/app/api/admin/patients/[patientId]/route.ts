import { NextRequest } from "next/server";
import { forwardAdminJson } from "@/lib/admin-api";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ patientId: string }> },
) {
  const { patientId } = await params;
  return forwardAdminJson(request, `/admin/patients/${encodeURIComponent(patientId)}`);
}
