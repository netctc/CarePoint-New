import { NextRequest } from "next/server";
import { forwardAdminJson } from "@/lib/admin-api";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  return forwardAdminJson(request, `/admin/patients${url.search}`);
}
