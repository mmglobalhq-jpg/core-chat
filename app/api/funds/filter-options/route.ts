/**
 * GET /api/funds/filter-options?manager=&fund= — distinct Security Type and Sector
 * Type values in scope, for the table's dropdown filters. NULL manager/fund = all.
 * Authenticated, read-only.
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/reqUser";
import { callRpc } from "@/lib/fundsRpc";

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
  const res = await callRpc<FilterOptions>("get_fund_filter_options", {
    p_manager: opt(sp.get("manager")),
    p_fund: opt(sp.get("fund")),
  });
  if (res.error) return res.error;
  return NextResponse.json(res.data);
}
