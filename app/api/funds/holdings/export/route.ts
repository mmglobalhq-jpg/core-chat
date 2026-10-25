/**
 * GET /api/funds/holdings/export — basis-aware CSV of ALL holdings matching the
 * current Holdings filters (every fund, across all pages, including Metadata
 * Conflict and null-sector rows). Same validated params as the table, minus
 * pagination/sort. Read-only, auth-gated.
 *
 * ONE database call (get_fund_holdings_export_json) returns every row; over
 * FUNDS_EXPORT_MAX_ROWS the RPC raises export_limit_exceeded, which maps to a 400
 * before any byte of the file is written — never silently truncated. The CSV text is
 * produced in 1,000-row chunks by the shared csvStream helper.
 *
 * Headers are basis-aware (Par / Market Value / Position Amount + a Comparison Basis
 * column for mixed results). Amounts are exact decimal strings (never floated). Null
 * sectors export as "Unmapped"; null security types export blank.
 */
import { requireUser } from "@/lib/reqUser";
import { callRpc } from "@/lib/fundsRpc";
import { csvCell, csvResponse } from "@/lib/csvStream";
import {
  getComparisonMode,
  getAmountLabels,
  getBasisLabel,
  UNMAPPED_LABEL,
  type ComparisonMode,
} from "@/lib/fundManager";
import { validateHoldingsExportQuery, type HoldingRow } from "@/lib/fundHoldings";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type ExportResult = { total_rows: number; rows: HoldingRow[] };

function headerFor(mode: ComparisonMode): string[] {
  return [
    "Fund",
    "As Of",
    "CUSIP / Security ID",
    "Description",
    "Security Type",
    "Sector Type",
    getAmountLabels(mode).amount,
    ...(mode === "mixed" ? ["Comparison Basis"] : []),
    "Last Change",
    "Last Change Type",
    "Metadata Conflict",
    "Conflict Fields",
    "Conflict Reason",
  ];
}

const KIND_LABEL = {
  added: "Added",
  par_increased: "Par Increased",
  par_decreased: "Par Decreased",
} as const;

function lastChangeType(r: HoldingRow): string | null {
  if (!r.last_change_date) return null; // derived data missing: blank, not a guess
  if (r.since_first) {
    return r.comparison_basis === "MARKET_VALUE"
      ? "Held since first record"
      : "Unchanged since first record";
  }
  return r.last_change_kind ? KIND_LABEL[r.last_change_kind] : null;
}

function toRow(r: HoldingRow, mode: ComparisonMode): string {
  const cells: (string | null)[] = [
    r.fund_ticker,
    r.as_of_date,
    r.security_id,
    r.description,
    r.security_type, // null exports blank
    r.sector_type == null ? UNMAPPED_LABEL : r.sector_type,
    r.position_amount, // exact decimal string, never floated
    ...(mode === "mixed" ? [getBasisLabel(r.comparison_basis)] : []),
    r.last_change_date,
    lastChangeType(r),
    r.metadata_conflict ? "true" : "false",
    r.conflict_fields.join(", "),
    r.conflict_reason,
  ];
  return cells.map(csvCell).join(",");
}

export async function GET(request: Request) {
  const gate = await requireUser(request);
  if ("error" in gate) return gate.error;

  const parsed = validateHoldingsExportQuery(new URL(request.url).searchParams);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const res = await callRpc<ExportResult>("get_fund_holdings_export_json", parsed.value);
  if (res.error) return res.error;
  const rows = res.data?.rows ?? [];
  // Basis mode from the rows themselves; an empty result gets the default (Par) header.
  const mode = getComparisonMode(rows);

  return csvResponse({
    filename: `fund-holdings_${new Date().toISOString().slice(0, 10)}.csv`,
    header: headerFor(mode),
    rows,
    toRow: (r) => toRow(r, mode),
  });
}
