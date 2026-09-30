import { NextRequest } from "next/server";
import { forwardAdminJson } from "@/lib/admin-api";

export async function GET(request: NextRequest) {
  const source = new URL(request.url);
  const domain = source.searchParams.get("domain");
  const suffix = domain ? `?domain=${encodeURIComponent(domain)}` : "";
  return forwardAdminJson(request, `/admin/retention/legal-holds${suffix}`);
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  return forwardAdminJson(request, "/admin/retention/legal-holds", {
    method: "POST",
    body,
    requireSameOrigin: true,
  });
}
