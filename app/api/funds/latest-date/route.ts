/**
 * GET /api/funds/latest-date?manager=&fund= — the latest accepted as_of_date in
 * the current manager/fund scope, used to seed the End Date default and presets.
 * NULL manager/fund mean "all". Authenticated, read-only.
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/reqUser";
import { callRpc } from "@/lib/fundsRpc";

export const dynamic = "force-dynamic";

function opt(v: string | null): string | null {
  if (!v) return null;
  const t = v.trim();
  return t === "" || t.toLowerCase() === "all" ? null : t;
}

export async function GET(request: Request) {
  const gate = await requireUser(request);
  if ("error" in gate) return gate.error;

  const sp = new URL(request.url).searchParams;
  const res = await callRpc<string | null>("get_fund_latest_as_of_date", {
    p_manager: opt(sp.get("manager")),
    p_fund: opt(sp.get("fund")),
  });
  if (res.error) return res.error;
  return NextResponse.json({ latestDate: res.data });
}
