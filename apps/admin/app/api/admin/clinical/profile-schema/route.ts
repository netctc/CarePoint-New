import { NextRequest, NextResponse } from "next/server";
import { forwardAdminJson } from "@/lib/admin-api";

async function readJson(request: NextRequest): Promise<unknown | NextResponse> {
  const contentLength = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(contentLength) && contentLength > 160 * 1024) {
    return NextResponse.json({ message: "Clinical profile schema request is too large." }, { status: 413 });
  }
  try {
    return await request.json();
  } catch {
    return NextResponse.json({ message: "A valid JSON request body is required." }, { status: 400 });
  }
}

export async function GET(request: NextRequest) {
  return forwardAdminJson(request, `/admin/clinical/profile-schema${request.nextUrl.search}`, { method: "GET" });
}

export async function POST(request: NextRequest) {
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  return forwardAdminJson(request, "/admin/clinical/profile-schema", {
    method: "POST",
    body,
    requireSameOrigin: true,
  });
}

export async function PATCH(request: NextRequest) {
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  return forwardAdminJson(request, "/admin/clinical/profile-schema", {
    method: "PATCH",
    body,
    requireSameOrigin: true,
  });
}
