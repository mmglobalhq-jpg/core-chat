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

/** Build `n` distinct monthly ORC reports (newest last), all publishable/current v3. */
export function manyOrcReports(n: number): Rec[] {
  const recs: Rec[] = [];
  for (let i = 0; i < n; i++) {
    const monthIndex = i; // months back-to-front; distinct year-month per report
    const y = 2024 + Math.floor(monthIndex / 12);
    const mo = String((monthIndex % 12) + 1).padStart(2, "0");
    const hex = String(i + 1).padStart(2, "0");
    recs.push({
      issuer: "ORC",
      uuid: `cccccccc-cccc-4ccc-8ccc-0000000000${hex}`,
      portfolioDate: `${y}-${mo}-28`,
      publicationDate: `${y}-${mo}-28`,
      title: `ORC ${y}-${mo}`,
      version: 3,
      markdown: `# ORC ${y}-${mo}`,
      publishable: true,
    });
  }
  return recs;
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

// --- Post-determinism-convergence scenario (regression for the stale-UI incident) ------
// After the backend converged every ORC report from v2 to canonical v3, the reader
// contract must resolve the CURRENT version (v3) — never a superseded v1/v2 — and ARR
// (untouched) must stay at v1. These ids/records model that verified production state.
const UUID_ORC_JUN = "66666666-6666-4666-8666-666666666666";
const UUID_ORC_MAY = "77777777-7777-4777-8777-777777777777";
const UUID_ORC_JUN_V2 = "88888888-8888-4888-8888-888888888888";
const UUID_ORC_JUN_V1 = "99999999-9999-4999-8999-999999999999";
const UUID_ARR_MAY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

export const CONVERGED_IDS = {
  ORC_JUN_V3: `orc:${UUID_ORC_JUN}`, // current ORC 2026-06-30, version 3
  ORC_MAY_V3: `orc:${UUID_ORC_MAY}`, // current ORC 2026-05-31, version 3
  ORC_JUN_V2: `orc:${UUID_ORC_JUN_V2}`, // superseded — must never be presented
  ORC_JUN_V1: `orc:${UUID_ORC_JUN_V1}`, // superseded — must never be presented
  ARR_MAY_V1: `arr:${UUID_ARR_MAY}`, // current ARR 2026-05-31, version 1
};

// The current (publishable) rows are what the reader contract exposes; the superseded
// v2/v1 rows are non-publishable (the DB never points current_version_id at them).
export const SAMPLE_CONVERGED: Rec[] = [
  { issuer: "ORC", uuid: UUID_ORC_JUN, portfolioDate: "2026-06-30", publicationDate: "2026-07-10",
    title: "ORCHID ISLAND CAPITAL ANNOUNCES ESTIMATED SECOND QUARTER 2026 RESULTS", version: 3,
    markdown: "# ORC June 2026 — v3 canonical body", publishable: true },
  { issuer: "ORC", uuid: UUID_ORC_MAY, portfolioDate: "2026-05-31", publicationDate: "2026-06-11",
    title: "ORCHID ISLAND CAPITAL ANNOUNCES JUNE 2026 CHARACTERISTICS", version: 3,
    markdown: "# ORC May 2026 — v3 canonical body", publishable: true },
  { issuer: "ORC", uuid: UUID_ORC_JUN_V2, portfolioDate: "2026-06-30", publicationDate: "2026-07-10",
    title: "SUPERSEDED v2", version: 2, markdown: "# stale v2 body", publishable: false },
  { issuer: "ORC", uuid: UUID_ORC_JUN_V1, portfolioDate: "2026-06-30", publicationDate: "2026-07-10",
    title: "SUPERSEDED v1", version: 1, markdown: "# stale v1 body", publishable: false },
  { issuer: "ARR", uuid: UUID_ARR_MAY, portfolioDate: "2026-05-31", publicationDate: "2026-06-12",
    title: "ARR adds $466mm to portfolio in May", version: 1,
    markdown: "# ARR May 2026 body", publishable: true },
];
