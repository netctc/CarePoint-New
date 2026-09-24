import { NextRequest, NextResponse } from "next/server";
import { forwardAdminJson } from "@/lib/admin-api";
import { noStore } from "@/lib/admin-auth";

const SAFE_ID = /^[A-Za-z0-9_.:-]{1,180}$/;
const SAFE_REASON = /^[A-Z][A-Z0-9_:-]{1,63}$/;
const MAX_BODY_BYTES = 8_192;

type RouteContext = { params: Promise<{ segments: string[] }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { segments } = await context.params;
  if (segments.length !== 1 || segments[0] !== "review" || request.nextUrl.searchParams.size > 0) {
    return invalid("Unsupported dependent review read route.");
  }
  return forwardAdminJson(request, "/admin/dependents/review");
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { segments } = await context.params;
  const resolved = resolvePost(segments);
  if (!resolved) return invalid("Unsupported dependent review mutation route.");

  const body = await boundedBody(request);
  if (body instanceof NextResponse) return body;

  const normalized = normalizeBody(resolved.kind, body);
  if (normalized instanceof NextResponse) return normalized;

  return forwardAdminJson(request, resolved.path, {
    method: "POST",
    body: normalized,
    requireSameOrigin: true,
  });
}

function resolvePost(segments: string[]): { path: string; kind: "RELATION" | "EVIDENCE" } | null {
  if (segments.length === 2 && safe(segments[0]) && segments[1] === "review") {
    return {
      path: "/admin/dependents/" + encodeURIComponent(segments[0]) + "/review",
      kind: "RELATION",
    };
  }
  if (
    segments.length === 4 &&
    safe(segments[0]) &&
    segments[1] === "evidence" &&
    safe(segments[2]) &&
    segments[3] === "review"
  ) {
    return {
      path: "/admin/dependents/" + encodeURIComponent(segments[0]) +
        "/evidence/" + encodeURIComponent(segments[2]) + "/review",
      kind: "EVIDENCE",
    };
  }
  return null;
}

async function boundedBody(request: NextRequest): Promise<unknown | NextResponse> {
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
      return invalid("Dependent review request body is too large.", 413);
    }
    return raw ? JSON.parse(raw) : {};
  } catch {
    return invalid("Invalid dependent review request body.");
  }
}

function normalizeBody(kind: "RELATION" | "EVIDENCE", raw: unknown): Record<string, string> | NextResponse {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return invalid("Dependent review body must be an object.");
  }
  const row = raw as Record<string, unknown>;
  const keys = Object.keys(row);
  if (keys.some((key) => !["decision", "status", "reasonCode"].includes(key))) {
    return invalid("Unsupported dependent review field.");
  }

  const reasonCode = normalizeReason(row.reasonCode);
  if (row.reasonCode !== undefined && !reasonCode) {
    return invalid("reasonCode is invalid.");
  }

  if (kind === "RELATION") {
    const decision = typeof row.decision === "string" ? row.decision.trim().toUpperCase() : "";
    if (!["APPROVE", "REJECT"].includes(decision)) return invalid("decision is invalid.");
    if (decision === "REJECT" && !reasonCode) return invalid("reasonCode is required for rejection.");
    return { decision, ...(reasonCode ? { reasonCode } : {}) };
  }

  const status = typeof row.status === "string" ? row.status.trim().toUpperCase() : "";
  if (!["VERIFIED", "REJECTED"].includes(status)) return invalid("status is invalid.");
  if (status === "REJECTED" && !reasonCode) return invalid("reasonCode is required for rejected evidence.");
  return { status, ...(reasonCode ? { reasonCode } : {}) };
}

function normalizeReason(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return SAFE_REASON.test(normalized) ? normalized : null;
}

function safe(value: string | undefined): value is string {
  return typeof value === "string" && SAFE_ID.test(value);
}

function invalid(message: string, status = 400) {
  return noStore(NextResponse.json({ message }, { status }));
}
