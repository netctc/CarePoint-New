import { NextRequest, NextResponse } from "next/server";
import { forwardAdminJson } from "@/lib/admin-api";
import { noStore } from "@/lib/admin-auth";

type Context={params:Promise<{patientId:string}>};

export async function GET(request: NextRequest, { params }: Context) {
  const { patientId } = await params;
  return forwardAdminJson(request, `/admin/patients/${encodeURIComponent(patientId)}`);
}

export async function PATCH(request:NextRequest,{params}:Context){
  const {patientId}=await params;
  const body=await jsonBody(request);
  if(body instanceof NextResponse)return body;
  return forwardAdminJson(request,`/admin/patients/${encodeURIComponent(patientId)}`,{method:"PATCH",body,requireSameOrigin:true});
}

async function jsonBody(request:NextRequest):Promise<unknown|NextResponse>{
  try{
    const raw=await request.text();
    if(Buffer.byteLength(raw,"utf8")>64*1024)return noStore(NextResponse.json({message:"Patient administration request is too large."},{status:413}));
    return raw?JSON.parse(raw):{};
  }catch{
    return noStore(NextResponse.json({message:"Invalid patient administration request body."},{status:400}));
  }
}
