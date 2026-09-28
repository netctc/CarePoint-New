import { NextRequest, NextResponse } from "next/server";
import { forwardAdminJson } from "@/lib/admin-api";
import { noStore } from "@/lib/admin-auth";

const ACCOUNT_STATUSES = new Set(["ACTIVE", "SUSPENDED", "ARCHIVED"]);
const PAGE_SIZES = new Set(["10","25","50","100"]);

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length > 120 || /[\r\n\0]/.test(q)) {
    return NextResponse.json({ message: "q is invalid." }, { status: 400 });
  }

  const status = request.nextUrl.searchParams.get("status")?.trim().toUpperCase() ?? "";
  if (status && !ACCOUNT_STATUSES.has(status)) {
    return NextResponse.json({ message: "status is invalid." }, { status: 400 });
  }

  const page = request.nextUrl.searchParams.get("page")?.trim() || "1";
  const pageSize = request.nextUrl.searchParams.get("pageSize")?.trim() || "10";
  if (!/^\d{1,7}$/.test(page) || Number(page) < 1) {
    return NextResponse.json({ message: "page is invalid." }, { status: 400 });
  }
  if (!PAGE_SIZES.has(pageSize)) {
    return NextResponse.json({ message: "pageSize must be 10, 25, 50 or 100." }, { status: 400 });
  }

  const query = new URLSearchParams({ page, pageSize });
  if (q) query.set("q", q);
  if (status) query.set("status", status);
  return forwardAdminJson(request, `/admin/patients?${query.toString()}`);
}

export async function POST(request: NextRequest) {
  const body = await jsonBody(request);
  if (body instanceof NextResponse) return body;
  return forwardAdminJson(request, "/admin/patients", { method:"POST", body, requireSameOrigin:true });
}

async function jsonBody(request:NextRequest):Promise<unknown|NextResponse>{
  try{
    const raw=await request.text();
    if(Buffer.byteLength(raw,"utf8")>64*1024) return noStore(NextResponse.json({message:"Patient administration request is too large."},{status:413}));
    return raw?JSON.parse(raw):{};
  }catch{
    return noStore(NextResponse.json({message:"Invalid patient administration request body."},{status:400}));
  }
}
