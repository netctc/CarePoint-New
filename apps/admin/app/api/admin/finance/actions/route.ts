import { NextRequest, NextResponse } from "next/server";
import { forwardAdminJson } from "@/lib/admin-api";
import { noStore } from "@/lib/admin-auth";

const actions = ["REFRESH_PAYMENT", "REFUND_PAYMENT", "REFRESH_CLAIM", "REWORK_CLAIM", "CREATE_PAYOUT"] as const;

type FinanceAction = (typeof actions)[number];
type ActionBody = {
  action?: string;
  resourceId?: string;
  idempotencyKey?: string;
  amountMinor?: number;
  reason?: string;
  reasonCode?: string;
  providerId?: string;
  currency?: string;
  periodStart?: string;
  periodEnd?: string;
};

export async function POST(request: NextRequest) {
  let body: ActionBody;
  try {
    body = await request.json() as ActionBody;
  } catch {
    return noStore(NextResponse.json({ message: "Invalid finance action body." }, { status: 400 }));
  }

  const action = cleanAction(body.action);
  if (!action) return noStore(NextResponse.json({ message: "Unsupported finance action." }, { status: 400 }));

  const outbound: ActionBody = { action };
  const resourceId = cleanText(body.resourceId, 128);
  const idempotencyKey = cleanText(body.idempotencyKey, 500);
  const reason = cleanText(body.reason, 500);
  const reasonCode = cleanText(body.reasonCode, 128);
  const providerId = cleanText(body.providerId, 128);
  const currency = cleanText(body.currency, 3);
  const periodStart = cleanText(body.periodStart, 64);
  const periodEnd = cleanText(body.periodEnd, 64);
  if (resourceId) outbound.resourceId = resourceId;
  if (idempotencyKey) outbound.idempotencyKey = idempotencyKey;
  if (reason) outbound.reason = reason;
  if (reasonCode) outbound.reasonCode = reasonCode;
  if (providerId) outbound.providerId = providerId;
  if (currency) outbound.currency = currency.toUpperCase();
  if (periodStart) outbound.periodStart = periodStart;
  if (periodEnd) outbound.periodEnd = periodEnd;
  if (body.amountMinor !== undefined) {
    if (!Number.isInteger(body.amountMinor) || body.amountMinor <= 0) return noStore(NextResponse.json({ message: "amountMinor must be a positive integer." }, { status: 400 }));
    outbound.amountMinor = body.amountMinor;
  }

  return forwardAdminJson(request, "/admin/finance/actions", { method: "POST", body: outbound, requireSameOrigin: true });
}

function cleanAction(value: unknown): FinanceAction | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return (actions as readonly string[]).includes(normalized) ? normalized as FinanceAction : null;
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned && cleaned.length <= max ? cleaned : null;
}
