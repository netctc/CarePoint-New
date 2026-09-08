import { NextRequest } from "next/server";
import { forwardAdminJson } from "@/lib/admin-api";

export async function GET(request: NextRequest) {
  return forwardAdminJson(request, "/admin/finance/workspace");
}
