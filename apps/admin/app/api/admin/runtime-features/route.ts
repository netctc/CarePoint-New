import { NextResponse } from "next/server";
import { adminRuntimeFeatures } from "@/lib/runtime-features";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(adminRuntimeFeatures(), {
    headers: { "Cache-Control": "no-store" },
  });
}
