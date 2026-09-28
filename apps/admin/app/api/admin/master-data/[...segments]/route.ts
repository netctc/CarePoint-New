import { NextRequest, NextResponse } from "next/server";
import { forwardAdminJson } from "@/lib/admin-api";
import { noStore } from "@/lib/admin-auth";

const SAFE = /^[A-Za-z0-9_.:-]{1,180}$/;
const MAX_BODY_BYTES = 262144;
type RouteContext = { params: Promise<{ segments: string[] }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const path = await backendPath(context);
  if (!path) return invalid("Invalid master-data route.");
  return forwardAdminJson(request, path);
}
export async function POST(request: NextRequest, context: RouteContext) {
  const path = await backendPath(context);
  if (!path) return invalid("Invalid master-data route.");
  const body = await boundedBody(request);
  if (body instanceof NextResponse) return body;
  return forwardAdminJson(request, path, { method: "POST", body, requireSameOrigin: true });
}
export async function PATCH(request: NextRequest, context: RouteContext) {
  const path = await backendPath(context);
  if (!path) return invalid("Invalid master-data route.");
  const body = await boundedBody(request);
  if (body instanceof NextResponse) return body;
  return forwardAdminJson(request, path, { method: "PATCH", body, requireSameOrigin: true });
}
export async function DELETE(request: NextRequest, context: RouteContext) {
  const path = await backendPath(context);
  if (!path) return invalid("Invalid master-data route.");
  return forwardAdminJson(request, path, { method: "DELETE", requireSameOrigin: true });
}
async function backendPath(context: RouteContext): Promise<string | null> {
  const { segments } = await context.params;
  if (!segments.length || segments.length > 3 || !segments.every((segment) => SAFE.test(segment))) return null;
  return "/admin/master-data/" + segments.map(encodeURIComponent).join("/");
}
async function boundedBody(request: NextRequest): Promise<unknown | NextResponse> {
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) return invalid("Master-data request body is too large.", 413);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return invalid("Invalid master-data request body.");
  }
}
function invalid(message: string, status = 400) {
  return noStore(NextResponse.json({ message }, { status }));
}
