/**
 * GET /api/funds/changes — the paginated, filtered, sorted position-change table.
 * All comparison/filter/sort/pagination logic lives in the poller RPC; this route
 * only authenticates the chat user, validates inputs server-side, and forwards to
 * get_fund_position_changes. Read-only. NULL manager/fund mean "all".
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/reqUser";
import { callRpc } from "@/lib/fundsRpc";
import { validateChangesQuery, type ChangesResponse } from "@/lib/fundManager";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const gate = await requireUser(request);
  if ("error" in gate) return gate.error;

  const sp = new URL(request.url).searchParams;
  const parsed = validateChangesQuery(sp);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const res = await callRpc<ChangesResponse>("get_fund_position_changes", parsed.value);
  if (res.error) return res.error;
  return NextResponse.json(res.data);
}
