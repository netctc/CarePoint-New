import { NextRequest } from "next/server";
import { forwardAdminJson } from "@/lib/admin-api";

export async function GET(request: NextRequest) {
  return forwardAdminJson(request, "/admin/rpm/policies");
}

export async function POST(request: NextRequest) {
  const body=await request.json();
  return forwardAdminJson(request,"/admin/rpm/policies",{method:"POST",body,requireSameOrigin:true});
}
