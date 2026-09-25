import { NextRequest, NextResponse } from "next/server";
import { forwardAdminJson } from "@/lib/admin-api";
import { noStore } from "@/lib/admin-auth";

const SAFE_ID = /^[A-Za-z0-9_.:-]{1,180}$/;
const MAX_BODY_BYTES = 65536;
type RouteContext = { params: Promise<{ segments?: string[] }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { segments = [] } = await context.params;
  if (segments.length !== 0) return invalid("Unsupported consent policy read route.");
  return forwardAdminJson(request, "/admin/consent-policies");
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { segments = [] } = await context.params;
  const path = resolvePost(segments);
  if (!path) return invalid("Unsupported consent policy mutation route.");
  const body = await boundedBody(request);
  if (body instanceof NextResponse) return body;
  return forwardAdminJson(request, path, { method: "POST", body, requireSameOrigin: true });
}

function resolvePost(segments: string[]) {
  if (segments.length === 0) return "/admin/consent-policies";
  if (segments.length === 2 && SAFE_ID.test(segments[0] ?? "") && segments[1] === "versions") {
    return "/admin/consent-policies/" + encodeURIComponent(segments[0]!) + "/versions";
  }
  if (
    segments.length === 4 && SAFE_ID.test(segments[0] ?? "") && segments[1] === "versions" &&
    /^\d{1,6}$/.test(segments[2] ?? "") && segments[3] === "activate"
  ) {
    return "/admin/consent-policies/" + encodeURIComponent(segments[0]!) + "/versions/" + segments[2]! + "/activate";
  }
  return null;
}

async function boundedBody(request: NextRequest): Promise<unknown | NextResponse> {
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) return invalid("Consent policy request body is too large.", 413);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return invalid("Invalid consent policy request body.");
  }
}
function invalid(message: string, status = 400) {
  return noStore(NextResponse.json({ message }, { status }));
}
