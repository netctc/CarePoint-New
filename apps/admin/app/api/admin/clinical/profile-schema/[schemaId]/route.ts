import { NextRequest } from "next/server";
import { backendResponse, forwardAdminRequest, requireAdminAccessToken } from "@/lib/admin-api";
export async function PATCH(request:NextRequest,{params}:{params:Promise<{schemaId:string}>}){const token=await requireAdminAccessToken(request);const {schemaId}=await params;const body=await request.json();return backendResponse(await forwardAdminRequest(`/admin/clinical/profile-schema/${encodeURIComponent(schemaId)}`,token,"PATCH",body))}
