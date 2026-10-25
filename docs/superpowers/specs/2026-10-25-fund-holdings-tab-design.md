# Fund Manager: current-holdings tab — design

*2026-10-25. Status: **approved by the owner 2026-10-25.***

## Why

The Fund Manager page (`/funds`) answers "what changed between two dates". The owner
also wants to see **what each fund holds right now**, and to spot at a glance **which
bonds were recently added or had their par changed** — without having to guess a date
range first.

## What it is

A **Holdings** tab on the existing `/funds` page, next to today's view (which becomes
the **Changes** tab). It lists every current holding across all funds/managers as one
list, with the same columns as the Changes table except that the change amount is
replaced by **Last Change**: the date the bond was added or its par last moved.

### Owner decisions (as stated)

- It is a **tab on `/funds`**, not a separate page.
- **Columns:** the Changes table's columns, minus the change column, plus Last Change.
- **Last Change** = the date the bond was **recently added or had its par changed**.
- **Allspring** (market value only, no par): Last Change shows **only when it was added**.
- A **"Changed" filter** (any time / last day / last week / last month) is wanted.
- **Default order: most recent change first, as ONE list across all funds** — not
  grouped by fund. (Chosen after review showed grouping would bury a later fund's
  change several pages down in the All Managers view.)
- **Mortgage paydowns are not changes:** a par **decrease of 5% or less** is treated as
  a paydown; added, any increase, and decreases over 5% count. (Option "b" of three; the
  owner accepted that this is a rule of thumb that will occasionally misfile a small sale
  or a large paydown.)

## The data, and what "last change" means

Each fund's *current* holdings are the rows of its **latest accepted snapshot**
(`is_current AND snapshot_status = 'accepted'`, newest `as_of_date`) — the same snapshot
the Changes tab's "end" resolves to with a 1D preset. Funds have different latest dates
(production 2026-10-25: JP 10-23, MBSF 10-23, MBSX 10-26, Allspring 09-30), so every
row must show its fund's own as-of date.

Scale today: ~20,500 current holdings (JP 16,320 · Allspring 3,580 · Regan 591) out of
1.17M holdings rows across 727 snapshots. History starts JP 07-15, Allspring 06-30,
Regan 09-01; JP has two all-fund gap days (08-11, 08-13).

**Definition** (per fund, per `security_id`; duplicate rows in one snapshot are summed,
as the Changes RPC already does):

- Walk the fund's snapshots in `as_of_date` order. The bond's **current run** began at
  the most recent snapshot where it was **absent from the previous snapshot** (→
  **Added**) or, for PAR-basis funds, where its **summed par differs from the previous
  snapshot's** in a way that counts (→ **Par ↑** / **Par ↓**):
  - any **increase** counts;
  - a **decrease counts only if it exceeds 5%** of the previous snapshot's par
    (`(prev − cur) / prev > 0.05`). A decrease of 5% or less is a **paydown** and does
    **not** start a new run, so the bond keeps its earlier Last Change.
  - The comparison is snapshot-to-snapshot, so a string of small monthly paydowns never
    adds up to a change. *(designer's reading of "b")*
  - Why: on factor dates (≈ the 7th–8th; 08-07, 09-08, 10-07) 22–61% of holdings in
    JMTG, MBSF, MBSX, JAGG and JBND changed par in one snapshot, almost all small drops
    (measured on production 2026-10-25). Counting them would date most mortgage holdings
    to the latest factor date.
  - Applies to **every** PAR-basis bond, not only mortgage sectors — sector mapping is
    incomplete (Regan rows are often Unmapped), so a sector-based rule would misfire
    quietly. Known cost: a ≤5% sale of a non-amortizing bond (e.g. a Treasury) is not
    shown. *(designer's call)*
  - The 5% threshold is a named constant in one place (SQL + documented), not scattered.
- **Last Change** = that snapshot's `as_of_date`, plus the kind (Added / Par ↑ / Par ↓).
- **MARKET_VALUE-basis funds (Allspring):** only presence counts; the kind is always
  Added. Market value moving month to month is *not* a change.
- A bond whose current run began at the fund's **first** snapshot has no knowable change
  date: show **"unchanged since DD/MM/YY"** (PAR) / **"held since DD/MM/YY"** (MV), using
  the first snapshot date, styled muted. Never invent a date. *(builder's call that it
  reads this way; the principle is the owner's)*
- A bond sold and later re-bought counts the re-buy as **Added**. *(designer's call)*
- Only description/type/sector changes do **not** count as a change. *(designer's call;
  matches "added or par changed")*
- Gap days are not special: a change that happened during a gap is dated to the first
  snapshot after it, which is what the data can support.
- **Partial snapshots** need no special case: all 727 accepted snapshots on production
  are `quality_status = 'complete'` (checked 2026-10-25). They are walked like any other,
  exactly as the Changes tab uses them. *(designer's call)*
- **Conflicting duplicate rows** in the latest snapshot (rows for one `security_id` that
  disagree on description / security type / sector) display like Changes: the value with
  the same warning marker, sector shown as "Conflicting". Not a change in itself.
  *(designer's call)*

## The screen

- **Tabs** "Changes | Holdings" at the top of the controls area. The tab is in the URL
  (e.g. `tab=holdings`) so refresh/back/forward and shared links work, like every other
  piece of `/funds` state today.
- **Shared state** between tabs is the **URL's** `manager` and `fund`. Holdings has **no
  dates, presets or Submit button**: it always shows each fund's latest snapshot, and a
  picker change on Holdings writes the URL and loads immediately. Changes keeps its
  Submit model unchanged: it runs only when the URL carries `start`+`end` or `preset`, so
  switching to Changes after narrowing on Holdings re-runs an existing comparison in the
  new scope, or shows "press Submit" if there was none. Unsubmitted edits on Changes do
  not carry over. *(designer's call, settling review Q3)*
- **One list, not grouped** (owner). The **Fund** column carries the fund (Allspring by
  friendly name with share-class aliases as a tooltip, as today), and an **As of** column
  shows that fund's latest snapshot date on every row, because funds' latest dates differ
  and there are no group headers to carry it. *(As-of column: designer's call)*
- **Columns:** Fund · As of · CUSIP / Security ID · Description · Security Type · Sector
  Type · amount · **Last Change** (date + Added / Par ↑ / Par ↓ tag). The amount header is
  basis-aware exactly as on Changes (Par Amount / Market Value / Position Amount, with the
  Basis column only for mixed results). Null sector → "Unmapped", null security type → "—",
  as today.
- **Filters:** CUSIP / description search, Security Type and Sector Type dropdowns (scoped
  to the holdings in view), and **Changed:** any time (default) / last day / last week /
  last month.
- **"Changed" counts trading sessions per fund, not calendar days** — last day = the
  change happened in the fund's latest snapshot; last week = within its last 5 snapshots;
  last month = within its last 21 — the same 1 / 5 / 21 counts as the Changes presets, for
  the same reason (funds publish on different lags; a calendar window would hide a slow
  publisher's changes). Consequence to accept: for monthly Allspring, "last day" means
  "added in the latest month". *(designer's call)*
- **Default sort:** **Last Change newest first across all funds** (owner), ties by amount
  descending then fund then security id; "unchanged since…" / "held since…" rows last.
  Column headers re-sort, server-side, as on Changes.
- **Carried over from Changes** *(designer's calls)*: column show/hide/reorder/width
  persistence (its own `localStorage` key so the two tabs don't fight), paging
  (50/100/250/500), and a **CSV export** of everything matching, with exact decimal
  strings.

## Constraints

- **Performance.** Computing Last Change from history on each request was measured on
  production 2026-10-25: **12.7 s**, a window over all 1.17M holdings rows spilling 64 MB to
  disk, and it grows ~16k rows/day. The Changes tab's table answers in ~0.65 s. **The
  Holdings tab must load within ~1 s for all managers**, so last-change data must be
  **precomputed**, not derived per request.
- **Never disagree with the Changes tab.** Holdings must show the same latest snapshot per
  fund that the Changes tab resolves to. If the precomputed data can lag ingestion, the
  tab must say so (or fall back), never silently show an older snapshot as current.
- **Corrections must flow through.** History is not append-only in practice: material
  revisions supersede a snapshot version, and an `as_of_date` has been corrected by hand
  (JMTG, 2026-09-08). Precomputed last-change data must be correct after either, without
  a manual step someone will forget.
- **Three writers.** JP, Allspring and Regan pollers all write the shared schema; only the
  JP repo owns migrations. A mechanism that requires changing all three pollers' write
  paths has three times the surface and three test suites that encode the contract
  (doc 26 §13: *exercise every consumer of the shared schema*).
- **Security (R-27).** Any new function is `SECURITY DEFINER` reading forced-RLS tables:
  `REVOKE ALL … FROM PUBLIC, anon, authenticated`, `GRANT EXECUTE … TO service_role` only.
  Any new table: RLS enabled and forced, no anon/authenticated grants. The new API route
  calls `requireUser` (the structural test in `app/api/__tests__/authGate.test.ts` fails
  otherwise).
- **Decimals stay strings** end to end (NUMERIC(38,10)), as on Changes.
- **Mobile:** follows `core-chat/CLAUDE.md` (no `vh`, safe areas, ≥44pt targets).

## Left to the builder

- **How last-change data is kept precomputed.** Options seen, none chosen: a derived table
  maintained by a deferred trigger on snapshot commit (one place, all three writers covered,
  must handle supersede/relabel); a derived table rebuilt by a refresh function the RPC or a
  timer calls (full rebuild ~13 s today, so incremental per fund is likely needed); or a
  column on `fund_holdings` filled at insert (touches all three pollers). Choose against the
  constraints above, and measure.
- RPC shape and names, API route shape, URL param names, component structure, and test
  layout — following the existing Changes-tab patterns (`lib/fundManager.ts` contract,
  `app/api/funds/*`, JP `alembic/versions/`).
- Exact empty / loading / error states.

## Out of scope

- Holdings history or charts per bond; any change to the Changes tab's behaviour beyond
  adding the tab switcher; anything about Allspring market-value movement.

## Docs to update when built

`core-chat/docs/fund-manager.md`, `system-source-of-truth` docs 05 (RPC contract), 07
(migration chain / any new table), 26 if pollers change, 19 (deployed versions).
