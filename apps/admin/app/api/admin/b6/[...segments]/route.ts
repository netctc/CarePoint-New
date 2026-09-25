import { NextRequest, NextResponse } from "next/server";
import { forwardAdminBinary, forwardAdminJson } from "@/lib/admin-api";
import { noStore } from "@/lib/admin-auth";

const SAFE_ID = /^[A-Za-z0-9_.:-]{1,180}$/;
const MAX_BODY_BYTES = 65_536;

type RouteContext = { params: Promise<{ segments: string[] }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { segments } = await context.params;
  const download = resolveAuditDownload(segments, request.nextUrl.searchParams);
  if (download) return forwardAdminBinary(request, download);
  const resolved = resolveGet(segments, request.nextUrl.searchParams);
  if (!resolved) return invalid("Unsupported B6 governance read route.");
  return forwardAdminJson(request, resolved);
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { segments } = await context.params;
  const resolved = resolvePost(segments);
  if (!resolved) return invalid("Unsupported B6 governance mutation route.");

  let body: unknown;
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
      return invalid("Governance request body is too large.", 413);
    }
    body = raw ? JSON.parse(raw) : {};
  } catch {
    return invalid("Invalid governance request body.");
  }

  return forwardAdminJson(request, resolved, {
    method: "POST",
    body,
    requireSameOrigin: true,
  });
}

function resolveGet(segments: string[], query: URLSearchParams): string | null {
  const path = segments.join("/");
  if (path === "terminology/systems") return "/admin/terminology/systems";
  if (path === "terminology/search") {
    const out = new URLSearchParams();
    const q = cleanText(query.get("q"), 120);
    const system = cleanText(query.get("system"), 180);
    const limit = cleanLimit(query.get("limit"), 1, 100);
    if (q) out.set("q", q);
    if (system) out.set("system", system);
    if (limit) out.set("limit", limit);
    const suffix = out.toString();
    return suffix ? `/terminology/search?${suffix}` : "/terminology/search";
  }
  if (path === "data-quality/rules") return "/admin/data-quality/rules";
  if (path === "data-quality/runs") {
    const limit = cleanLimit(query.get("limit"), 1, 200);
    return limit ? `/admin/data-quality/runs?limit=${limit}` : "/admin/data-quality/runs";
  }
  if (path === "data-quality/issues") {
    const out = new URLSearchParams();
    const status = cleanEnum(query.get("status"), ["OPEN", "ACKNOWLEDGED", "RESOLVED", "DISMISSED"]);
    const ruleCode = cleanCode(query.get("ruleCode"));
    const limit = cleanLimit(query.get("limit"), 1, 500);
    if (status) out.set("status", status);
    if (ruleCode) out.set("ruleCode", ruleCode);
    if (limit) out.set("limit", limit);
    const suffix = out.toString();
    return suffix ? `/admin/data-quality/issues?${suffix}` : "/admin/data-quality/issues";
  }
  if (segments.length === 2 && segments[0] === "patient-merge" && safeId(segments[1])) {
    return `/admin/patients/merge/${encodeURIComponent(segments[1])}`;
  }
  if (path === "notification-templates") return "/admin/notification-templates";
  if (path === "feature-flags") return "/admin/feature-flags";
  if (path === "care-plan-templates") return "/admin/care-plan-templates";
  if (path === "rpm/workspace") return "/admin/rpm/workspace";
  if (path === "rpm/alerts") return "/admin/rpm/alerts";
  if (path === "localization") return "/admin/localization";
  if (path === "patient-duplicates") {
    const limit = cleanLimit(query.get("limit"), 1, 250);
    return limit ? "/admin/patient-duplicates?limit=" + limit : "/admin/patient-duplicates";
  }
  if (path === "integrations") return "/admin/integrations";
  if (path === "integrations/fhir") return "/admin/integrations/fhir";
  if (path === "integrations/labs") return "/admin/integrations/labs";
  if (path === "clinical-operations") {
    const limit = cleanLimit(query.get("limit"), 1, 200);
    return limit ? "/admin/clinical-operations?limit=" + limit : "/admin/clinical-operations";
  }
  if (path === "credential-expirations") return "/admin/governance/credential-expirations";
  if (path === "audit-exports") {
    const limit = cleanLimit(query.get("limit"), 1, 100);
    return limit ? "/admin/audit-exports?limit=" + limit : "/admin/audit-exports";
  }
  if (segments.length === 2 && segments[0] === "audit-exports" && safeId(segments[1])) {
    return "/admin/audit-exports/" + encodeURIComponent(segments[1]);
  }
  return null;
}

function resolvePost(segments: string[]): string | null {
  const path = segments.join("/");
  if (path === "terminology/systems") return "/admin/terminology/systems";
  if (path === "terminology/concepts") return "/admin/terminology/concepts";
  if (
    segments.length === 4 &&
    segments[0] === "terminology" &&
    segments[1] === "concepts" &&
    safeId(segments[2]) &&
    segments[3] === "versions"
  ) {
    return `/admin/terminology/concepts/${encodeURIComponent(segments[2])}/versions`;
  }
  if (path === "data-quality/run") return "/admin/data-quality/run";
  if (
    segments.length === 4 &&
    segments[0] === "data-quality" &&
    segments[1] === "issues" &&
    safeId(segments[2]) &&
    segments[3] === "status"
  ) {
    return `/admin/data-quality/issues/${encodeURIComponent(segments[2])}/status`;
  }
  if (path === "patient-merge/preview") return "/admin/patients/merge/preview";
  if (
    segments.length === 3 &&
    segments[0] === "patient-merge" &&
    safeId(segments[1]) &&
    segments[2] === "execute"
  ) {
    return `/admin/patients/merge/${encodeURIComponent(segments[1])}/execute`;
  }
  if (path === "notification-templates") return "/admin/notification-templates";
  if (
    segments.length === 3 &&
    segments[0] === "notification-templates" &&
    safeId(segments[1]) &&
    segments[2] === "versions"
  ) {
    return `/admin/notification-templates/${encodeURIComponent(segments[1])}/versions`;
  }
  if (path === "feature-flags") return "/admin/feature-flags";
  if (path === "care-plan-templates") return "/admin/care-plan-templates";
  if (
    segments.length === 3 &&
    segments[0] === "care-plan-templates" &&
    safeId(segments[1]) &&
    segments[2] === "versions"
  ) {
    return "/admin/care-plan-templates/" + encodeURIComponent(segments[1]) + "/versions";
  }
  if (
    segments.length === 5 &&
    segments[0] === "care-plan-templates" &&
    safeId(segments[1]) &&
    segments[2] === "versions" &&
    /^[1-9]\d{0,8}$/.test(segments[3] ?? "") &&
    segments[4] === "activate"
  ) {
    return "/admin/care-plan-templates/" + encodeURIComponent(segments[1]) + "/versions/" + segments[3] + "/activate";
  }
  if (
    segments.length === 3 &&
    segments[0] === "feature-flags" &&
    safeId(segments[1]) &&
    segments[2] === "versions"
  ) {
    return `/admin/feature-flags/${encodeURIComponent(segments[1])}/versions`;
  }
  if (path === "localization/keys") return "/admin/localization/keys";
  if (
    segments.length === 4 &&
    segments[0] === "localization" &&
    segments[1] === "keys" &&
    safeId(segments[2]) &&
    segments[3] === "versions"
  ) {
    return `/admin/localization/keys/${encodeURIComponent(segments[2])}/versions`;
  }
  if (path === "integrations/fhir/configs") return "/admin/integrations/fhir/configs";
  if (
    segments.length === 5 &&
    segments[0] === "integrations" &&
    segments[1] === "fhir" &&
    segments[2] === "configs" &&
    safeId(segments[3]) &&
    ["mappings", "test", "activate"].includes(segments[4]!)
  ) {
    return "/admin/integrations/fhir/configs/" + encodeURIComponent(segments[3]!) + "/" + segments[4];
  }
  if (
    segments.length === 5 &&
    segments[0] === "integrations" &&
    segments[1] === "fhir" &&
    segments[2] === "mappings" &&
    safeId(segments[3]) &&
    segments[4] === "publish"
  ) {
    return "/admin/integrations/fhir/mappings/" + encodeURIComponent(segments[3]!) + "/publish";
  }
  if (path === "integrations/labs/configs") return "/admin/integrations/labs/configs";
  if (
    segments.length === 5 &&
    segments[0] === "integrations" &&
    segments[1] === "labs" &&
    segments[2] === "configs" &&
    safeId(segments[3]) &&
    ["mappings", "test", "activate"].includes(segments[4]!)
  ) {
    return "/admin/integrations/labs/configs/" + encodeURIComponent(segments[3]!) + "/" + segments[4];
  }
  if (
    segments.length === 5 &&
    segments[0] === "integrations" &&
    segments[1] === "labs" &&
    segments[2] === "mappings" &&
    safeId(segments[3]) &&
    segments[4] === "publish"
  ) {
    return "/admin/integrations/labs/mappings/" + encodeURIComponent(segments[3]!) + "/publish";
  }
  if (
    segments.length === 5 &&
    segments[0] === "integrations" &&
    segments[1] === "labs" &&
    segments[2] === "events" &&
    safeId(segments[3]) &&
    segments[4] === "retry"
  ) {
    return "/admin/integrations/labs/events/" + encodeURIComponent(segments[3]!) + "/retry";
  }
  if (path === "credential-expirations/policy") return "/admin/governance/credential-expirations/policy";
  if (path === "credential-expirations/run-reminders") return "/admin/governance/credential-expirations/run-reminders";
  if (path === "audit-exports") return "/admin/audit-exports";
  if (
    segments.length === 3 &&
    segments[0] === "audit-exports" &&
    safeId(segments[1]) &&
    segments[2] === "download-token"
  ) {
    return "/admin/audit-exports/" + encodeURIComponent(segments[1]) + "/download-token";
  }
  return null;
}

function resolveAuditDownload(segments: string[], query: URLSearchParams): string | null {
  if (
    segments.length !== 3
    || segments[0] !== "audit-exports"
    || !safeId(segments[1])
    || segments[2] !== "download"
  ) return null;
  const token = query.get("token")?.trim() ?? "";
  if (!/^[A-Za-z0-9_-]{40,100}$/.test(token)) return null;
  return "/admin/audit-exports/" + encodeURIComponent(segments[1]) + "/download?token=" + encodeURIComponent(token);
}

function safeId(value: string | undefined): value is string {
  return typeof value === "string" && SAFE_ID.test(value);
}

function cleanText(value: string | null, max: number): string | null {
  if (!value) return null;
  const text = value.trim();
  if (!text || text.length > max || /[\r\n\0]/.test(text)) return null;
  return text;
}

function cleanCode(value: string | null): string | null {
  if (!value) return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z0-9_]{3,120}$/.test(code) ? code : null;
}

function cleanEnum(value: string | null, allowed: string[]): string | null {
  if (!value) return null;
  const normalized = value.trim().toUpperCase();
  return allowed.includes(normalized) ? normalized : null;
}

function cleanLimit(value: string | null, min: number, max: number): string | null {
  if (!value || !/^\d{1,4}$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? String(parsed) : null;
}

function invalid(message: string, status = 400) {
  return noStore(NextResponse.json({ message }, { status }));
}
