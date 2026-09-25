import { NextRequest, NextResponse } from "next/server";
import { forwardAdminJson } from "@/lib/admin-api";
import { noStore } from "@/lib/admin-auth";

const SOURCES = new Set(["ALL", "TRIGGER", "DOCTOR_REQUEST"]);
const SAFE_CODE = /^[A-Z][A-Z0-9_:-]{2,79}$/;

export async function GET(request: NextRequest) {
  const input = request.nextUrl.searchParams;
  const params = new URLSearchParams();

  for (const key of ["from", "to"] as const) {
    const value = input.get(key);
    if (!value) continue;
    if (value.length > 40 || !Number.isFinite(new Date(value).getTime())) {
      return invalid(key + " must be a valid ISO date-time.");
    }
    params.set(key, value);
  }

  const source = (input.get("source") ?? "ALL").trim().toUpperCase();
  if (!SOURCES.has(source)) return invalid("source is invalid.");
  params.set("source", source);

  const code = input.get("questionnaireCode")?.trim().toUpperCase() ?? "";
  if (code) {
    if (!SAFE_CODE.test(code)) return invalid("questionnaireCode is invalid.");
    params.set("questionnaireCode", code);
  }

  const hours = input.get("abandonAfterHours");
  if (hours) {
    if (!/^\d{1,3}$/.test(hours) || Number(hours) < 24 || Number(hours) > 720) {
      return invalid("abandonAfterHours must be 24-720.");
    }
    params.set("abandonAfterHours", hours);
  }

  return forwardAdminJson(request, "/admin/questionnaires/metrics?" + params.toString());
}

function invalid(message: string) {
  return noStore(NextResponse.json({ message }, { status: 400 }));
}
