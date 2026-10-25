# Fund Manager (chat.mmglobal.us)

The **Fund Manager** page (`/funds`, linked from the sidebar **Apps → Funds**)
compares fund holdings between two requested dates and classifies each position as
**Added / Removed / Increased / Decreased / Metadata Conflict**. It covers three
managers, each fed by its own poller into one shared schema:

| Manager | Funds | Source | Basis | Cadence |
|---|---|---|---|---|
| **JP Morgan** | 9 ETFs (JAGG … JSCP) | daily PDF | `PAR` | daily, one business day in arrears |
| **Allspring** | 6 portfolios (`AS_*`) | monthly HTML | `MARKET_VALUE` | month-end, ~3 weeks in arrears |
| **Regan** | `MBSF`, `MBSX` | daily CSV | `PAR` | MBSX same-day (forward-dated across weekends); MBSF a business day behind it |

The cadences differ *between and within* managers, and that is load-bearing for the
date semantics below — see `system-source-of-truth/docs/26-fund-pollers.md` §13.

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

## Date resolution

Every fund resolves its own window; there is no single date pair shared across funds.

- **Date mode** (Start + End typed). **Start is inclusive**: the comparison
  *baseline* is the newest accepted snapshot **strictly before** Start, so a holding
  added on the Start date shows as Added. End resolves to the newest snapshot **on or
  before** End. Future dates are allowed. (Migration `0009`; before it, Start resolved
  on-or-before too, so changes made on the Start date were invisible.)
- **Preset mode** (`1D` / `7D` / `30D` / `1Y`). No dates are sent. Each fund compares
  its newest snapshot against the one **N snapshots** earlier — 1 / 5 / 21 / 252
  (`PRESET_LOOKBACK` in `lib/fundManager.ts`, RPC argument `p_lookback`). Snapshots
  are trading days for these sources, so this is weekend-, holiday- and lag-aware
  without the browser carrying a market calendar. A fund with less history is
  clamped to its oldest snapshot. A preset wins over any stale `start`/`end` in the
  URL.

The resolved dates are shown per fund in the group header as
`baseline DD/MM/YY → DD/MM/YY`. A fund that cannot be compared gets a status —
`insufficient_history` (start and end resolved to the same snapshot),
`no_start_snapshot`, or `no_end_snapshot` — with a reason, shown above the table.

**Null sectors / security types:** a null `sector_type` displays as **Unmapped**
(rows stay visible, sortable, filterable, paginated, exported, and counted); the
sector filter offers "Unmapped" only when `sector_has_null` is true, and selecting it
sends the token `__UNMAPPED__` to the RPC. The literal string "Unmapped" is never
sent or stored. A null `security_type` displays as an em dash (—) with no sector or
issuer substitution. **Allspring and Regan publish no security-type column**, so every
one of their rows is `—` and the Security Type filter only narrows JP Morgan rows.
Their `sector_type` is derived conservatively from the security name and is often
Unmapped by design.

**Allspring fund dropdown:** each canonical portfolio appears once with a friendly
name (e.g. *Core Plus Bond*), share-class aliases (STYAX / WIPIX / WFIPX) shown as
secondary text and a tooltip. The share-class tickers are never separate options. JP Morgan and Regan funds show
their ticker as-is.

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
| `/api/funds/filter-options?manager=&fund=&start=&end=&preset=` | GET | `get_fund_filter_options` | `{ security_types, sector_types, sector_has_null }` |
| `/api/funds/changes?…` | GET | `get_fund_position_changes` | `{ changes, fund_status, pagination }` |
| `/api/funds/export?…` | GET | `get_fund_position_changes_export` | streamed `text/csv` |

`NULL` (omitted / `all` / empty) manager and fund mean "all"; never a magic string.

`filter-options` is scoped to the **two snapshots per fund actually being compared**
(same date/preset resolution as the table). Unscoped, the RPC walks all of history —
38.5 s for JP Morgan in production on 2026-09-14 — and offers values that cannot
appear in the result. The page fetches it alongside the table, not before it.

`fund_status[]` carries, per fund: `comparison_basis`, `requested_*` and `actual_*`
dates, `status`, `resolution_mode` (`date` / `lookback`), `matching_row_count`,
`warning_count` and `reason`. In lookback mode `requested_*` echoes the resolved
dates, because the request *is* "this fund's Nth previous snapshot".

## URL parameter contract

The page stores all comparison state in the URL so refreshes and browser
back/forward work. The changes and export routes read the same names:

| Param | Meaning |
|---|---|
| `manager`, `fund` | scope (`""`/absent = all) |
| `start`, `end` | requested dates, `YYYY-MM-DD` (any calendar date, incl. future); Start inclusive |
| `preset` | `1D` / `7D` / `30D` / `1Y` → `p_lookback` 1 / 5 / 21 / 252 snapshots per fund. Replaces `start`/`end` (the page clears them); unknown values are rejected `400` |
| `page` | 1-based page |
| `page_size` | one of `50, 100, 250, 500` (others rejected `400`) |
| `sort` | one of `security_id, description, security_type, sector_type, position_amount, position_change, par_amount, par_change, market_value_amount, market_value_change, change_type` (default `position_change`, abs-desc). The amount/change column headers map to `position_amount` / `position_change`; arbitrary UI labels are never used as sort keys. Rows are always ordered by fund first and Metadata Conflict rows last within a fund; the sort applies inside that. |
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

Filenames: `fund-position-changes_<start>_<end>.csv` in date mode, and
`fund-position-changes_<preset>.csv` in preset mode, since there is no single date
window to name. (The route's own `Content-Disposition` says `last-N-sessions`, but the
page sets the download name itself, so that is what a browser user sees.)

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
a poller project migrated to **`0009_inclusive_start`** (the
`jp-fund-pdf-poller` repo owns every migration). `0004` added the basis-aware
contract (`comparison_basis`, `position_*`, `market_value_*`, `sector_has_null`);
`0009` changed five RPC signatures to add `p_lookback` and the date-scoped
`get_fund_filter_options`. Against a pre-`0009` database the **whole table** fails
(the changes and export routes always send `p_lookback`, null in date mode) and the
filter dropdowns silently come back empty, because PostgREST finds no function with
those argument names.

**Before changing an RPC signature**, exercise every consumer of the shared schema,
not just this page: the JP, Allspring and Regan repos' integration tests also encode
the RPC contract (doc 26 §13: one Allspring test still assumed the pre-`0009` Start
convention and had not been re-run).

## Tests

```bash
pnpm test        # vitest: lib/fundManager validation + formatting,
                 # /api/funds route auth/validation, and the /funds page
pnpm lint
pnpm build
```

## Deployment notes

The Docker image is built from this repo (`Dockerfile`) and deployed with the rest of
the stack in `~/projects/docker-compose.yml` (see
`system-source-of-truth/docs/12-deployment-and-rollback.md`). `FUNDS_SUPABASE_URL`,
`FUNDS_SUPABASE_SERVICE_ROLE_KEY` (credential S-21; rotation in
`docs/funds-credential-rotation.md`) and optionally `FUNDS_EXPORT_MAX_ROWS` live in
`~/projects/.env`. These are **runtime server** vars (not build ARGs) and
must **not** be `NEXT_PUBLIC_` — they must never be inlined into the client bundle.
