import { NextRequest } from "next/server";
import { forwardAdminJson } from "@/lib/admin-api";

export async function GET(request: NextRequest) {
  const params = new URLSearchParams();
  const providerClass = request.nextUrl.searchParams.get("class")?.trim();
  const query = request.nextUrl.searchParams.get("q")?.trim();
  if (providerClass === "DOCTOR" || providerClass === "OTHER_PROVIDER") params.set("class", providerClass);
  if (query) params.set("q", query.slice(0, 160));
  const suffix = params.toString();
  return forwardAdminJson(request, "/admin/provider-administration" + (suffix ? "?" + suffix : ""));
}
