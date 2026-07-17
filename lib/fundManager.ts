/**
 * Shared contract for the Fund Manager feature: the types returned by the poller
 * RPCs and the server-side validators used by every /api/funds/* route. Pure and
 * dependency-free so it can be imported by both server routes and the client page
 * (and unit-tested directly). No secrets, no Supabase imports.
 */

// Allowed interactive page sizes. Anything else is rejected server-side.
export const ALLOWED_PAGE_SIZES = [50, 100, 250, 500] as const;
export const DEFAULT_PAGE_SIZE = 100;

// Whitelisted sortable columns — never interpolate an unchecked identifier.
export const SORTABLE_COLUMNS = [
  "security_id",
  "description",
  "security_type",
  "sector_type",
  "par_amount",
  "par_change",
  "change_type",
] as const;
export type SortColumn = (typeof SORTABLE_COLUMNS)[number];

export const SORT_DIRECTIONS = ["asc", "desc"] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

export const CHANGE_TYPES = [
  "Added",
  "Removed",
  "Increased",
  "Decreased",
  "Metadata Conflict",
] as const;
export type ChangeType = (typeof CHANGE_TYPES)[number];

// Configurable CSV export ceiling (rows). Overridable via env at deploy time.
export const DEFAULT_EXPORT_MAX_ROWS = 100_000;
export function exportMaxRows(): number {
  const raw = Number(process.env.FUNDS_EXPORT_MAX_ROWS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_EXPORT_MAX_ROWS;
}

export type FundStatusCode =
  | "ok"
  | "insufficient_history"
  | "no_start_snapshot"
  | "no_end_snapshot";

export type FundStatus = {
  fund_manager: string;
  fund_ticker: string;
  requested_start_date: string;
  requested_end_date: string;
  actual_start_date: string | null;
  actual_end_date: string | null;
  status: FundStatusCode;
  matching_row_count: number;
  warning_count: number;
  reason: string | null;
};

export type ChangeRow = {
  fund_manager: string;
  fund_ticker: string;
  security_id: string;
  description: string | null;
  security_type: string | null;
  sector_type: string | null;
  // Full-precision NUMERIC(38,10) as strings; null for Metadata Conflict rows.
  par_amount: string | null;
  par_change: string | null;
  change_type: ChangeType;
  metadata_conflict: boolean;
  conflict_fields: string[];
  conflict_reason: string | null;
  requested_start_date: string;
  requested_end_date: string;
  actual_start_date: string | null;
  actual_end_date: string | null;
};

export type Pagination = {
  page: number;
  page_size: number;
  total_rows: number;
  total_pages: number;
};

export type ChangesResponse = {
  changes: ChangeRow[];
  fund_status: FundStatus[];
  pagination: Pagination;
};

// Parameters passed to the get_fund_position_changes RPC (all validated).
export type ChangesRpcArgs = {
  p_manager: string | null;
  p_fund: string | null;
  p_start_date: string;
  p_end_date: string;
  p_page: number;
  p_page_size: number;
  p_sort_column: SortColumn;
  p_sort_direction: SortDirection;
  p_security_id_search: string | null;
  p_description_search: string | null;
  p_security_type: string | null;
  p_sector_type: string | null;
  p_change_types: string[] | null;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A validated ISO date (YYYY-MM-DD) that is also a real calendar date, or null. */
export function parseIsoDate(value: string | null | undefined): string | null {
  if (!value || !ISO_DATE.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return null;
  }
  return value;
}

/** A trimmed, non-empty string, or null. "all" / "" collapse to null (means all). */
function optText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const t = value.trim();
  if (t === "" || t.toLowerCase() === "all") return null;
  return t;
}

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Validate the query params for the paginated changes route into RPC args. Never
 * trusts client-provided sort columns, page sizes, dates, or change types.
 */
export function validateChangesQuery(sp: URLSearchParams): ValidationResult<ChangesRpcArgs> {
  const start = parseIsoDate(sp.get("start"));
  const end = parseIsoDate(sp.get("end"));
  if (!start || !end) {
    return { ok: false, error: "start and end must be valid ISO dates (YYYY-MM-DD)" };
  }
  if (start > end) {
    return { ok: false, error: "invalid_date_range: start date is after end date" };
  }

  const pageRaw = Number(sp.get("page") ?? "1");
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1;

  const sizeRaw = Number(sp.get("page_size") ?? String(DEFAULT_PAGE_SIZE));
  if (!ALLOWED_PAGE_SIZES.includes(sizeRaw as (typeof ALLOWED_PAGE_SIZES)[number])) {
    return { ok: false, error: `invalid_page_size: allowed ${ALLOWED_PAGE_SIZES.join(", ")}` };
  }

  const sortCol = (sp.get("sort") ?? "par_change") as SortColumn;
  if (!SORTABLE_COLUMNS.includes(sortCol)) {
    return { ok: false, error: `invalid_sort_column: ${sortCol}` };
  }
  const dir = (sp.get("dir") ?? "desc") as SortDirection;
  if (!SORT_DIRECTIONS.includes(dir)) {
    return { ok: false, error: `invalid_sort_direction: ${dir}` };
  }

  const changeTypes = parseChangeTypes(sp.getAll("change_type"), sp.get("change_type"));
  if (changeTypes && changeTypes.some((c) => !CHANGE_TYPES.includes(c as ChangeType))) {
    return { ok: false, error: "invalid change_type filter" };
  }

  return {
    ok: true,
    value: {
      p_manager: optText(sp.get("manager")),
      p_fund: optText(sp.get("fund")),
      p_start_date: start,
      p_end_date: end,
      p_page: page,
      p_page_size: sizeRaw,
      p_sort_column: sortCol,
      p_sort_direction: dir,
      p_security_id_search: optText(sp.get("q_security")),
      p_description_search: optText(sp.get("q_description")),
      p_security_type: optText(sp.get("f_security_type")),
      p_sector_type: optText(sp.get("f_sector_type")),
      p_change_types: changeTypes,
    },
  };
}

/** change_type may arrive repeated or comma-joined; normalise to a list or null. */
export function parseChangeTypes(
  many: string[],
  single: string | null,
): string[] | null {
  // Accept both repeated params (?change_type=A&change_type=B) and a single
  // comma-joined value (?change_type=A,B). Split every element on commas.
  const raw = many.length > 0 ? many : single ? [single] : [];
  const cleaned = raw
    .flatMap((s) => s.split(","))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return cleaned.length > 0 ? cleaned : null;
}

/** Export args reuse the same validation but drop pagination/sort. */
export function validateExportQuery(
  sp: URLSearchParams,
): ValidationResult<Omit<ChangesRpcArgs, "p_page" | "p_page_size" | "p_sort_column" | "p_sort_direction"> & { p_max_rows: number }> {
  const base = validateChangesQuery(sp);
  if (!base.ok) return base;
  const v = base.value;
  return {
    ok: true,
    value: {
      p_manager: v.p_manager,
      p_fund: v.p_fund,
      p_start_date: v.p_start_date,
      p_end_date: v.p_end_date,
      p_security_id_search: v.p_security_id_search,
      p_description_search: v.p_description_search,
      p_security_type: v.p_security_type,
      p_sector_type: v.p_sector_type,
      p_change_types: v.p_change_types,
      p_max_rows: exportMaxRows(),
    },
  };
}

/** Truncate a full-precision decimal string toward zero for table display only. */
export function truncateDecimalTowardZero(value: string | null): string {
  if (value == null) return "";
  const neg = value.trim().startsWith("-");
  const intPart = value.trim().replace(/^[-+]/, "").split(".")[0] || "0";
  const n = intPart.replace(/^0+(?=\d)/, "");
  const grouped = n.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return neg && n !== "0" ? `-${grouped}` : grouped;
}
