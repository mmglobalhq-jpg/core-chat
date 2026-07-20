/**
 * Server-only REIT Research data-access layer.
 *
 * Reads the ARR research engine's reports through its **normalized reader-contract
 * RPCs** (migration 0005) so the route handlers never embed issuer-specific table
 * queries. All access goes through the dedicated server-only client (service-role
 * key) in `lib/supabaseReits.ts`; the RPCs own schema knowledge, completed/current
 * filtering, ordering, and namespacing.
 *
 * Reader contract (source of truth: arr-research-engine migration 0005):
 *   - reit_research_list_issuers_v1()                      → issuers w/ ≥1 current report
 *   - reit_research_list_reports_v1(p_issuer_code, p_limit) → completed/current summaries
 *   - reit_research_get_report_v1(p_report_id)             → one completed/current report
 *
 * Report ids are namespaced (`arr:<uuid>` / `orc:<uuid>`). A bare UUID is accepted by
 * the detail RPC as a transitional legacy ARR id; it is never interpreted as ORC.
 *
 * Issuers are data-driven: only codes the contract reports appear. The code→display
 * name map is a fallback only (the RPC returns the display name).
 */
import { getSupabaseReits } from "@/lib/supabaseReits";

// ---- Browser-facing contracts (kept small + stable) ----

export type ReitIssuer = {
  symbol: string;
  name: string;
  reportCount: number;
  latestReportDate: string | null;
};

export type ReitReportSummary = {
  id: string; // namespaced: arr:<uuid> / orc:<uuid>
  issuerSymbol: string;
  issuerName: string;
  title: string;
  portfolioDate: string | null;
  publicationDate: string | null;
  version: number | null;
};

export type ReitReportDetail = ReitReportSummary & {
  bodyMarkdown: string;
};

/** Thrown by this layer; carries the HTTP status a route should return. */
export class ReitServiceError extends Error {
  httpStatus: number;
  constructor(httpStatus: number, message: string) {
    super(message);
    this.name = "ReitServiceError";
    this.httpStatus = httpStatus;
  }
}

// Redacted message for unexpected data-service failures — never leak SQL detail.
const SERVICE_ERR = "REIT research data service error";
// The reader contract clamps to [1, 100]; ask for the max page.
const REPORTS_LIMIT = 100;

// Reader-contract RPC names (versioned; constants, never derived from input).
const RPC_LIST_ISSUERS = "reit_research_list_issuers_v1";
const RPC_LIST_REPORTS = "reit_research_list_reports_v1";
const RPC_GET_REPORT = "reit_research_get_report_v1";

// ---- Issuer catalog (display-name fallback only; the list is data-driven) ----

const ISSUER_NAMES: Record<string, string> = {
  ARR: "ARMOUR Residential REIT",
  ORC: "Orchid Island Capital, Inc.",
};

function issuerName(code: string): string {
  return ISSUER_NAMES[code] ?? code;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * Deterministic fallback title from the real issuer + reporting period, used only
 * when a version has no stored title. Never derived from pipeline timestamps.
 */
function fallbackTitle(name: string, portfolioDate: string | null): string {
  if (!portfolioDate) return `${name} — Monthly Report`;
  const [y, m] = portfolioDate.split("-");
  const month = MONTHS[Number(m) - 1];
  if (!month || !y) return `${name} — Monthly Report`;
  return `${name} — ${month} ${y} Monthly Report`;
}

function titleFor(name: string, title: string | null, portfolioDate: string | null): string {
  const h = (title ?? "").trim();
  return h.length > 0 ? h : fallbackTitle(name, portfolioDate);
}

// ---- Input validation ----

// Uppercase alphanumeric issuer symbol (with an optional dot), bounded length.
const ISSUER_RE = /^[A-Z][A-Z0-9.]{0,9}$/;
const UUID_RE = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
// Namespaced (arr:/orc:) UUID, or — transitionally — a bare UUID (legacy ARR).
const REPORT_ID_RE = new RegExp(`^(?:(arr|orc):)?(${UUID_RE})$`);

/** Normalize + validate an issuer symbol, or throw a 400. */
export function validateIssuerSymbol(raw: string | null | undefined): string {
  const v = (raw ?? "").trim().toUpperCase();
  if (!ISSUER_RE.test(v)) throw new ReitServiceError(400, "Invalid issuer symbol");
  return v;
}

/**
 * Normalize + validate a report id, or throw a 400. Accepts `arr:<uuid>`,
 * `orc:<uuid>`, or a bare `<uuid>` (transitional legacy ARR); returns the
 * normalized lowercase form.
 */
export function validateReportId(raw: string | null | undefined): string {
  const v = (raw ?? "").trim().toLowerCase();
  const m = REPORT_ID_RE.exec(v);
  if (!m) throw new ReitServiceError(400, "Invalid report id");
  return m[1] ? `${m[1]}:${m[2]}` : m[2];
}

// ---- Reader-contract RPC rows ----

type IssuerRow = {
  issuer_code: string;
  issuer_name: string | null;
  report_count: number | null;
  latest_portfolio_as_of_date: string | null;
  latest_publication_date: string | null;
};
type SummaryRow = {
  report_id: string;
  issuer_code: string;
  issuer_name: string | null;
  portfolio_as_of_date: string | null;
  publication_date: string | null;
  title: string | null;
  version: number | null;
  status: string | null;
};
type DetailRow = SummaryRow & { markdown: string | null };

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T[]> {
  const { data, error } = await getSupabaseReits().rpc(fn, args);
  if (error) throw new ReitServiceError(502, SERVICE_ERR);
  return (data ?? []) as T[];
}

function toSummary(row: SummaryRow): ReitReportSummary {
  const name = row.issuer_name ?? issuerName(row.issuer_code);
  return {
    id: row.report_id,
    issuerSymbol: row.issuer_code,
    issuerName: name,
    title: titleFor(name, row.title, row.portfolio_as_of_date),
    portfolioDate: row.portfolio_as_of_date,
    publicationDate: row.publication_date,
    version: row.version,
  };
}

// ---- Queries ----

/** Issuers that have at least one completed/current report. */
export async function listIssuers(): Promise<ReitIssuer[]> {
  const rows = await rpc<IssuerRow>(RPC_LIST_ISSUERS, {});
  return rows
    .map((r) => ({
      symbol: r.issuer_code,
      name: r.issuer_name ?? issuerName(r.issuer_code),
      reportCount: r.report_count ?? 0,
      latestReportDate: r.latest_portfolio_as_of_date,
    }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
}

/** Completed current reports for one issuer, newest first (server-ordered). */
export async function listReports(issuerSymbol: string): Promise<ReitReportSummary[]> {
  const rows = await rpc<SummaryRow>(RPC_LIST_REPORTS, {
    p_issuer_code: issuerSymbol,
    p_limit: REPORTS_LIMIT,
  });
  return rows.map(toSummary);
}

/** One completed current report with its full Markdown body, or null if unknown. */
export async function getReport(reportId: string): Promise<ReitReportDetail | null> {
  const rows = await rpc<DetailRow>(RPC_GET_REPORT, { p_report_id: reportId });
  const row = rows[0];
  if (!row) return null;
  return { ...toSummary(row), bodyMarkdown: row.markdown ?? "" };
}
