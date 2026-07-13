import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

/**
 * Dropdown data for the fund dashboard: the list of fund managers and the list
 * of funds (each tagged with its manager) so the client can build the
 * Manager -> Fund cascade. Reads the RLS-protected fund tables via service_role
 * (server-only), like the admin routes.
 */
export async function GET() {
  const db = getSupabaseAdmin();
  const [managersRes, fundsRes, datesRes] = await Promise.all([
    db.from("fund_managers").select("id, canonical_name").order("canonical_name"),
    db.from("funds").select("id, ticker, fund_name, manager_id").order("ticker"),
    // distinct DATA dates (with real holdings), newest first — the window picker uses
    // these actual dates so 1D = the two most recent data dates and junk/partial days
    // (0 cusips) are skipped.
    db.rpc("get_dashboard_dates", { p_limit: 120 }),
  ]);
  const err = managersRes.error ?? fundsRes.error;
  if (err) return NextResponse.json({ error: err.message }, { status: 500 });
  const dates = ((datesRes.data ?? []) as { as_of_date: string }[]).map((r) => r.as_of_date);
  return NextResponse.json({
    managers: managersRes.data ?? [],
    funds: fundsRes.data ?? [],
    latestDate: dates[0] ?? null,
    dates,
  });
}
