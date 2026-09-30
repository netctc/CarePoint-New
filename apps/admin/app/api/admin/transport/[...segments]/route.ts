import { NextRequest, NextResponse } from "next/server";
import { forwardAdminJson } from "@/lib/admin-api";
import { noStore } from "@/lib/admin-auth";

const SAFE = /^[A-Za-z0-9_.:-]{1,180}$/;
const MAX_BODY_BYTES = 64 * 1024;
type RouteContext = { params: Promise<{ segments: string[] }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const path = await backendPath(context);
  if (!path) return invalid("Invalid transport administration route.");
  const withQuery = transportQueryPath(request, path);
  if (!withQuery) return invalid("Invalid transport administration query.");
  return forwardAdminJson(request, withQuery);
}

export async function POST(request: NextRequest, context: RouteContext) {
  const path = await backendPath(context);
  if (!path) return invalid("Invalid transport administration route.");
  const body = await boundedBody(request);
  if (body instanceof NextResponse) return body;
  return forwardAdminJson(request, path, {
    method: "POST",
    body,
    requireSameOrigin: true,
  });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const path = await backendPath(context);
  if (!path) return invalid("Invalid transport administration route.");
  const body = await boundedBody(request);
  if (body instanceof NextResponse) return body;
  return forwardAdminJson(request, path, {
    method: "PATCH",
    body,
    requireSameOrigin: true,
  });
}

async function backendPath(context: RouteContext): Promise<string | null> {
  const { segments } = await context.params;
  if (!segments.length || segments.length > 6 || !segments.every((segment) => SAFE.test(segment))) {
    return null;
  }

  if (
    segments.length === 4 &&
    segments[0] === "dispatch" &&
    segments[3] === "assign"
  ) {
    const requestIdSegment = segments[2];
    if (!requestIdSegment) return null;
    const requestId = encodeURIComponent(requestIdSegment);
    if (segments[1] === "medical") {
      return "/operations/medical-transport/" + requestId + "/assign";
    }
    if (segments[1] === "emergency") {
      return "/operations/emergency/ambulance/" + requestId + "/assign";
    }
    return null;
  }

  return "/admin/transport/" + segments.map(encodeURIComponent).join("/");
}

function transportQueryPath(request: NextRequest, path: string): string | null {
  const query = new URLSearchParams();

  if (path === "/admin/transport/performance-analytics") {
    for (const key of ["windowDays", "forecastDays"] as const) {
      const value = request.nextUrl.searchParams.get(key);
      if (value == null) continue;
      if (!/^\d{1,3}$/.test(value)) return null;
      query.set(key, value);
    }
  } else if (
    path === "/admin/transport/command-center" ||
    path === "/admin/transport/management-report"
  ) {
    const numericKeys =
      path === "/admin/transport/command-center"
        ? (["windowDays", "page", "limit"] as const)
        : (["windowDays"] as const);
    for (const key of numericKeys) {
      const value = request.nextUrl.searchParams.get(key);
      if (value == null) continue;
      if (!/^\d{1,4}$/.test(value)) return null;
      query.set(key, value);
    }

    const mode = request.nextUrl.searchParams.get("mode");
    if (mode != null) {
      const normalized = mode.toUpperCase();
      if (!["ALL", "GROUND", "AIR"].includes(normalized)) return null;
      query.set("mode", normalized);
    }

    const sla = request.nextUrl.searchParams.get("sla");
    if (sla != null) {
      const normalized = sla.toUpperCase();
      if (!["ALL", "BREACHED", "COMPLIANT", "PENDING"].includes(normalized)) {
        return null;
      }
      query.set("sla", normalized);
    }

    const providerId = request.nextUrl.searchParams.get("providerId");
    if (providerId != null) {
      if (!SAFE.test(providerId)) return null;
      query.set("providerId", providerId);
    }
  } else {
    return path;
  }

  const suffix = query.toString();
  return suffix ? path + "?" + suffix : path;
}

async function boundedBody(request: NextRequest): Promise<unknown | NextResponse> {
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
      return invalid("Transport administration request body is too large.", 413);
    }
    return raw ? JSON.parse(raw) : {};
  } catch {
    return invalid("Invalid transport administration request body.");
  }
}

function invalid(message: string, status = 400) {
  return noStore(NextResponse.json({ message }, { status }));
}
