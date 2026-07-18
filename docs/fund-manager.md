# Fund Manager (chat.mmglobal.us)

The **Fund Manager** page (`/funds`, linked from the sidebar **Apps → Funds**)
compares fund holdings between two requested dates and classifies each position as
**Added / Removed / Increased / Decreased / Metadata Conflict**. It supports both
**JP Morgan** (par-based) and **Allspring** (market-value-based) managers.

All comparison logic lives in the poller's PostgreSQL RPCs (see the poller repo's
README, "Fund Manager position-change RPCs"). This app only authenticates the chat
user, validates inputs, calls those RPCs server-side, and renders the result.

## Comparison basis (PAR vs MARKET_VALUE)

Each row carries a `comparison_basis` of `PAR` or `MARKET_VALUE`, and a canonical
basis-aware pair `position_amount` / `position_change` (the values the table and CSV
always render). For PAR rows `position_*` mirror `par_*` (and `market_value_*` are
null); for MARKET_VALUE rows `position_*` mirror `market_value_*` (and `par_*` are
null). All amounts stay full-precision decimal **strings** end-to-end — never coerced
to a JS number — through the route, sorting, and CSV export.

The table derives a **mode** from the returned rows (or `fund_status`):

| Mode | When | Amount / Change headers | Basis column | Disclosure note |
|---|---|---|---|---|
| `par` | all rows PAR (or legacy) | Par Amount / Par Change | hidden | no |
| `market_value` | all rows MARKET_VALUE | Market Value / Market Value Change | hidden | **yes** |
| `mixed` | both bases present | Position Amount / Position Change | **shown** (Par / Market Value) | **yes** |

**Market-value disclosure** (shown near the table for `market_value` and `mixed`):
"Market value changes can reflect price movement, accrued interest, foreign exchange
effects, and portfolio activity. They do not necessarily represent purchases or
sales."

**Backward compatibility:** a legacy response lacking `position_*` is normalised
(`normalizePositionChangeRow`) to `position_amount = par_amount`,
`position_change = par_change`, `comparison_basis = PAR`. The fallback only fills
absent keys — it never overrides valid new fields.

**Null sectors / security types:** a null `sector_type` displays as **Unmapped**
(rows stay visible, sortable, filterable, paginated, exported, and counted); the
sector filter offers "Unmapped" only when `sector_has_null` is true, and selecting it
sends the token `__UNMAPPED__` to the RPC. The literal string "Unmapped" is never
sent or stored. A null `security_type` displays as an em dash (—) with no sector or
issuer substitution.

**Allspring fund dropdown:** each canonical portfolio appears once with a friendly
name (e.g. *Core Plus Bond*), share-class aliases (STYAX / WIPIX / WFIPX) shown as
secondary text and a tooltip. The share-class tickers are never separate options.

## Architecture

```
browser (/funds page, client)
   │  same-origin fetch, chat Supabase Bearer token
   ▼
/api/funds/* route handlers (server)  ── requireUser() gate (chat session)
   │  service-role key, server-only
   ▼
poller Supabase project  ── get_fund_position_changes() + option RPCs
```

The chat app and the poller run in **separate Supabase projects**. The routes reach
the poller project through a dedicated **server-only** client
(`lib/supabaseFunds.ts`); its URL and key are never exposed to the browser.

## Required server environment variables

| Variable | Purpose |
|---|---|
| `FUNDS_SUPABASE_URL` | Poller Supabase project URL (server-only, no `NEXT_PUBLIC_`). |
| `FUNDS_SUPABASE_SERVICE_ROLE_KEY` | Poller project service-role key (server-only). Used only by `/api/funds/*`. |
| `FUNDS_EXPORT_MAX_ROWS` | Optional. Max rows a single CSV export may return. Default `100000`. |

The existing chat Supabase variables (`NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) are unchanged and are
used only for chat auth and chat-owned data.

## Authorization

Every `/api/funds/*` route calls `requireUser(request)` — it verifies the caller's
chat Supabase access token (Bearer) with the chat project's service-role client. An
unauthenticated request gets `401` and never reaches the poller. There is no admin
gate: any approved chat user may view fund data (read-only). The poller service-role
key is used strictly server-side to call the read-only RPCs; browsers never receive
it and cannot write to holdings data.

## Routes added

| Route | Method | Backing RPC | Returns |
|---|---|---|---|
| `/api/funds/options` | GET | `get_fund_managers`, `get_funds`, `get_fund_latest_as_of_date` | `{ managers, funds, latestDate }` |
| `/api/funds/list?manager=` | GET | `get_funds` | `{ funds }` |
| `/api/funds/latest-date?manager=&fund=` | GET | `get_fund_latest_as_of_date` | `{ latestDate }` |
| `/api/funds/filter-options?manager=&fund=` | GET | `get_fund_filter_options` | `{ security_types, sector_types, sector_has_null }` |
| `/api/funds/changes?…` | GET | `get_fund_position_changes` | `{ changes, fund_status, pagination }` |
| `/api/funds/export?…` | GET | `get_fund_position_changes_export` | streamed `text/csv` |

`NULL` (omitted / `all` / empty) manager and fund mean "all"; never a magic string.

## URL parameter contract

The page stores all comparison state in the URL so refreshes and browser
back/forward work. The changes route reads the same names (minus `preset`):

| Param | Meaning |
|---|---|
| `manager`, `fund` | scope (`""`/absent = all) |
| `start`, `end` | requested dates, `YYYY-MM-DD` (any calendar date, incl. future) |
| `preset` | `1D` / `7D` / `30D` / `1Y` (UI hint only, not sent to the RPC) |
| `page` | 1-based page |
| `page_size` | one of `50, 100, 250, 500` (others rejected `400`) |
| `sort` | one of `security_id, description, security_type, sector_type, position_amount, position_change, par_amount, par_change, market_value_amount, market_value_change, change_type` (default `position_change`, abs-desc). The amount/change column headers map to `position_amount` / `position_change`; arbitrary UI labels are never used as sort keys. |
| `dir` | `asc` / `desc` |
| `q_security`, `q_description` | case-insensitive partial text filters (debounced 300 ms) |
| `f_security_type`, `f_sector_type` | exact dropdown filters; `f_sector_type=__UNMAPPED__` selects null-sector rows |
| `change_type` | comma-joined subset of the five change types |

Top controls (manager/fund/dates/preset) require **Submit** to execute; once a
comparison is submitted, filter/sort/pagination changes apply immediately and are
server-driven. No sensitive data is placed in the URL.

## CSV export

`/api/funds/export` streams every matching row (all funds/pages, including Metadata
Conflict and null-sector rows) with full `NUMERIC(38,10)` precision. If the result
exceeds `FUNDS_EXPORT_MAX_ROWS` the export is **blocked** up-front with a clear
message asking the user to narrow the query — never silently truncated. The response
is streamed in bounded chunks so neither the server nor the browser holds the whole
export in memory.

Headers are **basis-aware** (from a pre-flight probe): PAR-only uses `Par Amount` /
`Par Change`; MARKET_VALUE-only uses `Market Value` / `Market Value Change`; mixed
uses `Position Amount` / `Position Change` plus a `Comparison Basis` column
(`PAR`→Par, `MARKET_VALUE`→Market Value). Values always come from
`position_amount` / `position_change` as exact decimal strings (never floated). Null
sectors export as **Unmapped**; null security types export **blank** (matching the
existing `""` convention).

## Column / group persistence

Column order, visibility, and widths persist in `localStorage`
(`fundmgr:layout`); "Restore default layout" resets them. Collapsed fund-group
state is kept in React state for the session only (never persisted).

## Local development

```bash
cp .env.local.example .env.local   # fill in FUNDS_SUPABASE_URL + key
pnpm install
pnpm dev                           # http://localhost:3000/funds
```

Without `FUNDS_*` set, the `/api/funds/*` routes return a 502; the page renders but
shows a load error. Point `FUNDS_SUPABASE_URL`/`FUNDS_SUPABASE_SERVICE_ROLE_KEY` at
a poller project that has the `0004_comparison_basis` migration applied (adds the
basis-aware RPC contract: `comparison_basis`, `position_*`, `market_value_*`, and
`sector_has_null`).

## Tests

```bash
pnpm test        # vitest: lib/fundManager validation + formatting,
                 # /api/funds route auth/validation, and the /funds page
pnpm lint
pnpm build
```

## Deployment notes

The Docker image is built from this repo (`Dockerfile`); the deploy stack (compose
+ Cloudflare tunnel) lives in the external core-* stack. Add `FUNDS_SUPABASE_URL`,
`FUNDS_SUPABASE_SERVICE_ROLE_KEY`, and optionally `FUNDS_EXPORT_MAX_ROWS` to the
server environment there. These are **runtime server** vars (not build ARGs) and
must **not** be `NEXT_PUBLIC_` — they must never be inlined into the client bundle.
