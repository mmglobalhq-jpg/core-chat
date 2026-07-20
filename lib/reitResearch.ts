/**
 * Server-only REIT Research data-access layer.
 *
 * Centralizes every read against the ARR research engine's `reit_arr_*` tables so
 * the route handlers never embed Supabase queries directly. All access goes
 * through the dedicated server-only client (service-role key) in
 * `lib/supabaseReits.ts`.
 *
 * Data contract (source of truth: arr-research-engine SQLAlchemy models):
 *   - `reit_arr_reports`         — one row per (issuer_code, portfolio_as_of_date).
 *                                  `status='completed'` + `current_version_id` point
 *                                  at the current completed version. Canonical report id.
 *   - `reit_arr_report_versions` — the versioned report; `headline` is the title,
 *                                  `markdown` is the full body, `version` the number.
 *                                  Superseded revisions have `status='superseded'` and
 *                                  are never a report's `current_version_id`.
 *   - `reit_arr_source_documents`— `publication_date` for the underlying filing.
 *
 * Issuers are data-driven: any `issuer_code` with completed reports appears. The
 * code→display-name map is the only issuer configuration; unknown codes fall back
 * to the code itself, so a future REIT needs no UI change.
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
  id: string;
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
// Bounded upper limit on reports returned for one issuer (all monthly reports fit).
const MAX_REPORTS = 500;
// Bounded scan for the issuer catalog (distinct issuers across all completed reports).
const MAX_ISSUER_SCAN = 5000;

// ---- Issuer catalog (display names only; the list itself is data-driven) ----

const ISSUER_NAMES: Record<string, string> = {
  ARR: "ARMOUR Residential REIT",
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
 * when a historical version has no stored `headline`. Never derived from pipeline
 * timestamps. e.g. "ARMOUR Residential REIT — May 2026 Monthly Report".
 */
function fallbackTitle(name: string, portfolioDate: string | null): string {
  if (!portfolioDate) return `${name} — Monthly Report`;
  const [y, m] = portfolioDate.split("-");
  const month = MONTHS[Number(m) - 1];
  if (!month || !y) return `${name} — Monthly Report`;
  return `${name} — ${month} ${y} Monthly Report`;
}

function titleFor(name: string, headline: string | null, portfolioDate: string | null): string {
  const h = (headline ?? "").trim();
  return h.length > 0 ? h : fallbackTitle(name, portfolioDate);
}

// ---- Input validation ----

// Uppercase alphanumeric issuer symbol (with an optional dot), bounded length. This
// permits future symbols without allowing arbitrary PostgREST filter syntax.
const ISSUER_RE = /^[A-Z][A-Z0-9.]{0,9}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Normalize + validate an issuer symbol, or throw a 400. */
export function validateIssuerSymbol(raw: string | null | undefined): string {
  const v = (raw ?? "").trim().toUpperCase();
  if (!ISSUER_RE.test(v)) throw new ReitServiceError(400, "Invalid issuer symbol");
  return v;
}

/** Normalize + validate a report id (UUID), or throw a 400. */
export function validateReportId(raw: string | null | undefined): string {
  const v = (raw ?? "").trim().toLowerCase();
  if (!UUID_RE.test(v)) throw new ReitServiceError(400, "Invalid report id");
  return v;
}

// ---- Queries ----

type ReportRow = {
  id: string;
  issuer_code: string;
  portfolio_as_of_date: string | null;
  current_version_id: string | null;
};
type VersionRow = {
  id: string;
  headline: string | null;
  version: number | null;
  source_document_id: string | null;
  status: string;
  markdown?: string | null;
};

/** Distinct issuers that have at least one completed report, newest-date aware. */
export async function listIssuers(): Promise<ReitIssuer[]> {
  const sb = getSupabaseReits();
  const { data, error } = await sb
    .from("reit_arr_reports")
    .select("issuer_code, portfolio_as_of_date")
    .eq("status", "completed")
    .not("current_version_id", "is", null)
    .limit(MAX_ISSUER_SCAN);
  if (error) throw new ReitServiceError(502, SERVICE_ERR);

  const agg = new Map<string, { count: number; latest: string | null }>();
  for (const row of (data ?? []) as { issuer_code: string; portfolio_as_of_date: string | null }[]) {
    const cur = agg.get(row.issuer_code) ?? { count: 0, latest: null };
    cur.count += 1;
    const pd = row.portfolio_as_of_date;
    if (pd && (!cur.latest || pd > cur.latest)) cur.latest = pd;
    agg.set(row.issuer_code, cur);
  }
  return [...agg.entries()]
    .map(([symbol, v]) => ({
      symbol,
      name: issuerName(symbol),
      reportCount: v.count,
      latestReportDate: v.latest,
    }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
}

/** Completed current reports for one issuer, newest first. */
export async function listReports(issuerSymbol: string): Promise<ReitReportSummary[]> {
  const sb = getSupabaseReits();
  const { data: reports, error } = await sb
    .from("reit_arr_reports")
    .select("id, issuer_code, portfolio_as_of_date, current_version_id")
    .eq("issuer_code", issuerSymbol)
    .eq("status", "completed")
    .not("current_version_id", "is", null)
    .order("portfolio_as_of_date", { ascending: false })
    .limit(MAX_REPORTS);
  if (error) throw new ReitServiceError(502, SERVICE_ERR);
  const rows = (reports ?? []) as ReportRow[];
  if (rows.length === 0) return [];

  const versionIds = rows.map((r) => r.current_version_id).filter((x): x is string => !!x);
  const { data: versions, error: vErr } = await sb
    .from("reit_arr_report_versions")
    .select("id, headline, version, source_document_id, status")
    .in("id", versionIds)
    .eq("status", "completed");
  if (vErr) throw new ReitServiceError(502, SERVICE_ERR);
  const vById = new Map<string, VersionRow>(((versions ?? []) as VersionRow[]).map((v) => [v.id, v]));

  const srcIds = [
    ...new Set(
      [...vById.values()].map((v) => v.source_document_id).filter((x): x is string => !!x),
    ),
  ];
  const pubById = new Map<string, string | null>();
  if (srcIds.length > 0) {
    const { data: docs, error: dErr } = await sb
      .from("reit_arr_source_documents")
      .select("id, publication_date")
      .in("id", srcIds);
    if (dErr) throw new ReitServiceError(502, SERVICE_ERR);
    for (const d of (docs ?? []) as { id: string; publication_date: string | null }[]) {
      pubById.set(d.id, d.publication_date);
    }
  }

  const out: ReitReportSummary[] = [];
  for (const r of rows) {
    const v = r.current_version_id ? vById.get(r.current_version_id) : undefined;
    if (!v) continue; // current version isn't completed -> exclude (no superseded/draft rows)
    const name = issuerName(r.issuer_code);
    out.push({
      id: r.id,
      issuerSymbol: r.issuer_code,
      issuerName: name,
      title: titleFor(name, v.headline, r.portfolio_as_of_date),
      portfolioDate: r.portfolio_as_of_date,
      publicationDate: v.source_document_id ? (pubById.get(v.source_document_id) ?? null) : null,
      version: v.version,
    });
  }
  // Newest first: portfolio date desc, tie-broken by publication date desc.
  out.sort((a, b) => {
    const pa = a.portfolioDate ?? "";
    const pb = b.portfolioDate ?? "";
    if (pa !== pb) return pa < pb ? 1 : -1;
    const ua = a.publicationDate ?? "";
    const ub = b.publicationDate ?? "";
    return ua < ub ? 1 : ua > ub ? -1 : 0;
  });
  return out;
}

/** One completed current report with its full Markdown body, or null if unknown. */
export async function getReport(reportId: string): Promise<ReitReportDetail | null> {
  const sb = getSupabaseReits();
  const { data: report, error } = await sb
    .from("reit_arr_reports")
    .select("id, issuer_code, portfolio_as_of_date, current_version_id, status")
    .eq("id", reportId)
    .eq("status", "completed")
    .maybeSingle();
  if (error) throw new ReitServiceError(502, SERVICE_ERR);
  const r = report as ReportRow | null;
  if (!r || !r.current_version_id) return null;

  const { data: version, error: vErr } = await sb
    .from("reit_arr_report_versions")
    .select("id, headline, version, markdown, source_document_id, status")
    .eq("id", r.current_version_id)
    .eq("status", "completed")
    .maybeSingle();
  if (vErr) throw new ReitServiceError(502, SERVICE_ERR);
  const v = version as VersionRow | null;
  if (!v) return null; // current version not completed -> treat as not found

  let publicationDate: string | null = null;
  if (v.source_document_id) {
    const { data: doc, error: dErr } = await sb
      .from("reit_arr_source_documents")
      .select("publication_date")
      .eq("id", v.source_document_id)
      .maybeSingle();
    if (dErr) throw new ReitServiceError(502, SERVICE_ERR);
    publicationDate = (doc as { publication_date: string | null } | null)?.publication_date ?? null;
  }

  const name = issuerName(r.issuer_code);
  return {
    id: r.id,
    issuerSymbol: r.issuer_code,
    issuerName: name,
    title: titleFor(name, v.headline, r.portfolio_as_of_date),
    portfolioDate: r.portfolio_as_of_date,
    publicationDate,
    version: v.version,
    bodyMarkdown: v.markdown ?? "",
  };
}
