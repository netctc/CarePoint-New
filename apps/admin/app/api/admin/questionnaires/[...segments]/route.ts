import { NextRequest, NextResponse } from "next/server";
import { forwardAdminJson } from "@/lib/admin-api";
import { noStore } from "@/lib/admin-auth";

const SAFE_ID = /^[A-Za-z0-9_.:-]{1,180}$/;
const MAX_BODY_BYTES = 131072;
type RouteContext = { params: Promise<{ segments: string[] }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const { segments } = await context.params;
  const path = resolvePost(segments);
  if (!path) return invalid("Unsupported questionnaire mutation route.");
  const body = await boundedBody(request);
  if (body instanceof NextResponse) return body;
  return forwardAdminJson(request, path, { method: "POST", body, requireSameOrigin: true });
}

function resolvePost(segments: string[]): string | null {
  if (segments.length === 2 && safe(segments[0]) && segments[1] === "versions") {
    return "/admin/questionnaires/" + encodeURIComponent(segments[0]) + "/versions";
  }
  if (
    segments.length === 4 &&
    safe(segments[0]) &&
    segments[1] === "versions" &&
    /^\d{1,6}$/.test(segments[2] ?? "") &&
    segments[3] === "activate"
  ) {
    return "/admin/questionnaires/" + encodeURIComponent(segments[0]) + "/versions/" + segments[2] + "/activate";
  }
  return null;
}

function safe(value: string | undefined): value is string {
  return typeof value === "string" && SAFE_ID.test(value);
}

async function boundedBody(request: NextRequest): Promise<unknown | NextResponse> {
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) return invalid("Questionnaire request body is too large.", 413);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return invalid("Invalid questionnaire request body.");
  }
}

function invalid(message: string, status = 400) {
  return noStore(NextResponse.json({ message }, { status }));
}
