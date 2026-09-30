import { NextRequest, NextResponse } from "next/server";
import { forwardAdminJson } from "@/lib/admin-api";

const PAGE_SIZES=new Set(["10","25","50","100"]);

export async function GET(request: NextRequest) {
  const params = new URLSearchParams();
  const providerClass = request.nextUrl.searchParams.get("class")?.trim();
  const query = request.nextUrl.searchParams.get("q")?.trim();
  const page=request.nextUrl.searchParams.get("page")?.trim()||"1";
  const pageSize=request.nextUrl.searchParams.get("pageSize")?.trim()||"10";
  const families=request.nextUrl.searchParams.get("families")?.trim();
  const excludeFamilies=request.nextUrl.searchParams.get("excludeFamilies")?.trim();
  if(providerClass&&providerClass!=="DOCTOR"&&providerClass!=="OTHER_PROVIDER")return NextResponse.json({message:"class is invalid."},{status:400});
  if(query&&query.length>120)return NextResponse.json({message:"q exceeds 120 characters."},{status:400});
  const familyPattern=/^[A-Z][A-Z0-9_]{1,79}(,[A-Z][A-Z0-9_]{1,79})*$/;
  if(families&&!familyPattern.test(families))return NextResponse.json({message:"families is invalid."},{status:400});
  if(excludeFamilies&&!familyPattern.test(excludeFamilies))return NextResponse.json({message:"excludeFamilies is invalid."},{status:400});
  if(!/^\d{1,7}$/.test(page)||Number(page)<1)return NextResponse.json({message:"page is invalid."},{status:400});
  if(!PAGE_SIZES.has(pageSize))return NextResponse.json({message:"pageSize must be 10, 25, 50 or 100."},{status:400});
  if (providerClass) params.set("class", providerClass);
  if (query) params.set("q", query);
  if (families) params.set("families", families);
  if (excludeFamilies) params.set("excludeFamilies", excludeFamilies);
  params.set("page",page);params.set("pageSize",pageSize);
  return forwardAdminJson(request, "/admin/provider-administration?" + params.toString());
}
