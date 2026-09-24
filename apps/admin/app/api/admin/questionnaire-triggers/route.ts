import { NextRequest, NextResponse } from "next/server";
import { forwardAdminJson } from "@/lib/admin-api";
import { noStore } from "@/lib/admin-auth";

const MAX_BODY_BYTES = 131072;

export async function GET(request: NextRequest) {
  return forwardAdminJson(request, "/admin/questionnaire-triggers");
}

export async function POST(request: NextRequest) {
  const body = await boundedBody(request);
  if (body instanceof NextResponse) return body;
  return forwardAdminJson(request, "/admin/questionnaire-triggers", {
    method: "POST",
    body,
    requireSameOrigin: true,
  });
}

async function boundedBody(request: NextRequest): Promise<unknown | NextResponse> {
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
      return noStore(NextResponse.json({ message: "Questionnaire trigger body is too large." }, { status: 413 }));
    }
    return raw ? JSON.parse(raw) : {};
  } catch {
    return noStore(NextResponse.json({ message: "Invalid questionnaire trigger body." }, { status: 400 }));
  }
}
