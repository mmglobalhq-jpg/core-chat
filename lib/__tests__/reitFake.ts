/**
 * In-memory fake of the ARR research engine's **reader-contract RPCs**
 * (reit_research_list_issuers_v1 / _list_reports_v1 / _get_report_v1), so the data
 * layer + routes can be tested without a network or the server-only `supabaseReits`
 * browser guard. Not a test file itself (no `.test` suffix) — imported by the REIT
 * test suites. The fake applies the same completed/current filtering + namespacing
 * the real RPCs do (only publishable rows are ever returned).
 */
type Rec = {
  issuer: string; // ARR | ORC
  uuid: string;
  portfolioDate: string | null;
  publicationDate: string | null;
  title: string | null;
  version: number;
  markdown: string;
  publishable: boolean; // false models superseded / non-current / needs_review upstream
};

const ISSUER_NAME: Record<string, string> = {
  ARR: "ARMOUR Residential REIT",
  ORC: "Orchid Island Capital, Inc.",
};

function nsId(rec: Rec): string {
  return `${rec.issuer.toLowerCase()}:${rec.uuid}`;
}

function summaryRow(rec: Rec): Record<string, unknown> {
  return {
    report_id: nsId(rec),
    issuer_code: rec.issuer,
    issuer_name: ISSUER_NAME[rec.issuer] ?? rec.issuer,
    portfolio_as_of_date: rec.portfolioDate,
    publication_date: rec.publicationDate,
    title: rec.title,
    version: rec.version,
    status: "completed",
  };
}

function listIssuers(recs: Rec[]): Record<string, unknown>[] {
  const agg = new Map<string, Record<string, unknown>>();
  for (const rec of recs) {
    if (!rec.publishable) continue;
    const a =
      agg.get(rec.issuer) ??
      {
        issuer_code: rec.issuer,
        issuer_name: ISSUER_NAME[rec.issuer] ?? rec.issuer,
        report_count: 0,
        latest_portfolio_as_of_date: null as string | null,
        latest_publication_date: null as string | null,
      };
    a.report_count = (a.report_count as number) + 1;
    const lp = a.latest_portfolio_as_of_date as string | null;
    if (rec.portfolioDate && (!lp || rec.portfolioDate > lp)) {
      a.latest_portfolio_as_of_date = rec.portfolioDate;
    }
    const lpub = a.latest_publication_date as string | null;
    if (rec.publicationDate && (!lpub || rec.publicationDate > lpub)) {
      a.latest_publication_date = rec.publicationDate;
    }
    agg.set(rec.issuer, a);
  }
  return [...agg.values()].sort((a, b) =>
    String(a.issuer_code).localeCompare(String(b.issuer_code)),
  );
}

function listReports(recs: Rec[], code: string, limit: number): Record<string, unknown>[] {
  const lim = Math.max(1, Math.min(Number(limit || 20), 250)); // reader contract clamp (0006)
  const want = (code || "").toUpperCase();
  return recs
    .filter((r) => r.publishable && r.issuer === want)
    .sort((a, b) => {
      const pa = a.portfolioDate ?? "";
      const pb = b.portfolioDate ?? "";
      if (pa !== pb) return pa < pb ? 1 : -1;
      const ua = a.publicationDate ?? "";
      const ub = b.publicationDate ?? "";
      if (ua !== ub) return ua < ub ? 1 : -1;
      return nsId(a).localeCompare(nsId(b));
    })
    .slice(0, lim)
    .map(summaryRow);
}

function getReport(recs: Rec[], pid: string): Record<string, unknown>[] {
  const low = (pid || "").toLowerCase();
  let issuer: string;
  let uuid: string;
  if (low.startsWith("arr:")) {
    issuer = "ARR";
    uuid = low.slice(4);
  } else if (low.startsWith("orc:")) {
    issuer = "ORC";
    uuid = low.slice(4);
  } else if (!low.includes(":")) {
    issuer = "ARR"; // bare UUID -> legacy ARR only
    uuid = low;
  } else {
    return [];
  }
  const rec = recs.find((r) => r.publishable && r.issuer === issuer && r.uuid === uuid);
  return rec ? [{ ...summaryRow(rec), markdown: rec.markdown }] : [];
}

export function makeFakeReitsClient(recs: Rec[]): {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: null }>;
} {
  return {
    rpc(fn: string, args: Record<string, unknown>) {
      let data: unknown = [];
      if (fn === "reit_research_list_issuers_v1") data = listIssuers(recs);
      else if (fn === "reit_research_list_reports_v1")
        data = listReports(recs, String(args.p_issuer_code ?? ""), Number(args.p_limit ?? 20));
      else if (fn === "reit_research_get_report_v1")
        data = getReport(recs, String(args.p_report_id ?? ""));
      return Promise.resolve({ data, error: null });
    },
  };
}

// A UUID deliberately shared by an ARR report and an ORC report (namespacing must
// disambiguate); distinct UUIDs for the other rows.
const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
const UUID_SUP = "44444444-4444-4444-8444-444444444444";
const UUID_GEN = "55555555-5555-4555-8555-555555555555";

export const REPORT_IDS = {
  UUID_A,
  ARR_A: `arr:${UUID_A}`,
  ARR_B: `arr:${UUID_B}`,
  ORC_A: `orc:${UUID_A}`,
  ARR_SUP: `arr:${UUID_SUP}`,
  ARR_GEN: `arr:${UUID_GEN}`,
};

const ARR_MD =
  "# Executive summary\n\n- alpha\n- beta\n\n[filing](https://example.test/x)\n\n" +
  "| Metric | Value |\n|---|---|\n| Total | 22198 |";

// Publishable ARR (2) + ORC (1); plus non-publishable rows (never returned) kept so
// detail-not-found tests have real ids to probe.
export const SAMPLE: Rec[] = [
  { issuer: "ARR", uuid: UUID_A, portfolioDate: "2026-05-31", publicationDate: "2026-06-12",
    title: "ARR adds $466mm to portfolio in May", version: 1, markdown: ARR_MD, publishable: true },
  { issuer: "ARR", uuid: UUID_B, portfolioDate: "2026-04-30", publicationDate: "2026-05-14",
    title: null, version: 2, markdown: "# April body", publishable: true },
  { issuer: "ORC", uuid: UUID_A, portfolioDate: "2026-04-30", publicationDate: "2026-05-03",
    title: "Orchid Island Capital, Inc. (ORC) — RMBS as of April 30, 2026", version: 1,
    markdown: "# ORC body", publishable: true },
  { issuer: "ARR", uuid: UUID_SUP, portfolioDate: "2026-02-28", publicationDate: "2026-03-16",
    title: "OLD SUPERSEDED", version: 1, markdown: "superseded body", publishable: false },
  { issuer: "ARR", uuid: UUID_GEN, portfolioDate: "2026-01-31", publicationDate: "2026-02-14",
    title: "GENERATING", version: 1, markdown: "draft body", publishable: false },
];

// ARR-only variant: ORC has no publishable reports, so it must be absent from the list.
export const SAMPLE_NO_ORC: Rec[] = SAMPLE.filter((r) => r.issuer !== "ORC");
