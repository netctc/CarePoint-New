import { NextRequest } from "next/server";
import { forwardAdminJson } from "@/lib/admin-api";

export async function POST(request: NextRequest, context:{params:Promise<{policyId:string}>}) {
  const {policyId}=await context.params;
  const body=await request.json();
  return forwardAdminJson(request,`/admin/rpm/policies/${encodeURIComponent(policyId)}/versions`,{method:"POST",body,requireSameOrigin:true});
}
