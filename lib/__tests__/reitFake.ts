/**
 * Minimal in-memory fake of the Supabase/PostgREST query builder used by
 * `lib/reitResearch.ts`, so the data layer + routes can be tested without a
 * network or the server-only `supabaseReits` browser guard. Not a test file
 * itself (no `.test` suffix) — imported by the REIT test suites.
 */
type Row = Record<string, unknown>;
type QueryResult = { data: Row[]; error: null };

class FakeQuery implements PromiseLike<QueryResult> {
  private preds: ((r: Row) => boolean)[] = [];
  private orderKey: string | null = null;
  private orderAsc = true;
  private limitN: number | null = null;

  constructor(private rows: Row[]) {}

  select(): this {
    return this;
  }
  eq(col: string, val: unknown): this {
    this.preds.push((r) => r[col] === val);
    return this;
  }
  in(col: string, vals: unknown[]): this {
    this.preds.push((r) => vals.includes(r[col]));
    return this;
  }
  // Only used as `.not("col", "is", null)` -> "col is not null".
  not(col: string): this {
    this.preds.push((r) => r[col] !== null && r[col] !== undefined);
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }): this {
    this.orderKey = col;
    this.orderAsc = opts?.ascending ?? true;
    return this;
  }
  limit(n: number): this {
    this.limitN = n;
    return this;
  }

  private compute(): Row[] {
    let out = this.rows.filter((r) => this.preds.every((p) => p(r)));
    if (this.orderKey) {
      const k = this.orderKey;
      out = [...out].sort((a, b) => {
        const av = String(a[k] ?? "");
        const bv = String(b[k] ?? "");
        if (av === bv) return 0;
        return av < bv ? (this.orderAsc ? -1 : 1) : this.orderAsc ? 1 : -1;
      });
    }
    if (this.limitN !== null) out = out.slice(0, this.limitN);
    return out;
  }

  async maybeSingle(): Promise<{ data: Row | null; error: null }> {
    const out = this.compute();
    return { data: out[0] ?? null, error: null };
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve({ data: this.compute(), error: null } as QueryResult).then(
      onfulfilled,
      onrejected,
    );
  }
}

export type FakeTables = { reports: Row[]; versions: Row[]; docs: Row[] };

export function makeFakeReitsClient(tables: FakeTables): { from: (name: string) => FakeQuery } {
  return {
    from(name: string): FakeQuery {
      if (name === "reit_arr_reports") return new FakeQuery(tables.reports);
      if (name === "reit_arr_report_versions") return new FakeQuery(tables.versions);
      if (name === "reit_arr_source_documents") return new FakeQuery(tables.docs);
      return new FakeQuery([]);
    },
  };
}

// A representative dataset covering: completed current reports (ARR), a null
// headline (fallback title), a v2 report (version indicator), a superseded current
// version (must be excluded), a non-completed report (excluded), a second issuer
// (data-driven), and an issuer with only a non-completed report (absent).
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const SUP = "44444444-4444-4444-8444-444444444444";
const GEN = "55555555-5555-4555-8555-555555555555";
const X = "66666666-6666-4666-8666-666666666666";
const Q = "77777777-7777-4777-8777-777777777777";

export const REPORT_IDS = { A, B, C, SUP, GEN, X, Q };

export const SAMPLE: FakeTables = {
  reports: [
    { id: A, issuer_code: "ARR", portfolio_as_of_date: "2026-05-31", current_version_id: "v-a", status: "completed" },
    { id: B, issuer_code: "ARR", portfolio_as_of_date: "2026-04-30", current_version_id: "v-b", status: "completed" },
    { id: C, issuer_code: "ARR", portfolio_as_of_date: "2026-03-31", current_version_id: "v-c", status: "completed" },
    { id: SUP, issuer_code: "ARR", portfolio_as_of_date: "2026-02-28", current_version_id: "v-sup", status: "completed" },
    { id: GEN, issuer_code: "ARR", portfolio_as_of_date: "2026-01-31", current_version_id: "v-gen", status: "generating" },
    { id: X, issuer_code: "XYZ", portfolio_as_of_date: "2026-05-31", current_version_id: "v-x", status: "completed" },
    { id: Q, issuer_code: "QQQ", portfolio_as_of_date: "2026-05-31", current_version_id: "v-q", status: "needs_review" },
  ],
  versions: [
    { id: "v-a", headline: "ARR adds $466mm to portfolio in May", version: 1, source_document_id: "d-a", status: "completed", markdown: "# Executive summary\n\n- alpha\n- beta\n\n[filing](https://example.test/x)\n\n| Metric | Value |\n|---|---|\n| Total | 22198 |" },
    { id: "v-b", headline: null, version: 1, source_document_id: "d-b", status: "completed", markdown: "# April body" },
    { id: "v-c", headline: "ARR March positioning note", version: 2, source_document_id: "d-c", status: "completed", markdown: "# March body" },
    { id: "v-sup", headline: "OLD SUPERSEDED", version: 1, source_document_id: "d-sup", status: "superseded", markdown: "superseded body" },
    { id: "v-gen", headline: "GENERATING", version: 1, source_document_id: "d-gen", status: "generating", markdown: "draft body" },
    { id: "v-x", headline: "XYZ Q1 report", version: 1, source_document_id: "d-x", status: "completed", markdown: "# XYZ body" },
    { id: "v-q", headline: "QQQ review", version: 1, source_document_id: "d-q", status: "needs_review", markdown: "review body" },
  ],
  docs: [
    { id: "d-a", publication_date: "2026-06-12" },
    { id: "d-b", publication_date: "2026-05-14" },
    { id: "d-c", publication_date: "2026-04-15" },
    { id: "d-sup", publication_date: "2026-03-16" },
    { id: "d-gen", publication_date: "2026-02-14" },
    { id: "d-x", publication_date: "2026-06-10" },
    { id: "d-q", publication_date: "2026-06-11" },
  ],
};
