import { NextRequest } from "next/server";
import { forwardAdminJson } from "@/lib/admin-api";

export async function POST(request: NextRequest, context:{params:Promise<{policyId:string;version:string}>}) {
  const {policyId,version}=await context.params;
  if(!/^\d{1,6}$/.test(version)||Number(version)<1) return Response.json({message:"version is invalid."},{status:400});
  return forwardAdminJson(request,`/admin/rpm/policies/${encodeURIComponent(policyId)}/versions/${version}/activate`,{method:"POST",body:{},requireSameOrigin:true});
}
