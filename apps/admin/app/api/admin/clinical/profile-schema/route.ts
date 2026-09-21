import { NextRequest } from "next/server";
import { backendResponse, forwardAdminRequest, requireAdminAccessToken } from "@/lib/admin-api";
export async function GET(request:NextRequest){const token=await requireAdminAccessToken(request);const url=new URL(request.url);return backendResponse(await forwardAdminRequest(`/admin/clinical/profile-schema${url.search}`,token))}
export async function POST(request:NextRequest){const token=await requireAdminAccessToken(request);const body=await request.json();return backendResponse(await forwardAdminRequest("/admin/clinical/profile-schema",token,"POST",body))}
