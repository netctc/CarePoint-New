import { NextRequest, NextResponse } from "next/server";
import { forwardAdminJson } from "@/lib/admin-api";
import { noStore } from "@/lib/admin-auth";

const SAFE_ID = /^[A-Za-z0-9_.:-]{1,180}$/;
const MAX_BODY_BYTES = 131072;

type RouteContext = { params: Promise<{ segments: string[] }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { segments } = await context.params;
  const path = resolveGet(segments, request.nextUrl.searchParams);
  if (!path) return invalid("Unsupported provider taxonomy read route.");
  return forwardAdminJson(request, path);
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { segments } = await context.params;
  const path = resolvePost(segments);
  if (!path) return invalid("Unsupported provider taxonomy mutation route.");
  const body = await boundedBody(request);
  if (body instanceof NextResponse) return body;
  return forwardAdminJson(request, path, { method: "POST", body, requireSameOrigin: true });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { segments } = await context.params;
  const path = resolvePatch(segments);
  if (!path) return invalid("Unsupported provider taxonomy mutation route.");
  const body = await boundedBody(request);
  if (body instanceof NextResponse) return body;
  return forwardAdminJson(request, path, { method: "PATCH", body, requireSameOrigin: true });
}

function resolveGet(segments: string[], query: URLSearchParams): string | null {
  if (segments.length === 1 && segments[0] === "categories") return "/other-provider-categories";
  if (segments.length === 1 && segments[0] === "forms") {
    const categoryId = query.get("categoryId")?.trim();
    if (!categoryId) return "/admin/provider-category-forms";
    if (!SAFE_ID.test(categoryId)) return null;
    return "/admin/provider-category-forms?categoryId=" + encodeURIComponent(categoryId);
  }
  return null;
}

function resolvePost(segments: string[]): string | null {
  if (segments.length === 1 && segments[0] === "forms") return "/admin/provider-category-forms";
  if (segments.length === 3 && segments[0] === "forms" && safe(segments[1]) && segments[2] === "versions") {
    return "/admin/provider-category-forms/" + encodeURIComponent(segments[1]) + "/versions";
  }
  if (
    segments.length === 5 &&
    segments[0] === "forms" &&
    safe(segments[1]) &&
    segments[2] === "versions" &&
    /^\d{1,6}$/.test(segments[3] ?? "") &&
    segments[4] === "activate"
  ) {
    return "/admin/provider-category-forms/" + encodeURIComponent(segments[1]) + "/versions/" + segments[3] + "/activate";
  }
  return null;
}

function resolvePatch(segments: string[]): string | null {
  if (segments.length === 3 && segments[0] === "categories" && safe(segments[1]) && segments[2] === "capabilities") {
    return "/other-provider-categories/" + encodeURIComponent(segments[1]) + "/capabilities";
  }
  return null;
}

async function boundedBody(request: NextRequest): Promise<unknown | NextResponse> {
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
      return invalid("Provider taxonomy request body is too large.", 413);
    }
    return raw ? JSON.parse(raw) : {};
  } catch {
    return invalid("Invalid provider taxonomy request body.");
  }
}

function safe(value: string | undefined): value is string {
  return typeof value === "string" && SAFE_ID.test(value);
}

function invalid(message: string, status = 400) {
  return noStore(NextResponse.json({ message }, { status }));
}
