# REIT Research (chat.mmglobal.us)

The **REIT Research** page (`/reits`, linked from the sidebar **Apps → REIT**) lets
an authenticated user pick a REIT, browse every completed report for it (newest
first), and read the full generated report in the page.

The reports are produced by the **ARR research engine** (a separate service). This
app is strictly read-only: it authenticates the chat user, validates input, reads
the engine's `reit_arr_*` tables server-side with a dedicated service-role client,
and renders the stored Markdown. It never creates, edits, or triggers reports, and
never calls Anthropic / FRED / Docling / the research pipeline.

## Feature overview

- **Sidebar → REIT** opens `/reits`.
- A **data-driven dropdown** lists every issuer that has at least one completed
  report — initially just `ARMOUR Residential REIT (ARR)`.
- The left column lists that issuer's reports newest first; the right column renders
  the selected report's Markdown (headings, lists, links, GFM tables).
- Selection is **URL-backed**: `/reits?issuer=ARR&report=<report-id>`. Refresh,
  direct links, and browser back/forward all restore the selection. An absent or
  invalid `report` falls back to the newest; an absent/invalid `issuer` falls back
  to `ARR` (or the first available issuer).

## Data contract (source of truth: the ARR research engine)

| Concern | Location |
|---|---|
| Issuer identity | `reit_arr_reports.issuer_code` (e.g. `ARR`) |
| Report (per period) | `reit_arr_reports` — canonical id, `portfolio_as_of_date`, `current_version_id`, `status` |
| Report body + title | `reit_arr_report_versions.markdown` / `.headline`, `.version` |
| Publication date | `reit_arr_source_documents.publication_date` |

**Completed / current filtering.** A report is shown only when
`reit_arr_reports.status = 'completed'` **and** its `current_version_id` points at a
`report_versions` row whose `status = 'completed'`. Superseded revisions
(`status='superseded'`) are never a report's current version and are excluded, as are
draft / `needs_review` / failed reports. The canonical browser-facing id is
`reit_arr_reports.id`.

**Titles.** The stored `headline` is the title. Historical rows without a headline
get a deterministic fallback derived from the issuer + reporting period —
`ARMOUR Residential REIT — May 2026 Monthly Report` — never a pipeline timestamp.

**How a future REIT appears automatically.** Issuers come from
`DISTINCT issuer_code` over completed reports, so once the research database contains
valid completed reports for a new issuer code, it appears in the dropdown with **no
UI code change**. The only server-side configuration is the optional display-name map
in `lib/reitResearch.ts` (`ISSUER_NAMES`); an unmapped code falls back to the code
itself as its name.

## API routes (authenticated, read-only, `Cache-Control: no-store`)

- `GET /api/reits/issuers` → `{ issuers: ReitIssuer[] }`
- `GET /api/reits/reports?issuer=ARR` → `{ issuer, reports: ReitReportSummary[] }`
- `GET /api/reits/reports/[reportId]` → `{ report: ReitReportDetail }`

All routes gate with `requireUser` (401 on missing/invalid bearer), validate the
issuer symbol (400 on malformed) and report id as a UUID (400 on malformed), return
404 for unknown / non-current reports, and return a sanitized 502 on any data-service
failure. They never return credentials, Storage keys, or private object paths, and
never mutate data.

```ts
type ReitIssuer       = { symbol; name; reportCount; latestReportDate: string | null };
type ReitReportSummary= { id; issuerSymbol; issuerName; title; portfolioDate; publicationDate; version };
type ReitReportDetail = ReitReportSummary & { bodyMarkdown: string };
```

## Security boundary

`lib/supabaseReits.ts` is a **server-only** client (lazy singleton, immediate
browser-import guard, service-role credentials never serialized). It is imported only
by `lib/reitResearch.ts`, which is imported only by the route handlers — never by a
browser component. The report body is read from the database and returned by the
authenticated route; no public Storage URL is ever exposed. Markdown is rendered with
`react-markdown` + `remark-gfm` with **raw HTML disabled** (no `rehype-raw`, no
`dangerouslySetInnerHTML`), so injected HTML/script is inert.

## Environment variables (server-only — never `NEXT_PUBLIC_`)

```
REITS_SUPABASE_URL=              # the ARR research engine's Supabase project URL
REITS_SUPABASE_SERVICE_ROLE_KEY= # service-role key (bypasses the reit_arr_* forced RLS)
```

The `reit_arr_*` tables have forced row-level security with browser roles revoked, so
only the service-role key can read them — hence a dedicated server-only client. No
Storage bucket variable is required because the report body (Markdown) lives in the
database. This may be the same Supabase project as Core Chat; the client stays
dedicated and isolated regardless. See `.env.local.example`.

## Local development

1. Copy `.env.local.example` → `.env.local` and fill `REITS_SUPABASE_URL` /
   `REITS_SUPABASE_SERVICE_ROLE_KEY` (plus the existing chat vars).
2. `pnpm install && pnpm dev`, sign in, open **Apps → REIT**.

## Tests

`pnpm test` (Vitest). Coverage: `lib/__tests__/reitResearch.test.ts` (data-driven
issuers, newest-first ordering, superseded/non-completed exclusion, fallback titles,
validators), `app/api/reits/__tests__/routes.test.ts` (401/400/404/502, no-store,
completed/current only), `app/reits/__tests__/page.test.tsx` (ARR default, URL state,
fallback-to-newest, empty/error states, safe Markdown rendering),
`lib/__tests__/supabaseReits.guard.test.ts` (server-only boundary), and
`components/layout/__tests__/Sidebar.test.tsx` (REIT link + active state). All use
mocked Supabase data — no production access.

## Troubleshooting

- **Empty dropdown / "No REITs are available yet."** — the research database has no
  reports with `status='completed'`, or `REITS_SUPABASE_*` is unset/incorrect (the
  routes return a sanitized 502 rather than leaking detail; check server logs).
- **"No reports for this REIT yet."** — the issuer has no completed current reports.
- **A report 404s after a revision** — a superseded version id is not served; the UI
  falls back to the newest current report. Use the canonical `reit_arr_reports.id`.
- **401 / session expired** — the page prompts to sign in again; the bearer token is
  taken from the Supabase session on each request.
