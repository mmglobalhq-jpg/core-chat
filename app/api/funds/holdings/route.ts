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
]);

const COLS =
  "ticker, as_of_date, cusip, description, security_type, par_value, par_change, change_type";

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
      p_sort: sort,
      p_dir: dir,
      p_limit: PAGE_SIZE,
      p_offset: from,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const raw = data ?? [];
    const total = raw.length ? Number(raw[0].total_count) : 0;
    const rows = raw.map(({ total_count: _t, ...r }) => r);
    return NextResponse.json({ rows, total, page, pageSize: PAGE_SIZE });
  }

  // --- Default (latest-vs-previous "1-day" change): instant matview read. ---
  let q = db
    .from("mv_current_changes")
    .select(COLS, { count: "exact" })
    .order(sort, { ascending: dir === "asc", nullsFirst: false })
    .range(from, to);

  if (fund && fund !== "all") q = q.eq("fund_id", fund);
  else if (manager && manager !== "all") q = q.eq("manager_id", manager);

  if (fTicker) q = q.ilike("ticker", `%${fTicker}%`);
  if (fCusip) q = q.ilike("cusip", `%${fCusip}%`);
  if (fDesc) q = q.ilike("description", `%${fDesc}%`);
  if (fType) q = q.eq("security_type", fType);
  if (fChange) q = q.eq("change_type", fChange);
  if (fParMin) q = q.gte("par_value", Number(fParMin));
  if (fParMax) q = q.lte("par_value", Number(fParMax));

  const { data, error, count } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rows: data ?? [], total: count ?? 0, page, pageSize: PAGE_SIZE });
}
