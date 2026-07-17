# Fund Manager (chat.mmglobal.us)

The **Fund Manager** page (`/funds`, linked from the sidebar **Apps → Funds**)
compares JP Morgan fund holdings between two requested dates and classifies each
position as **Added / Removed / Increased / Decreased / Metadata Conflict**.

All comparison logic lives in the poller's PostgreSQL RPCs (see the poller repo's
README, "Fund Manager position-change RPCs"). This app only authenticates the chat
user, validates inputs, calls those RPCs server-side, and renders the result.

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
| `/api/funds/filter-options?manager=&fund=` | GET | `get_fund_filter_options` | `{ security_types, sector_types }` |
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
| `sort` | one of `security_id, description, security_type, sector_type, par_amount, par_change, change_type` |
| `dir` | `asc` / `desc` |
| `q_security`, `q_description` | case-insensitive partial text filters (debounced 300 ms) |
| `f_security_type`, `f_sector_type` | exact dropdown filters |
| `change_type` | comma-joined subset of the five change types |

Top controls (manager/fund/dates/preset) require **Submit** to execute; once a
comparison is submitted, filter/sort/pagination changes apply immediately and are
server-driven. No sensitive data is placed in the URL.

## CSV export

`/api/funds/export` streams every matching row (all funds/pages, including Metadata
Conflict rows) with full `NUMERIC(38,10)` precision. If the result exceeds
`FUNDS_EXPORT_MAX_ROWS` the export is **blocked** up-front with a clear message
asking the user to narrow the query — never silently truncated. The response is
streamed in bounded chunks so neither the server nor the browser holds the whole
export in memory.

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
a poller project that has the `0003_position_changes_rpc` migration applied.

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
