import { NextRequest, NextResponse } from "next/server";
import { forwardAdminJson } from "@/lib/admin-api";
import { noStore } from "@/lib/admin-auth";

type GovernanceAction = "credential-verify" | "credential-reject" | "request-changes" | "reject" | "approve";

interface GovernanceBody {
  action?: GovernanceAction;
  onboardingId?: string;
  credentialId?: string;
  note?: string;
}

export async function POST(request: NextRequest) {
  let body: GovernanceBody;
  try {
    body = await request.json() as GovernanceBody;
  } catch {
    return noStore(NextResponse.json({ message: "Invalid governance request body." }, { status: 400 }));
  }

  const action = body.action;
  const onboardingId = cleanId(body.onboardingId);
  const credentialId = cleanId(body.credentialId);
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (!action || !onboardingId) {
    return noStore(NextResponse.json({ message: "A valid governance action and onboardingId are required." }, { status: 400 }));
  }

  if (action === "approve") {
    return forwardAdminJson(request, `/onboarding/${encodeURIComponent(onboardingId)}/approve`, {
      method: "POST",
      requireSameOrigin: true,
    });
  }

  if (action === "request-changes" || action === "reject") {
    if (!note) return noStore(NextResponse.json({ message: "A review note is required for this decision." }, { status: 400 }));
    const suffix = action === "request-changes" ? "request-changes" : "reject";
    return forwardAdminJson(request, `/onboarding/${encodeURIComponent(onboardingId)}/${suffix}`, {
      method: "POST",
      body: { note },
      requireSameOrigin: true,
    });
  }

  if (action === "credential-verify" || action === "credential-reject") {
    if (!credentialId) return noStore(NextResponse.json({ message: "credentialId is required for credential review." }, { status: 400 }));
    if (action === "credential-reject" && !note) {
      return noStore(NextResponse.json({ message: "A review note is required when rejecting a credential." }, { status: 400 }));
    }
    return forwardAdminJson(request, `/onboarding/${encodeURIComponent(onboardingId)}/credentials/${encodeURIComponent(credentialId)}/review`, {
      method: "POST",
      body: { state: action === "credential-verify" ? "VERIFIED" : "REJECTED", ...(note ? { note } : {}) },
      requireSameOrigin: true,
    });
  }

  return noStore(NextResponse.json({ message: "Unsupported governance action." }, { status: 400 }));
}

function cleanId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned && cleaned.length <= 128 ? cleaned : null;
}
