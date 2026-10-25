/**
 * GET /api/funds/holdings — the paginated, filtered, sorted current-holdings table
 * (each fund's own latest snapshot). All filter/sort/pagination logic lives in the
 * poller RPC; this route authenticates the chat user, validates inputs server-side
 * and forwards to get_fund_holdings. Read-only.
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/reqUser";
import { callRpc } from "@/lib/fundsRpc";
import { validateHoldingsQuery, type HoldingsResponse } from "@/lib/fundHoldings";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const gate = await requireUser(request);
  if ("error" in gate) return gate.error;

  const parsed = validateHoldingsQuery(new URL(request.url).searchParams);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const res = await callRpc<HoldingsResponse>("get_fund_holdings", parsed.value);
  if (res.error) return res.error;
  return NextResponse.json(res.data);
}
