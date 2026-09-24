import { NextRequest, NextResponse } from "next/server";
import { forwardAdminJson } from "@/lib/admin-api";
import { noStore } from "@/lib/admin-auth";

const SAFE_ID = /^[A-Za-z0-9_.:-]{1,180}$/;
const VERSION = /^\d{1,6}$/;
const MAX_BODY_BYTES = 131072;
type RouteContext = { params: Promise<{ segments: string[] }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const { segments } = await context.params;
  const path = resolvePost(segments);
  if (!path) return invalid("Unsupported questionnaire trigger mutation route.");
  const body = await boundedBody(request);
  if (body instanceof NextResponse) return body;
  return forwardAdminJson(request, path, { method: "POST", body, requireSameOrigin: true });
}

function resolvePost(parts: string[]): string | null {
  if (parts.length === 2 && safe(parts[0]) && parts[1] === "versions") {
    return "/admin/questionnaire-triggers/" + encodeURIComponent(parts[0]) + "/versions";
  }
  if (
    parts.length === 4 &&
    safe(parts[0]) &&
    parts[1] === "versions" &&
    VERSION.test(parts[2] ?? "") &&
    ["simulate","activate","manual-dispatch"].includes(parts[3] ?? "")
  ) {
    return "/admin/questionnaire-triggers/" + encodeURIComponent(parts[0]) +
      "/versions/" + parts[2] + "/" + parts[3];
  }
  return null;
}

function safe(value: string | undefined): value is string {
  return typeof value === "string" && SAFE_ID.test(value);
}

async function boundedBody(request: NextRequest): Promise<unknown | NextResponse> {
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) return invalid("Questionnaire trigger body is too large.", 413);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return invalid("Invalid questionnaire trigger body.");
  }
}

function invalid(message: string, status = 400) {
  return noStore(NextResponse.json({ message }, { status }));
}
