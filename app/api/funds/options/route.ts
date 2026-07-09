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
  const [managersRes, fundsRes, latestRes] = await Promise.all([
    db.from("fund_managers").select("id, canonical_name").order("canonical_name"),
    db.from("funds").select("id, ticker, fund_name, manager_id").order("ticker"),
    // freshest data date, to seed the default End date box
    db
      .from("mv_current_changes")
      .select("as_of_date")
      .order("as_of_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const err = managersRes.error ?? fundsRes.error;
  if (err) return NextResponse.json({ error: err.message }, { status: 500 });
  return NextResponse.json({
    managers: managersRes.data ?? [],
    funds: fundsRes.data ?? [],
    latestDate: latestRes.data?.as_of_date ?? null,
  });
}
