import { NextRequest, NextResponse } from "next/server";
import { forwardAdminJson } from "@/lib/admin-api";
import { noStore } from "@/lib/admin-auth";

export async function GET(request: NextRequest) {
  const onboardingId = cleanId(request.nextUrl.searchParams.get("onboardingId"));
  const credentialId = cleanId(request.nextUrl.searchParams.get("credentialId"));
  const documentId = cleanId(request.nextUrl.searchParams.get("documentId"));

  if (!onboardingId || !credentialId || !documentId) {
    return noStore(
      NextResponse.json(
        { message: "onboardingId, credentialId and documentId are required." },
        { status: 400 },
      ),
    );
  }

  return forwardAdminJson(
    request,
    "/onboarding/" +
      encodeURIComponent(onboardingId) +
      "/credentials/" +
      encodeURIComponent(credentialId) +
      "/documents/" +
      encodeURIComponent(documentId) +
      "/content",
  );
}

function cleanId(value: string | null): string | null {
  const cleaned = value?.trim() ?? "";
  if (!cleaned || cleaned.length > 128) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(cleaned)) return null;
  return cleaned;
}
