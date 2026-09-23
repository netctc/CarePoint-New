import { NextRequest, NextResponse } from "next/server";
import { forwardAdminJson } from "@/lib/admin-api";
import { noStore } from "@/lib/admin-auth";

const ALLOWED_READS = new Set(["policies", "matrix", "audit"]);
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
  if (segment !== "audit" && request.nextUrl.searchParams.size > 0) {
    return invalid("This clinical governance route does not accept query parameters.");
  }

  let target = "/admin/clinical-access/" + segment;
  if (segment === "audit") {
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
