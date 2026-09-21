import { NextRequest } from "next/server";
import { backendResponse, forwardAdminRequest, requireAdminAccessToken } from "@/lib/admin-api";
export async function GET(request:NextRequest){const token=await requireAdminAccessToken(request);const url=new URL(request.url);return backendResponse(await forwardAdminRequest(`/admin/patients${url.search}`,token))}
