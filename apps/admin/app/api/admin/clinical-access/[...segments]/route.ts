import { NextRequest, NextResponse } from "next/server";
import { forwardAdminJson } from "@/lib/admin-api";
import { noStore } from "@/lib/admin-auth";

const ALLOWED_READS = new Set(["policies", "matrix", "audit", "provenance"]);
const PROVENANCE_FILTERS = new Set(["patientId", "domain", "limit"]);
const AUDIT_FILTERS = new Set([
  "actorId", "objectType", "objectId", "action", "purpose", "result",
  "patientId", "providerId", "from", "to", "limit",
]);
const MAX_QUERY_VALUE = 180;

type RouteContext = { params: Promise<{ segments: string[] }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { segments } = await context.params;
  if (segments.length !== 1 || !ALLOWED_READS.has(segments[0] ?? "")) {
    return invalid("Unsupported clinical governance read route.");
  }
  const segment = segments[0]!;
  if (segment !== "audit" && segment !== "provenance" && request.nextUrl.searchParams.size > 0) {
    return invalid("This clinical governance route does not accept query parameters.");
  }

  let target = "/admin/clinical-access/" + segment;
  if (segment === "provenance") {
    const patientId = request.nextUrl.searchParams.get("patientId")?.trim() ?? "";
    if (!/^[A-Za-z0-9_.:-]{1,180}$/.test(patientId)) {
      return invalid("patientId is required and invalid.");
    }
    const query = new URLSearchParams({ patientId });
    for (const [key, value] of request.nextUrl.searchParams) {
      if (!PROVENANCE_FILTERS.has(key) || value.length > MAX_QUERY_VALUE) {
        return invalid("Unsupported or oversized provenance filter.");
      }
      if (key === "patientId") continue;
      if (key === "domain" && !["ALL", "CLINICAL_PROFILE", "OBSERVATION", "QUESTIONNAIRE"].includes(value.trim().toUpperCase())) {
        return invalid("Invalid provenance domain.");
      }
      if (key === "limit" && !/^(?:[1-9]|[1-9][0-9]|1[0-9]{2}|200)$/.test(value.trim())) {
        return invalid("Invalid provenance limit.");
      }
      query.set(key, key === "domain" ? value.trim().toUpperCase() : value.trim());
    }
    target += "?" + query.toString();
  } else if (segment === "audit") {
    const query = new URLSearchParams();
    for (const [key, value] of request.nextUrl.searchParams) {
      if (!AUDIT_FILTERS.has(key) || value.length > MAX_QUERY_VALUE) {
        return invalid("Unsupported or oversized clinical audit filter.");
      }
      query.append(key, value);
    }
    const encoded = query.toString();
    if (encoded) target += "?" + encoded;
  }
  return forwardAdminJson(request, target);
}

function invalid(message: string) {
  return noStore(NextResponse.json({ message }, { status: 400 }));
}
