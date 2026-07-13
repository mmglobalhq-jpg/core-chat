import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

// Columns the client may sort by (prevents arbitrary column injection).
const SORTABLE = new Set([
  "ticker",
  "as_of_date",
  "cusip",
  "description",
  "security_type",
  "par_value",
  "par_change",
  "change_type",
  "cpn",
  "wam",
  "wala",
  "gen_ticker",
  "cohort",
  "sec_type",
]);

const COLS =
  "ticker, as_of_date, cusip, description, security_type, par_value, par_change, change_type, " +
  "cpn, wam, wala, gen_ticker, cohort, sec_type";

/**
 * Paginated fund holdings with per-position par change + change type over a date
 * range, sorted and filtered server-side.
 *
 * Query params:
 *   manager, fund   selection ("all" or an id); a specific fund overrides manager
 *   start, end      YYYY-MM-DD. Omit BOTH to use the default (latest-vs-previous
 *                   "1-day" change), which is served instantly from the
 *                   mv_current_changes matview. Provide both for a custom range,
 *                   served live by the dashboard_changes() RPC (per-fund
 *                   snapshot-anchored).
 *   page, sort, dir pagination + sort
 *   f_ticker, f_cusip, f_description (contains); f_type, f_change (exact);
 *   f_par_min, f_par_max (range)   — Excel-like column filters
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const manager = searchParams.get("manager");
  const fund = searchParams.get("fund");
  const start = searchParams.get("start");
  const end = searchParams.get("end");
  // 'exact' = strict two-date comparison (1D: include only funds with data on BOTH
  // exact dates). 'anchor' = per-fund nearest-snapshot comparison for multi-day
  // windows (each fund vs its own latest snapshot ~N days back). Default anchor.
  const mode = searchParams.get("mode") === "exact" ? "exact" : "anchor";
  const page = Math.max(1, Number.parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const sortParam = searchParams.get("sort");
  const sort = sortParam && SORTABLE.has(sortParam) ? sortParam : "par_value";
  const dir = searchParams.get("dir") === "asc" ? "asc" : "desc";

  const fTicker = searchParams.get("f_ticker") || null;
  const fCusip = searchParams.get("f_cusip") || null;
  const fDesc = searchParams.get("f_description") || null;
  const fType = searchParams.get("f_type") || null;
  const fChange = searchParams.get("f_change") || null;
  const fParMin = searchParams.get("f_par_min");
  const fParMax = searchParams.get("f_par_max");
  const fCpnMin = searchParams.get("f_cpn_min");
  const fWamMin = searchParams.get("f_wam_min");
  const fWalaMin = searchParams.get("f_wala_min");
  const fGenTicker = searchParams.get("f_gen_ticker") || null;
  const fCohort = searchParams.get("f_cohort") || null;
  const fSecType = searchParams.get("f_sec_type") || null;

  const db = getSupabaseAdmin();

  // --- Custom date range: live per-fund anchored comparison via RPC. ---
  if (start && end) {
    let fundIds: string[] | null = null;
    if (fund && fund !== "all") {
      fundIds = [fund];
    } else if (manager && manager !== "all") {
      const { data } = await db.from("funds").select("id").eq("manager_id", manager);
      fundIds = (data ?? []).map((r) => r.id as string);
    }
    const { data, error } = await db.rpc("dashboard_changes", {
      p_fund_ids: fundIds,
      p_start: start,
      p_end: end,
      p_ticker: fTicker,
      p_cusip: fCusip,
      p_description: fDesc,
      p_security_type: fType,
      p_change_type: fChange,
      p_par_min: fParMin ? Number(fParMin) : null,
      p_par_max: fParMax ? Number(fParMax) : null,
      p_cpn_min: fCpnMin ? Number(fCpnMin) : null,
      p_wam_min: fWamMin ? Number(fWamMin) : null,
      p_wala_min: fWalaMin ? Number(fWalaMin) : null,
      p_gen_ticker: fGenTicker,
      p_cohort: fCohort,
      p_sec_type: fSecType,
      p_sort: sort,
      p_dir: dir,
      p_limit: PAGE_SIZE,
      p_offset: from,
      p_mode: mode,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    type ChangeRow = {
      ticker: string;
      as_of_date: string;
      cusip: string | null;
      description: string | null;
      security_type: string | null;
      par_value: number | null;
      par_change: number | null;
      change_type: string | null;
      cpn: number | null;
      wam: number | null;
      wala: number | null;
      gen_ticker: string | null;
      cohort: string | null;
      sec_type: string | null;
      total_count: number;
    };
    const raw = (data ?? []) as ChangeRow[];
    const total = raw.length ? Number(raw[0].total_count) : 0;
    const rows = raw.map((r) => ({
      ticker: r.ticker,
      as_of_date: r.as_of_date,
      cusip: r.cusip,
      description: r.description,
      security_type: r.security_type,
      par_value: r.par_value,
      par_change: r.par_change,
      change_type: r.change_type,
      cpn: r.cpn,
      wam: r.wam,
      wala: r.wala,
      gen_ticker: r.gen_ticker,
      cohort: r.cohort,
      sec_type: r.sec_type,
    }));
    return NextResponse.json({ rows, total, page, pageSize: PAGE_SIZE });
  }

  // --- Default (latest-vs-previous "1-day" change): instant matview read,
  //     enriched with any imported CUSIP data via v_dashboard_current. ---
  let q = db
    .from("v_dashboard_current")
    .select(COLS, { count: "exact" })
    .order(sort, { ascending: dir === "asc", nullsFirst: false })
    .range(from, to);

  if (fund && fund !== "all") q = q.eq("fund_id", fund);
  else if (manager && manager !== "all") q = q.eq("manager_id", manager);

  if (fTicker) q = q.ilike("ticker", `%${fTicker}%`);
  if (fCusip) q = q.ilike("cusip", `%${fCusip}%`);
  if (fDesc) q = q.ilike("description", `%${fDesc}%`);
  if (fType) q = q.eq("security_type", fType);
  // Dashboard shows what CHANGED: exclude "Unchanged" unless the user explicitly
  // picks a change_type (mirrors dashboard_changes() for the custom-range path).
  if (fChange) q = q.eq("change_type", fChange);
  else q = q.neq("change_type", "Unchanged");
  if (fParMin) q = q.gte("par_value", Number(fParMin));
  if (fParMax) q = q.lte("par_value", Number(fParMax));
  if (fCpnMin) q = q.gte("cpn", Number(fCpnMin));
  if (fWamMin) q = q.gte("wam", Number(fWamMin));
  if (fWalaMin) q = q.gte("wala", Number(fWalaMin));
  if (fGenTicker) q = q.ilike("gen_ticker", `%${fGenTicker}%`);
  if (fCohort) q = q.ilike("cohort", `%${fCohort}%`);
  if (fSecType) q = q.ilike("sec_type", `%${fSecType}%`);

  const { data, error, count } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rows: data ?? [], total: count ?? 0, page, pageSize: PAGE_SIZE });
}
