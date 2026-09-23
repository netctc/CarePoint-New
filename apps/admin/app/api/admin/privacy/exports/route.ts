import { NextRequest } from "next/server";
import { forwardAdminJson } from "@/lib/admin-api";

export async function GET(request: NextRequest) {
  const source = new URL(request.url);
  const query = new URLSearchParams();
  const status = source.searchParams.get("status");
  const limit = source.searchParams.get("limit");
  if (status) query.set("status", status);
  if (limit) query.set("limit", limit);
  const suffix = query.size ? `?${query.toString()}` : "";
  return forwardAdminJson(request, `/admin/patient-exports${suffix}`);
}
