/**
 * GET /api/funds/export — streamed, basis-aware CSV of ALL matching position-change
 * rows (every fund/date/filter the table would show, across all pages, including
 * Metadata Conflict and null-sector rows). Reuses the same validated params and the
 * same poller RPCs as the table. Streamed in bounded chunks so neither the server
 * nor the browser holds the whole export in memory. Read-only, auth-gated.
 *
 * Headers are basis-aware (Par / Market Value / Position + a Basis column for mixed
 * results); values always come from position_amount/position_change as exact decimal
 * strings (never floated). Null sectors export as "Unmapped"; null security types
 * export blank (matching the existing "" convention). Over the row limit the export
 * is blocked up-front — never silently truncated.
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/reqUser";
import { mapRpcError } from "@/lib/fundsRpc";
import { getSupabaseFunds } from "@/lib/supabaseFunds";
import {
  validateExportQuery,
  exportMaxRows,
  getComparisonMode,
  getAmountLabels,
  getBasisLabel,
  UNMAPPED_LABEL,
  type ChangesResponse,
  type ComparisonMode,
} from "@/lib/fundManager";

export const dynamic = "force-dynamic";

const CHUNK = 1000;

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

function csvCell(v: string | number | boolean | null): string {
  if (v == null) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
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

  const supabase = getSupabaseFunds();

  // Pre-flight: block (never truncate) over the limit, and read the basis mode.
  const limit = exportMaxRows();
  const { data: probe, error: probeErr } = await supabase.rpc("get_fund_position_changes", {
    p_manager: args.p_manager,
    p_fund: args.p_fund,
    p_start_date: args.p_start_date,
    p_end_date: args.p_end_date,
    p_page: 1,
    p_page_size: 50,
    p_sort_column: "position_change",
    p_sort_direction: "desc",
    p_security_id_search: args.p_security_id_search,
    p_description_search: args.p_description_search,
    p_security_type: args.p_security_type,
    p_sector_type: args.p_sector_type,
    p_change_types: args.p_change_types,
  });
  if (probeErr) return mapRpcError(probeErr);
  const probed = probe as ChangesResponse;
  const total = probed?.pagination?.total_rows ?? 0;
  if (total > limit) {
    return NextResponse.json(
      {
        error: `export_limit_exceeded: ${total.toLocaleString()} rows exceed the ${limit.toLocaleString()}-row limit. Narrow the manager, fund, date range, or security filters and try again.`,
      },
      { status: 400 },
    );
  }
  const mode = getComparisonMode(probed?.changes ?? [], probed?.fund_status ?? []);

  const encoder = new TextEncoder();
  const filename = `fund-position-changes_${args.p_start_date}_${args.p_end_date}.csv`;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(headerFor(mode).map(csvCell).join(",") + "\n"));
        let offset = 0;
        for (;;) {
          const { data, error } = await supabase
            .rpc("get_fund_position_changes_export", args)
            .range(offset, offset + CHUNK - 1);
          if (error) throw new Error(error.message);
          const rows = (data ?? []) as ExportRow[];
          if (rows.length === 0) break;
          controller.enqueue(encoder.encode(rows.map((r) => toRow(r, mode)).join("\n") + "\n"));
          offset += rows.length;
          if (rows.length < CHUNK) break;
        }
        controller.close();
      } catch (e) {
        controller.error(e);
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
