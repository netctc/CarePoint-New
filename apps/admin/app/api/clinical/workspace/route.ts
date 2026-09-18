import { NextRequest, NextResponse } from "next/server";
import { forwardClinicalJson } from "@/lib/clinical-api";
import { isTrustedClinicalSameOrigin, noStoreClinical } from "@/lib/clinical-auth";

interface WorkspaceBody { patientId?: unknown }

export async function POST(request: NextRequest) {
  if (!isTrustedClinicalSameOrigin(request)) {
    return noStoreClinical(NextResponse.json({ message: "Cross-origin clinical request denied." }, { status: 403 }));
  }
  let body: WorkspaceBody;
  try { body = await request.json() as WorkspaceBody; }
  catch { return noStoreClinical(NextResponse.json({ message: "A valid JSON body is required." }, { status: 400 })); }
  const patientId = typeof body.patientId === "string" ? body.patientId.trim() : "";
  if (!patientId || patientId.length > 128 || !/^[A-Za-z0-9_-]+$/.test(patientId)) {
    return noStoreClinical(NextResponse.json({ message: "A valid patient identifier is required." }, { status: 400 }));
  }
  return forwardClinicalJson(request, `/clinical/patients/${encodeURIComponent(patientId)}/workspace`, { requireSameOrigin: true });
}
