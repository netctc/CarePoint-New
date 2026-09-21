import { NextRequest } from "next/server";
import { backendResponse, forwardAdminRequest, requireAdminAccessToken } from "@/lib/admin-api";
export async function GET(request:NextRequest,{params}:{params:Promise<{patientId:string}>}){const token=await requireAdminAccessToken(request);const {patientId}=await params;return backendResponse(await forwardAdminRequest(`/admin/patients/${encodeURIComponent(patientId)}`,token))}
