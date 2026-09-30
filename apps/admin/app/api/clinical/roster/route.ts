import { NextRequest } from "next/server";
import { forwardClinicalJson } from "@/lib/clinical-api";

export async function GET(request: NextRequest) {
  return forwardClinicalJson(request, "/clinical/patients/roster", { requireSameOrigin: true });
}
