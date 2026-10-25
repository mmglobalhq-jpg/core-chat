/**
 * Contract for the Fund Manager "Holdings" tab: the row/status shapes returned by
 * the get_fund_holdings RPC family and the server-side validators used by the
 * /api/funds/holdings* routes. Pure and dependency-free, like fundManager.ts, so
 * both server routes and the client page can import it. It reuses fundManager's
 * page-size whitelist, lookback presets and unmapped-sector token rather than
 * restating them, so the two tabs can never drift apart.
 */
import {
  ALLOWED_PAGE_SIZES,
  DEFAULT_PAGE_SIZE,
  PRESET_LOOKBACK,
  SORT_DIRECTIONS,
  exportMaxRows,
  type ComparisonBasis,
  type Pagination,
  type SortDirection,
  type ValidationResult,
} from "@/lib/fundManager";

export type { Pagination };

// Whitelisted sortable columns — never interpolate an unchecked identifier.
// Deliberately NOT the Changes whitelist: there is no position_change here
// (holdings carry no period delta), only the derived "last change" date.
export const HOLDINGS_SORT_COLUMNS = [
  "last_change",
  "fund_ticker",
  "as_of_date",
  "security_id",
  "description",
  "security_type",
  "sector_type",
  "position_amount",
] as const;
export type HoldingsSortColumn = (typeof HOLDINGS_SORT_COLUMNS)[number];
export const DEFAULT_HOLDINGS_SORT: HoldingsSortColumn = "last_change";

export type LastChangeKind = "added" | "par_increased" | "par_decreased";

export type HoldingRow = {
  fund_manager: string;
  fund_ticker: string;
  as_of_date: string; // ISO YYYY-MM-DD; this fund's own latest snapshot
  comparison_basis: ComparisonBasis;
  security_id: string;
  description: string | null;
  security_type: string | null;
  sector_type: string | null;
  // Decimal string (full precision). Kept even on sector-conflict rows; null only defensively.
  position_amount: string | null;
  // Both null (and since_first false) when the fund's derived data is missing;
  // that fund is then reported stale.
  last_change_date: string | null; // ISO YYYY-MM-DD
  last_change_kind: LastChangeKind | null;
  since_first: boolean;
  metadata_conflict: boolean;
  conflict_fields: string[];
  conflict_reason: string | null;
};

export type HoldingsFundStatus = {
  fund_manager: string;
  fund_ticker: string;
  comparison_basis: ComparisonBasis;
  as_of_date: string | null; // null for a fund with no live snapshot
  holding_count: number; // rows matching the current filters
  stale: boolean;
  last_error: string | null;
};

export type HoldingsResponse = {
  holdings: HoldingRow[];
  fund_status: HoldingsFundStatus[];
  pagination: Pagination;
};

// Parameters passed to the get_fund_holdings RPC (all validated).
export type HoldingsRpcArgs = {
  p_manager: string | null;
  p_fund: string | null;
  p_page: number;
  p_page_size: number;
  p_sort_column: HoldingsSortColumn;
  p_sort_direction: SortDirection;
  p_security_id_search: string | null;
  p_description_search: string | null;
  p_security_type: string | null;
  p_sector_type: string | null;
  p_changed_within: number | null;
};

export type HoldingsExportRpcArgs = Omit<
  HoldingsRpcArgs,
  "p_page" | "p_page_size" | "p_sort_column" | "p_sort_direction"
> & { p_max_rows: number };

// The "changed within" filter offers the same trading-day presets as the Changes
// range picker, minus 1Y: a holdings filter that long is meaningless.
const CHANGED_PRESETS = ["1D", "7D", "30D"] as const;

/** A trimmed, non-empty string, or null. "all" / "" collapse to null (means all). */
function optText(value: string | null): string | null {
  if (value == null) return null;
  const t = value.trim();
  if (t === "" || t.toLowerCase() === "all") return null;
  return t;
}

/** Validate the query params for the paginated holdings route into RPC args. */
export function validateHoldingsQuery(sp: URLSearchParams): ValidationResult<HoldingsRpcArgs> {
  const pageRaw = Number(sp.get("h_page") ?? "1");
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1;

  const sizeRaw = Number(sp.get("h_page_size") ?? String(DEFAULT_PAGE_SIZE));
  if (!ALLOWED_PAGE_SIZES.includes(sizeRaw as (typeof ALLOWED_PAGE_SIZES)[number])) {
    return { ok: false, error: `invalid_page_size: allowed ${ALLOWED_PAGE_SIZES.join(", ")}` };
  }

  const sortCol = (sp.get("h_sort") ?? DEFAULT_HOLDINGS_SORT) as HoldingsSortColumn;
  if (!HOLDINGS_SORT_COLUMNS.includes(sortCol)) {
    return { ok: false, error: `invalid_sort_column: ${sortCol}` };
  }
  const dir = (sp.get("h_dir") ?? "desc") as SortDirection;
  if (!SORT_DIRECTIONS.includes(dir)) {
    return { ok: false, error: `invalid_sort_direction: ${dir}` };
  }

  const changed = sp.get("changed");
  let changedWithin: number | null = null;
  if (changed != null && changed !== "") {
    const key = changed.trim().toUpperCase();
    if (!(CHANGED_PRESETS as readonly string[]).includes(key)) {
      return { ok: false, error: `invalid_changed: ${changed}` };
    }
    changedWithin = PRESET_LOOKBACK[key];
  }

  return {
    ok: true,
    value: {
      p_manager: optText(sp.get("manager")),
      p_fund: optText(sp.get("fund")),
      p_page: page,
      p_page_size: sizeRaw,
      p_sort_column: sortCol,
      p_sort_direction: dir,
      p_security_id_search: optText(sp.get("h_q_security")),
      p_description_search: optText(sp.get("h_q_description")),
      p_security_type: optText(sp.get("h_f_security_type")),
      p_sector_type: optText(sp.get("h_f_sector_type")),
      p_changed_within: changedWithin,
    },
  };
}

/** Export args reuse the same validation but drop pagination/sort. */
export function validateHoldingsExportQuery(
  sp: URLSearchParams,
): ValidationResult<HoldingsExportRpcArgs> {
  const base = validateHoldingsQuery(sp);
  if (!base.ok) return base;
  const v = base.value;
  return {
    ok: true,
    value: {
      p_manager: v.p_manager,
      p_fund: v.p_fund,
      p_security_id_search: v.p_security_id_search,
      p_description_search: v.p_description_search,
      p_security_type: v.p_security_type,
      p_sector_type: v.p_sector_type,
      p_changed_within: v.p_changed_within,
      p_max_rows: exportMaxRows(),
    },
  };
}

/** ISO YYYY-MM-DD -> DD/MM/YY, matching fmtDMY on the Changes tab. */
function dmy(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y.slice(2)}`;
}

const KIND_TAG: Record<LastChangeKind, "Added" | "Par ↑" | "Par ↓"> = {
  added: "Added",
  par_increased: "Par ↑",
  par_decreased: "Par ↓",
};

/**
 * Presentation of the "Last change" cell. Three cases, each deliberately distinct:
 * a dated change (tag + date), a holding never changed since we first saw it
 * (muted "unchanged since" / "held since" — wording follows the basis because a
 * market-value fund has no par to be "unchanged"), and a row whose derived data
 * is missing (muted dash; its fund is flagged stale separately).
 */
export function formatLastChange(
  row: Pick<HoldingRow, "last_change_date" | "last_change_kind" | "since_first" | "comparison_basis">,
): { date: string; tag: "Added" | "Par ↑" | "Par ↓" | null; muted: boolean; text: string } {
  if (!row.last_change_date) {
    return { date: "", tag: null, muted: true, text: "—" };
  }
  const date = dmy(row.last_change_date);
  if (row.since_first) {
    const verb = row.comparison_basis === "MARKET_VALUE" ? "held since" : "unchanged since";
    return { date, tag: null, muted: true, text: `${verb} ${date}` };
  }
  if (!row.last_change_kind) {
    return { date: "", tag: null, muted: true, text: "—" };
  }
  const tag = KIND_TAG[row.last_change_kind];
  return { date, tag, muted: false, text: `${tag} ${date}` };
}
