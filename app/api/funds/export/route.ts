/**
 * GET /api/funds/export — basis-aware CSV of ALL matching position-change rows
 * (every fund/date/filter the table would show, across all pages, including
 * Metadata Conflict and null-sector rows). Reuses the same validated params as the
 * table. Read-only, auth-gated.
 *
 * ONE database call: get_fund_position_changes_export_json (poller migration 0011)
 * computes the comparison once and returns every row in a single scalar. This route
 * used to page a row-set RPC 1,000 rows at a time (Supabase's max-rows); PostgREST
 * cannot push LIMIT/OFFSET into a PL/pgSQL function, so each chunk re-ran the whole
 * comparison — ~17 runs for a 30-day all-manager export. The trade is that the rows
 * are held in memory here, bounded by FUNDS_EXPORT_MAX_ROWS; the CSV text is still
 * produced incrementally, a chunk of rows at a time.
 *
 * Headers are basis-aware (Par / Market Value / Position + a Basis column for mixed
 * results); values always come from position_amount/position_change as exact decimal
 * strings (never floated). Null sectors export as "Unmapped"; null security types
 * export blank (matching the existing "" convention). Over the row limit the export
 * is blocked up-front — never silently truncated.
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/reqUser";
import { callRpc } from "@/lib/fundsRpc";
import { csvCell, csvResponse } from "@/lib/csvStream";
import {
  validateExportQuery,
  getComparisonMode,
  getAmountLabels,
  getBasisLabel,
  UNMAPPED_LABEL,
  type ComparisonMode,
} from "@/lib/fundManager";

export const dynamic = "force-dynamic";

type ExportResult = { total_rows: number; rows: ExportRow[] };

type ExportRow = {
  fund_manager: string;
  fund_ticker: string;
  security_id: string;
  description: string | null;
  security_type: string | null;
  sector_type: string | null;
  comparison_basis: string;
  position_amount: string | null;
  position_change: string | null;
  change_type: string;
  requested_start_date: string;
  actual_start_date: string | null;
  requested_end_date: string;
  actual_end_date: string | null;
  metadata_conflict: boolean;
  conflict_fields: string | null;
  conflict_reason: string | null;
};

function headerFor(mode: ComparisonMode): string[] {
  const { amount, change } = getAmountLabels(mode);
  const core = ["Fund", "CUSIP / Security ID", "Description", "Security Type", "Sector Type", amount, change];
  const basisCol = mode === "mixed" ? ["Comparison Basis"] : [];
  return [
    ...core,
    ...basisCol,
    "Change Type",
    "Requested Start Date",
    "Actual Start Date",
    "Requested End Date",
    "Actual End Date",
    "Metadata Conflict",
    "Conflict Fields",
    "Conflict Reason",
  ];
}

function toRow(r: ExportRow, mode: ComparisonMode): string {
  const cells: (string | boolean | null)[] = [
    r.fund_ticker,
    r.security_id,
    r.description,
    // Null security type exports blank (existing "" convention); null sector -> Unmapped.
    r.security_type,
    r.sector_type == null ? UNMAPPED_LABEL : r.sector_type,
    r.position_amount, // exact decimal string, never floated
    r.position_change,
    ...(mode === "mixed" ? [getBasisLabel(r.comparison_basis)] : []),
    r.change_type,
    r.requested_start_date,
    r.actual_start_date,
    r.requested_end_date,
    r.actual_end_date,
    r.metadata_conflict ? "true" : "false",
    r.conflict_fields,
    r.conflict_reason,
  ];
  return cells.map(csvCell).join(",");
}

export async function GET(request: Request) {
  const gate = await requireUser(request);
  if ("error" in gate) return gate.error;

  const sp = new URL(request.url).searchParams;
  const parsed = validateExportQuery(sp);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const args = parsed.value;

  // The RPC itself refuses (never truncates) over p_max_rows: export_limit_exceeded
  // maps to a 400 in callRpc, before any byte of the file is written.
  const res = await callRpc<ExportResult>("get_fund_position_changes_export_json", args);
  if (res.error) return res.error;
  const rows = res.data?.rows ?? [];
  // Basis mode from the rows themselves. An empty result has no basis to read, so it
  // gets the default (Par) headers — it is a header-only file either way.
  const mode = getComparisonMode(rows as { comparison_basis: "PAR" | "MARKET_VALUE" }[]);

  // In lookback mode there is no single window — each fund resolved its own — so
  // the file is named for the preset rather than for dates it does not have.
  const span =
    args.p_lookback == null
      ? `${args.p_start_date}_${args.p_end_date}`
      : `last-${args.p_lookback}-session${args.p_lookback === 1 ? "" : "s"}`;
  const filename = `fund-position-changes_${span}.csv`;

  return csvResponse({
    filename,
    header: headerFor(mode),
    rows,
    toRow: (r) => toRow(r, mode),
  });
}
