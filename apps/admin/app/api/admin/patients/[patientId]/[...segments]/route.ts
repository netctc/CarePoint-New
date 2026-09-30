import { NextRequest, NextResponse } from "next/server";
import { forwardAdminJson } from "@/lib/admin-api";
import { noStore } from "@/lib/admin-auth";

const SAFE=/^[A-Za-z0-9_.:-]{1,180}$/;
type Context={params:Promise<{patientId:string;segments:string[]}>};

export async function GET(request:NextRequest,context:Context){
  const path=await backendPath(context);
  if(!path)return invalid();
  return forwardAdminJson(request,path);
}
export async function POST(request:NextRequest,context:Context){
  const path=await backendPath(context);
  if(!path)return invalid();
  const body=await jsonBody(request);
  if(body instanceof NextResponse)return body;
  return forwardAdminJson(request,path,{method:"POST",body,requireSameOrigin:true});
}
export async function PATCH(request:NextRequest,context:Context){
  const path=await backendPath(context);
  if(!path)return invalid();
  const body=await jsonBody(request);
  if(body instanceof NextResponse)return body;
  return forwardAdminJson(request,path,{method:"PATCH",body,requireSameOrigin:true});
}
async function backendPath(context:Context):Promise<string|null>{
  const {patientId,segments}=await context.params;
  if(!SAFE.test(patientId)||!segments.length||segments.length>5||!segments.every(s=>SAFE.test(s)))return null;
  return "/admin/patients/"+encodeURIComponent(patientId)+"/"+segments.map(encodeURIComponent).join("/");
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
function invalid(){return noStore(NextResponse.json({message:"Invalid patient administration route."},{status:400}));}
