import { NextRequest, NextResponse } from "next/server";
import { forwardAdminJson } from "@/lib/admin-api";
import { noStore } from "@/lib/admin-auth";

const SAFE_ID = /^[A-Za-z0-9_.:-]{1,180}$/;
const MAX_BODY_BYTES = 131072;

type RouteContext = { params: Promise<{ segments: string[] }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { segments } = await context.params;
  const path = resolveGet(segments);
  if (!path) return invalid("Unsupported device-governance read route.");
  return forwardAdminJson(request, path);
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { segments } = await context.params;
  const path = resolvePost(segments);
  if (!path) return invalid("Unsupported device-governance mutation route.");
  const body = await boundedBody(request);
  if (body instanceof NextResponse) return body;
  return forwardAdminJson(request, path, { method: "POST", body, requireSameOrigin: true });
}

function resolveGet(segments: string[]) {
  if (segments.length === 1 && segments[0] === "devices") return "/admin/devices";
  if (segments.length === 1 && segments[0] === "integrations") return "/admin/integrations/devices";
  return null;
}

function resolvePost(segments: string[]) {
  if (segments.length === 1 && segments[0] === "models") return "/admin/devices/models";
  if (segments.length === 1 && segments[0] === "devices") return "/admin/devices";
  if (segments.length === 3 && segments[0] === "devices" && safe(segments[1]) && segments[2] === "assign") {
    return "/admin/devices/" + encodeURIComponent(segments[1]) + "/assign";
  }
  if (
    segments.length === 4 &&
    segments[0] === "devices" &&
    safe(segments[1]) &&
    segments[2] === "credentials" &&
    segments[3] === "rotate"
  ) {
    return "/admin/devices/" + encodeURIComponent(segments[1]) + "/credentials/rotate";
  }
  if (segments.length === 3 && segments[0] === "devices" && safe(segments[1]) && segments[2] === "revoke") {
    return "/admin/devices/" + encodeURIComponent(segments[1]) + "/revoke";
  }
  if (segments.length === 1 && segments[0] === "integrations") return "/admin/integrations/devices";
  if (segments.length === 3 && segments[0] === "integrations" && safe(segments[1]) && segments[2] === "revoke") {
    return "/admin/integrations/devices/" + encodeURIComponent(segments[1]) + "/revoke";
  }
  return null;
}

async function boundedBody(request: NextRequest): Promise<unknown | NextResponse> {
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) return invalid("Device-governance request body is too large.", 413);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return invalid("Invalid device-governance request body.");
  }
}

function safe(value: string | undefined): value is string {
  return typeof value === "string" && SAFE_ID.test(value);
}

function invalid(message: string, status = 400) {
  return noStore(NextResponse.json({ message }, { status }));
}
