# REIT Research (chat.mmglobal.us)

The **REIT Research** page (`/reits`, linked from the sidebar **Apps → REIT**) lets
an authenticated user pick a REIT, browse every completed report for it (newest
first), and read the full generated report in the page.

The reports are produced by the **ARR research engine** (a separate service). This
app is strictly read-only: it authenticates the chat user, validates input, reads the
engine's **normalized reader-contract RPCs** server-side with a dedicated service-role
client, and renders the stored Markdown. It never creates, edits, or triggers reports,
and never calls Anthropic / FRED / Docling / the research pipeline.

## Feature overview

- **Sidebar → REIT** opens `/reits`.
- A **data-driven dropdown** lists every issuer that has at least one completed report:
  `ARMOUR Residential REIT (ARR)` and `Orchid Island Capital, Inc. (ORC)`. ORC appears
  **only** when the contract returns a completed/current ORC report — there is no
  hard-coded ORC option.
- The left column lists that issuer's reports newest first; the right column renders
  the selected report's Markdown (headings, lists, links, GFM tables).
- Selection is **URL-backed**: `/reits?issuer=ORC&report=orc:<uuid>`. Refresh, direct
  links, and browser back/forward all restore the selection. An absent or invalid
  `report` falls back to the newest; an absent/invalid `issuer` falls back to `ARR`
  (or the first available issuer).

## Data contract (the engine's reader RPCs, migration 0005)

The data layer (`lib/reitResearch.ts`) calls only three versioned, server-only RPCs
and never queries `reit_arr_*` / `reit_orc_*` tables directly:

| RPC | Purpose |
|---|---|
| `reit_research_list_issuers_v1()` | issuers with ≥1 completed/current report |
| `reit_research_list_reports_v1(p_issuer_code, p_limit)` | completed/current summaries |
| `reit_research_get_report_v1(p_report_id)` | one completed/current report + Markdown |

**Completed / current filtering** is enforced server-side by the RPCs: only reports
whose logical status is completed and whose current version is completed are returned
(ORC additionally requires a persisted snapshot). Superseded / draft / `needs_review` /
failed / non-current versions are never returned.

**Namespaced report ids.** Every id is `arr:<uuid>` or `orc:<uuid>`. The detail RPC
also accepts a **bare UUID** as a transitional **legacy ARR** id (existing ARR deep
links keep working); a bare UUID is never interpreted as ORC, so an id colliding across
issuers stays unambiguous. `validateReportId` accepts `arr:`/`orc:`/bare forms and
rejects anything else with a 400. The `[reportId]` route segment contains a colon; the
client `encodeURIComponent`s it (`orc%3A…`) and Next decodes it back.

**Titles.** The RPC returns the stored title (headline). Rows without one get a
deterministic fallback derived from issuer + reporting period —
`ARMOUR Residential REIT — May 2026 Monthly Report` — never a pipeline timestamp.

**How a future REIT appears automatically.** Issuers come from the `list_issuers` RPC,
so once the contract reports a new issuer code it appears in the dropdown with **no UI
code change**. The only optional config is the display-name fallback in
`lib/reitResearch.ts` (`ISSUER_NAMES`); the RPC already returns the display name.

## API routes (authenticated, read-only, `Cache-Control: no-store`)

- `GET /api/reits/issuers` → `{ issuers: ReitIssuer[] }`
- `GET /api/reits/reports?issuer=ORC` → `{ issuer, reports: ReitReportSummary[] }`
- `GET /api/reits/reports/[reportId]` → `{ report: ReitReportDetail }` (namespaced or
  legacy-bare id)

All routes gate with `requireUser` (401 on missing/invalid bearer), validate the issuer
symbol (400 on malformed) and the report id (400 on malformed), return 404 for unknown /
non-current reports, and return a sanitized 502 on any data-service failure. They never
return credentials, RPC/table names, or private paths, and never mutate data.

```ts
type ReitIssuer       = { symbol; name; reportCount; latestReportDate: string | null };
type ReitReportSummary= { id /* arr:/orc:<uuid> */; issuerSymbol; issuerName; title; portfolioDate; publicationDate; version };
type ReitReportDetail = ReitReportSummary & { bodyMarkdown: string };
```

## Security boundary

`lib/supabaseReits.ts` is a **server-only** client (lazy singleton, immediate
browser-import guard, service-role credentials never serialized). It is imported only by
`lib/reitResearch.ts`, which is imported only by the route handlers — never by a browser
component. The report body is returned by the authenticated route; no public Storage URL
is ever exposed. Markdown is rendered with `react-markdown` + `remark-gfm` with **raw
HTML disabled** (no `rehype-raw`, no `dangerouslySetInnerHTML`), so injected HTML/script
is inert.

A committed **client-bundle scan** (`app/reits/__tests__/bundleScan.test.ts`) asserts
the browser assets in `.next/static` never contain `REITS_SUPABASE`,
`SUPABASE_SERVICE_ROLE_KEY`, `reit_arr_` / `reit_orc_`, the reader-contract RPC names, or
the server-only client module names. It self-skips until `pnpm build` has run.

## Environment variables (server-only — never `NEXT_PUBLIC_`)

```
REITS_SUPABASE_URL=              # the ARR research engine's Supabase project URL
REITS_SUPABASE_SERVICE_ROLE_KEY= # service-role key (the only role granted EXECUTE on the RPCs)
```

The reader RPCs grant `EXECUTE` only to the service role (PUBLIC/anon/authenticated
revoked) and the underlying tables keep forced RLS, so only the service-role key can read
reports — hence a dedicated server-only client. No Storage bucket variable is required;
the report body (Markdown) is returned by the RPC. This may be the same Supabase project
as Core Chat; the client stays dedicated and isolated regardless. See `.env.local.example`.

## Local development

1. Copy `.env.local.example` → `.env.local` and fill `REITS_SUPABASE_URL` /
   `REITS_SUPABASE_SERVICE_ROLE_KEY` (plus the existing chat vars). The target project
   must have the engine's migration 0005 (reader RPCs) applied.
2. `pnpm install && pnpm dev`, sign in, open **Apps → REIT**.

## Tests

`pnpm test` (Vitest). Coverage: `lib/__tests__/reitResearch.test.ts` (data-driven
issuers incl. ORC absence, newest-first ordering, superseded/non-current exclusion,
namespacing, colliding UUIDs, legacy bare UUID, validators),
`app/api/reits/__tests__/routes.test.ts` (401/400/404/502, no-store, ARR+ORC, namespaced
+ legacy ids), `app/reits/__tests__/page.test.tsx` (ARR default, ORC data-driven
presence/absence, namespaced URL state, fallback-to-newest, safe Markdown),
`app/reits/__tests__/bundleScan.test.ts` (client-bundle scan),
`lib/__tests__/supabaseReits.guard.test.ts` (server-only boundary), and
`components/layout/__tests__/Sidebar.test.tsx`. All use mocked RPC data — no production
access.

## Troubleshooting

- **Empty dropdown / "No REITs are available yet."** — the contract returned no issuers
  (no completed/current reports), or `REITS_SUPABASE_*` is unset/incorrect (the routes
  return a sanitized 502 rather than leaking detail; check server logs).
- **502 on every REIT call** — the target project is missing the engine's migration 0005
  RPCs, or the credentials point at the wrong project.
- **A report 404s after a revision** — a superseded version is not served; the UI falls
  back to the newest current report.
- **A legacy `/reits?report=<bare-uuid>` link** — still resolves (as ARR); new links use
  namespaced ids.
- **401 / session expired** — the page prompts to sign in again; the bearer token is
  taken from the Supabase session on each request.
