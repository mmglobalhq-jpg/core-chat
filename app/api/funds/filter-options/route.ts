/**
 * GET /api/funds/filter-options?manager=&fund=&start=&end=&preset= — distinct
 * Security Type and Sector Type values in scope, for the table's dropdown filters.
 * NULL manager/fund = all. Authenticated, read-only.
 *
 * The date/preset arguments scope the lookup to the two snapshots actually being
 * compared. Without them the RPC walks every snapshot in scope, which measured
 * 38.5 s for JP Morgan and 44.0 s for all managers in production on 2026-09-14 —
 * the table itself renders in ~2 s, so the dropdowns were the slowest thing on the
 * page. Scoping is also more correct: a filter value that cannot appear in the
 * result should not be offered.
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/reqUser";
import { callRpc } from "@/lib/fundsRpc";
import { parseIsoDate, parseLookback } from "@/lib/fundManager";

export const dynamic = "force-dynamic";

// `sector_has_null` tells the UI to offer the "Unmapped" (null-sector) filter option.
type FilterOptions = { security_types: string[]; sector_types: string[]; sector_has_null: boolean };

function opt(v: string | null): string | null {
  if (!v) return null;
  const t = v.trim();
  return t === "" || t.toLowerCase() === "all" ? null : t;
}

export async function GET(request: Request) {
  const gate = await requireUser(request);
  if ("error" in gate) return gate.error;

  const sp = new URL(request.url).searchParams;
  // A preset resolves per fund and carries no dates; it wins over any stale
  // start/end in the URL, matching validateChangesQuery.
  const lookback = parseLookback(sp.get("preset"));
  const res = await callRpc<FilterOptions>("get_fund_filter_options", {
    p_manager: opt(sp.get("manager")),
    p_fund: opt(sp.get("fund")),
    p_start_date: lookback == null ? parseIsoDate(sp.get("start")) : null,
    p_end_date: lookback == null ? parseIsoDate(sp.get("end")) : null,
    p_lookback: lookback,
  });
  if (res.error) return res.error;
  return NextResponse.json(res.data);
}
