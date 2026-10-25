# Fund Manager Holdings Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Holdings tab on `/funds` listing every fund's current holdings in one list, newest change first, with a Last Change date (added / par moved beyond a paydown) and a session-counted "Changed" filter.

**Architecture:** Last-change data is precomputed into a derived table in the shared funds schema, recomputed per fund by a deferred constraint trigger on `fund_snapshots` at commit — so all three pollers, material revisions and hand corrections are covered with no poller code change, and a refresh failure is caught, recorded as stale, and never rolls back an ingest. Read RPCs join each fund's latest snapshot to that table; the chat app adds three auth-gated routes and a `HoldingsTab` component behind a `tab=holdings` URL param.

**Tech Stack:** PostgreSQL (Supabase) via Alembic in `jp-fund-pdf-poller`; pytest integration tests (`docker-compose.test.yml`, port 55432). Next.js 15 / React 19 / TypeScript strict / Vitest in `core-chat`.

**Spec:** `core-chat/docs/superpowers/specs/2026-10-25-fund-holdings-tab-design.md` (approved 2026-10-25).

## Global Constraints

- Paydown threshold: a par decrease counts only if `(prev − cur) / prev > 0.05`; one named constant, in one place (the refresh function).
- Comparison is snapshot-to-snapshot within one fund, by `security_id`, duplicate rows summed.
- MARKET_VALUE funds: only presence counts; kind is always Added.
- A run that began at the fund's first snapshot is `since_first` — never given an invented date.
- Holdings tab loads in ≤ ~1 s for All Managers (measure on production after deploy).
- Holdings must never show a different latest snapshot than the Changes tab; lag is surfaced as `stale`, never hidden.
- New SECURITY DEFINER functions: `REVOKE ALL … FROM PUBLIC, anon, authenticated`; `GRANT EXECUTE … TO service_role` only. New tables: RLS enabled + forced, no anon/authenticated grants.
- Every new `app/api/**/route.ts` handler calls `requireUser` (enforced by `app/api/__tests__/authGate.test.ts`).
- Decimals are strings end to end (NUMERIC(38,10) → `::text` → never `Number()`).
- "Changed" = per-fund sessions: `1D`→1, `7D`→5, `30D`→21 (reuse `PRESET_LOOKBACK`).
- Default sort: last change newest first across all funds; ties amount desc, then fund, then security id; `since_first` rows last.
- Mobile rules in `core-chat/CLAUDE.md` (no `vh`, safe areas, ≥44pt on coarse pointers).

## Review Focus

1. **A refresh bug must not block ingestion.** JP serves each day once; a trigger that raises at commit would roll back an irreplaceable snapshot. → Task 1 test `test_refresh_failure_does_not_roll_back_the_ingest`.
2. **Same-date revision and hand relabel.** A superseded version or an edited `as_of_date` must change Last Change without anyone re-running anything. → Task 1 tests `test_material_revision_recomputes`, `test_hand_relabel_of_as_of_date_recomputes`.
3. **Exactly 5% is a paydown, and paydowns don't accumulate.** Boundary and a string of 4% drops. → Task 1 `test_exactly_five_percent_is_a_paydown`, `test_successive_small_paydowns_never_count`.
4. **Stale is visible.** If the derived data reflects an older snapshot than the fund's latest, the UI says so rather than presenting it as current. → Task 2 `test_stale_fund_is_flagged`; Task 5 `shows a stale notice for a fund whose last-change data is behind`.
5. **Tabs don't clobber each other's URL state.** Holdings params are `h_`-prefixed; switching tabs keeps `manager`/`fund` and the other tab's params. → Task 5 `switching tabs keeps manager and fund and the Changes query`.

---

### Task 1: Derived last-change table, refresh, and commit trigger (migration 0012)

**Repo:** `~/projects/jp-fund-pdf-poller`

**Files:**
- Create: `alembic/versions/0012_holdings_last_change.py`
- Test: `tests/integration/test_holdings_last_change.py`
- Modify: `tests/integration/conftest.py` (`clean_dynamic_tables` TRUNCATE list gains `fund_last_change, fund_last_change_state` — CASCADE from `fund_snapshots` already covers them via FK, add explicitly anyway)

**Interfaces:**
- Produces (SQL, all `public`):
  - Table `fund_last_change(fund_id uuid FK funds, security_id text, last_change_date date NOT NULL, last_change_kind text NULL CHECK IN ('added','par_increased','par_decreased'), since_first boolean NOT NULL, reflects_snapshot_id uuid NOT NULL FK fund_snapshots(id) ON DELETE CASCADE, PRIMARY KEY (fund_id, security_id))`. `since_first` rows carry `last_change_date` = the fund's first snapshot date and `last_change_kind` NULL.
  - Table `fund_last_change_state(fund_id uuid PK FK funds, reflects_snapshot_id uuid NULL FK fund_snapshots ON DELETE SET NULL, refreshed_at timestamptz NOT NULL, last_error text NULL)`.
  - `fm_refresh_last_change(p_fund_id uuid) RETURNS integer` — SECURITY DEFINER; deletes and recomputes that fund's rows from its full live history (`is_current AND snapshot_status='accepted'`), sets state `reflects_snapshot_id` = fund's latest live snapshot, `last_error` NULL; returns rows written.
  - `fm_refresh_last_change_all() RETURNS integer` — loops all funds.
  - Trigger function `fm_last_change_on_snapshot()` and `CREATE CONSTRAINT TRIGGER trg_fund_last_change AFTER INSERT OR UPDATE OR DELETE ON fund_snapshots DEFERRABLE INITIALLY DEFERRED FOR EACH ROW`. Body: `BEGIN PERFORM fm_refresh_last_change(fund_id) EXCEPTION WHEN OTHERS THEN` upsert `fund_last_change_state.last_error = SQLERRM` and `RAISE WARNING`; never re-raise. Refresh `NEW.fund_id` on INSERT/UPDATE and `OLD.fund_id` on DELETE; on UPDATE where fund_id changed, refresh both. A supersede (UPDATE old + INSERT new) refreshes the same fund twice at commit — accepted; it is rare.

- [ ] **Step 1: Write the failing tests** (reuse `insert_snapshot`/`Holding` from `test_position_changes_rpc.py` and `H`/`insert_snapshot` from `test_comparison_basis.py` for MV; read results with `SELECT ... FROM fund_last_change WHERE fund_id = …`). Dates D1..D6 = 2026-06-01..06.
  - `test_added_on_first_appearance_after_the_first_snapshot` — JBND D1 {A}, D2 {A,B} → B: (D2, 'added', since_first false).
  - `test_present_since_first_snapshot_is_since_first` — A above: since_first true, kind NULL, date D1.
  - `test_par_increase_counts` — D1 A=100, D2 A=101 → (D2,'par_increased').
  - `test_decrease_over_five_percent_counts` — 100→94 → (D2,'par_decreased').
  - `test_exactly_five_percent_is_a_paydown` — 100→95 → since_first, D1.
  - `test_successive_small_paydowns_never_count` — 100→96→92.16→88.47 over D1..D4 → since_first.
  - `test_paydown_after_a_real_change_keeps_the_real_change_date` — D1 100, D2 200 (increase), D3 195 → (D2,'par_increased').
  - `test_rebuy_counts_as_added` — D1 {A}, D2 {}, D3 {A} → (D3,'added').
  - `test_duplicate_rows_are_summed` — D1 A=50+50, D2 A=100 → since_first.
  - `test_market_value_fund_counts_presence_only` — AS_CORE_PLUS D1 A mv=100, D2 A mv=300, B mv=5 → A since_first; B (D2,'added').
  - `test_material_revision_recomputes` — D1 A=100, D2 A=100; then supersede D2 (prior `snapshot_status='superseded', is_current=false`) and insert D2 v2 A=150 in one transaction → (D2,'par_increased').
  - `test_hand_relabel_of_as_of_date_recomputes` — D1, D2 (B added), then `UPDATE fund_snapshots SET as_of_date = D3 WHERE id = <D2>` → B (D3,'added').
  - `test_state_reflects_the_latest_snapshot` — after inserts, `fund_last_change_state.reflects_snapshot_id` = id of the newest live snapshot, `last_error` NULL.
  - `test_refresh_failure_does_not_roll_back_the_ingest` — `ALTER TABLE fund_last_change RENAME TO fund_last_change_broken`; insert a snapshot (commits); assert the snapshot row exists and `fund_last_change_state.last_error` is not NULL; rename back in `finally`.
  - `test_refresh_all_rebuilds_from_scratch` — `DELETE FROM fund_last_change`; `SELECT fm_refresh_last_change_all()` returns the row count and restores rows.

- [ ] **Step 2: Run to verify they fail**
  Run: `uv run pytest tests/integration/test_holdings_last_change.py -q`
  Expected: FAIL — `relation "fund_last_change" does not exist`.

- [ ] **Step 3: Write migration `0012_holdings_last_change`** (revision id ≤32 chars, e.g. `0012_holdings_last_change`; down_revision `0011_read_performance`). Upgrade: create both tables (RLS enable+force on both), the two functions, trigger function, constraint trigger, revoke/grant per Global Constraints (functions: service_role only; trigger function needs no grants), then `SELECT fm_refresh_last_change_all()` as the backfill. Downgrade: drop trigger, functions, tables. The refresh algorithm (one fund):

```sql
-- v: one value per (snapshot seq, security). PAR -> summed par; MARKET_VALUE -> 0 (presence only)
-- w: lag(seq), lag(val) over (security order by seq)
-- a row STARTS a run when: prev_seq IS NULL OR prev_seq <> seq-1          -> 'added'
--                          OR (PAR AND val > prev_val)                    -> 'par_increased'
--                          OR (PAR AND (prev_val - val) / NULLIF(prev_val,0) > c_paydown) -> 'par_decreased'
-- keep, per security present in the LATEST snapshot, its latest run start;
-- since_first := run start seq = 1 (then kind NULL, date = first snapshot date)
```
  `c_paydown CONSTANT numeric := 0.05;` declared once in `fm_refresh_last_change`. A `prev_val` of 0 with a positive `val` is an increase; a negative-par line (cash, shorts) uses `abs(prev_val)` in the denominator.

- [ ] **Step 4: Run to verify they pass**, then the whole JP suite and both sibling suites (they migrate to head and write snapshots, so they exercise the trigger):
  Run: `uv run pytest -q && (cd ../regan-fund-poller && uv run pytest tests/integration -q) && (cd ../allspring-fund-poller && uv run pytest tests/integration -q)`
  Expected: all pass. Then `uv run ruff check . && uv run ruff format --check . && uv run mypy src`.

- [ ] **Step 5: Commit** on branch `feat/holdings-last-change`: `feat(db): 0012 derived last-change table maintained by a deferred snapshot trigger`.

---

### Task 2: Holdings read RPCs (migration 0013)

**Repo:** `~/projects/jp-fund-pdf-poller`

**Files:**
- Create: `alembic/versions/0013_holdings_rpcs.py`
- Test: `tests/integration/test_holdings_rpc.py`
- Modify: `tests/integration/test_rpc_grants.py` (entry points 7 → 10)

**Interfaces:**
- Consumes: `fund_last_change`, `fund_last_change_state` (Task 1).
- Produces (all SECURITY DEFINER, service_role only):
  - `get_fund_holdings(p_manager text DEFAULT NULL, p_fund text DEFAULT NULL, p_page integer DEFAULT 1, p_page_size integer DEFAULT 100, p_sort_column text DEFAULT 'last_change', p_sort_direction text DEFAULT 'desc', p_security_id_search text DEFAULT NULL, p_description_search text DEFAULT NULL, p_security_type text DEFAULT NULL, p_sector_type text DEFAULT NULL, p_changed_within integer DEFAULT NULL) RETURNS jsonb` → `{holdings: Row[], fund_status: Status[], pagination: {page, page_size, total_rows, total_pages}}`.
  - Row keys: `fund_manager, fund_ticker, as_of_date, comparison_basis, security_id, description, security_type, sector_type, position_amount (text), last_change_date, last_change_kind ('added'|'par_increased'|'par_decreased'|null), since_first (bool), metadata_conflict (bool), conflict_fields (text[]), conflict_reason (text|null)`.
  - Status keys: `fund_manager, fund_ticker, comparison_basis, as_of_date, holding_count, stale (bool), last_error (text|null)`. `stale` = state row missing OR `reflects_snapshot_id` ≠ fund's latest live snapshot id OR `last_error` not null.
  - `get_fund_holdings_export_json(same filter params minus page/sort, p_max_rows integer DEFAULT 100000) RETURNS jsonb` → `{total_rows, rows}`; raises `export_limit_exceeded` before building rows (0011 pattern).
  - `get_fund_holdings_filter_options(p_manager text DEFAULT NULL, p_fund text DEFAULT NULL) RETURNS jsonb` → `{security_types, sector_types, sector_has_null}` over latest snapshots only.
  - Sort whitelist: `last_change, fund_ticker, as_of_date, security_id, description, security_type, sector_type, position_amount`. Validation errors use SQLSTATE 22023 with the existing tokens (`invalid_page_size`, `invalid_sort_column`, `invalid_sort_direction`) plus `invalid_changed_within`.
  - Rows come from each fund's latest live snapshot, aggregated per security exactly as `fm_position_changes_core` does (sums, min<>max conflict detection, sector "Conflicting" when sectors disagree), left-joined to `fund_last_change`. `p_changed_within = N` keeps rows with `NOT since_first AND last_change_date >= <as_of of that fund's Nth-newest live snapshot>`. `p_sector_type = '__UNMAPPED__'` selects null sector.

- [ ] **Step 1: Write the failing tests**
  - `test_one_list_newest_change_first_across_funds` — JBND change on D3, JCPB change on D2, MBSX change on D4 → order MBSX, JBND, JCPB by `last_change_date`; `since_first` rows after all dated rows.
  - `test_ties_break_by_amount_then_fund_then_security`.
  - `test_amount_is_basis_aware` — PAR row `position_amount` = summed par as text `"100.0000000000"`; MV row = summed market value.
  - `test_each_row_carries_its_funds_as_of_date` — JBND latest D3, AS_CORE_PLUS latest D2 → rows show their own.
  - `test_changed_within_counts_sessions_per_fund` — fund A snapshots D1..D6 with a change at D2; fund B snapshots D1, D2 only with a change at D2: `p_changed_within=1` keeps B's D2 change, drops A's; `=5` keeps both.
  - `test_filters_search_type_sector_and_unmapped`.
  - `test_pagination_totals` and `test_invalid_sort_and_page_size_rejected`.
  - `test_stale_fund_is_flagged` — set `fund_last_change_state.reflects_snapshot_id` to an older snapshot → that fund's status `stale` true; others false.
  - `test_export_json_matches_paged_rows_and_blocks_over_limit`.
  - `test_filter_options_cover_latest_snapshots_only` — a type present only in an older snapshot is not offered.
  - grants: in `test_rpc_grants.py` set `len(entry_points) == 10`.

- [ ] **Step 2: Run to verify they fail** — `uv run pytest tests/integration/test_holdings_rpc.py tests/integration/test_rpc_grants.py -q` → FAIL, `function get_fund_holdings ... does not exist`.

- [ ] **Step 3: Write migration `0013_holdings_rpcs`** (down_revision `0012_holdings_last_change`) with the three functions and grants. Downgrade drops them.

- [ ] **Step 4: Run full JP + sibling suites + lint/mypy** (as Task 1 Step 4). Expected: all pass.

- [ ] **Step 5: Commit**: `feat(db): 0013 holdings read RPCs (one list, newest change first)`.

---

### Task 3: Holdings contract and validation (`lib/fundHoldings.ts`)

**Repo:** `~/projects/core-chat`

**Files:**
- Create: `lib/fundHoldings.ts`
- Test: `lib/__tests__/fundHoldings.test.ts`

**Interfaces:**
- Consumes: from `lib/fundManager.ts` — `ALLOWED_PAGE_SIZES`, `DEFAULT_PAGE_SIZE`, `PRESET_LOOKBACK`, `ComparisonBasis`, `exportMaxRows`, `ValidationResult`, `UNMAPPED_TOKEN`.
- Produces:
  - `HOLDINGS_SORT_COLUMNS = ["last_change","fund_ticker","as_of_date","security_id","description","security_type","sector_type","position_amount"] as const`; `HoldingsSortColumn`; `DEFAULT_HOLDINGS_SORT: HoldingsSortColumn = "last_change"`.
  - `type LastChangeKind = "added" | "par_increased" | "par_decreased"`.
  - `type HoldingRow` and `type HoldingsFundStatus` with exactly Task 2's keys; `type HoldingsResponse = { holdings: HoldingRow[]; fund_status: HoldingsFundStatus[]; pagination: Pagination }` (`Pagination` re-exported from `fundManager`).
  - `type HoldingsRpcArgs` = Task 2 `get_fund_holdings` params.
  - `validateHoldingsQuery(sp: URLSearchParams): ValidationResult<HoldingsRpcArgs>` reading `manager, fund, h_page, h_page_size, h_sort, h_dir, h_q_security, h_q_description, h_f_security_type, h_f_sector_type, changed` (`changed` ∈ `1D|7D|30D` → `p_changed_within` via `PRESET_LOOKBACK`; absent → null; anything else → error `invalid_changed: …`).
  - `validateHoldingsExportQuery(sp)` → same minus page/sort plus `p_max_rows: exportMaxRows()`.
  - `formatLastChange(row: Pick<HoldingRow,"last_change_date"|"last_change_kind"|"since_first"|"comparison_basis">): { date: string; tag: "Added"|"Par ↑"|"Par ↓"|null; muted: boolean; text: string }` — `since_first` → muted, text `unchanged since DD/MM/YY` (PAR) / `held since DD/MM/YY` (MARKET_VALUE), tag null. Dates render `DD/MM/YY` like `fmtDMY` on the Changes tab.

- [ ] **Step 1: Write the failing tests** — sort whitelist rejects `position_change`; `changed=7D` → `p_changed_within: 5`; `changed=2D` → error; `h_page_size=75` → error; `manager=all` → null; `formatLastChange` for each kind and both since_first variants (`"unchanged since 15/07/26"`, `"held since 30/06/26"`).
- [ ] **Step 2:** `pnpm vitest run lib/__tests__/fundHoldings.test.ts` → FAIL (module not found).
- [ ] **Step 3:** Implement `lib/fundHoldings.ts`.
- [ ] **Step 4:** `pnpm vitest run lib/__tests__/fundHoldings.test.ts && npx tsc --noEmit` → PASS.
- [ ] **Step 5: Commit** on branch `feat/holdings-tab`: `feat(funds): holdings contract and query validation`.

---

### Task 4: Holdings API routes

**Repo:** `~/projects/core-chat`

**Files:**
- Create: `app/api/funds/holdings/route.ts`, `app/api/funds/holdings/export/route.ts`, `app/api/funds/holdings/filter-options/route.ts`
- Test: `app/api/funds/__tests__/holdings.test.ts`

**Interfaces:**
- Consumes: Task 3 validators/types; `requireUser` (`lib/reqUser.ts`); `callRpc` (`lib/fundsRpc.ts`); CSV helpers as in `app/api/funds/export/route.ts`.
- Produces:
  - `GET /api/funds/holdings?…` → `HoldingsResponse` from `get_fund_holdings`.
  - `GET /api/funds/holdings/filter-options?manager=&fund=` → `{security_types, sector_types, sector_has_null}`.
  - `GET /api/funds/holdings/export?…` → `text/csv`, filename `fund-holdings_<YYYY-MM-DD>.csv` (today, server time). Columns: `Fund, As Of, CUSIP / Security ID, Description, Security Type, Sector Type, <Par Amount|Market Value|Position Amount>, [Comparison Basis if mixed], Last Change, Last Change Type, Metadata Conflict, Conflict Fields, Conflict Reason`. `Last Change` = ISO date; `Last Change Type` = `Added|Par Increased|Par Decreased|Unchanged since first record|Held since first record`. Null sector → `Unmapped`; null type → blank. One RPC call (`get_fund_holdings_export_json`), streamed in 1,000-row chunks (same shape as the Changes export).
  - `mapRpcError` gains `invalid_changed_within` in `CLIENT_ERROR_TOKENS` (`lib/fundsRpc.ts`).

- [ ] **Step 1: Write the failing tests** — each route 401s without a session and makes no RPC call; holdings forwards validated args (`p_changed_within: 21` for `changed=30D`, `p_sort_column: "last_change"` default); export makes exactly one RPC call, PAR headers for PAR-only rows, a Basis column for mixed, `Unmapped` for null sector, exact decimal strings, `Unchanged since first record` for since_first, 400 on `export_limit_exceeded`. (The structural test in `app/api/__tests__/authGate.test.ts` picks up the new files automatically.)
- [ ] **Step 2:** `pnpm vitest run app/api/funds/__tests__/holdings.test.ts` → FAIL.
- [ ] **Step 3:** Implement the three routes.
- [ ] **Step 4:** `pnpm vitest run && npx tsc --noEmit` → all pass (authGate structural test included).
- [ ] **Step 5: Commit**: `feat(funds): holdings, holdings export and holdings filter-option routes`.

---

### Task 5: Holdings tab UI

**Repo:** `~/projects/core-chat`

**Files:**
- Create: `app/funds/HoldingsTab.tsx`
- Modify: `app/funds/page.tsx` (tab switcher; render existing Changes UI or `HoldingsTab`)
- Test: `app/funds/__tests__/holdingsTab.test.tsx`

**Interfaces:**
- Consumes: Task 3 (`formatLastChange`, types, `HOLDINGS_SORT_COLUMNS`), Task 4 routes; from `lib/fundManager.ts` `getComparisonMode`, `getAmountLabels`, `getBasisLabel`, `fundDisplayLabel`, `truncateDecimalTowardZero`, `formatSecurityType`, `UNMAPPED_TOKEN/LABEL`.
- Produces: `export function HoldingsTab(props: { manager: string; fund: string }): JSX.Element` — owns all `h_*` and `changed` URL params via the same `patchUrl` pattern as the page.

- [ ] **Step 1: Write the failing tests** (mock `next/navigation` and `@/lib/supabaseClient` exactly as `app/funds/__tests__/page.test.tsx` does):
  - `renders a Changes | Holdings tab switcher and opens Holdings from tab=holdings`.
  - `holdings load without Submit and without dates`.
  - `renders one ungrouped list with Fund and As of columns and no change column`.
  - `shows Added / Par ↑ / Par ↓ tags and muted "unchanged since" text`.
  - `Changed filter writes changed=7D to the URL and refetches`.
  - `market-value-only results label the amount Market Value and show the disclosure`.
  - `shows a stale notice for a fund whose last-change data is behind` (fund_status `stale: true` → notice naming the ticker).
  - `marks a metadata-conflict row and shows sector as Conflicting` (row `metadata_conflict: true, conflict_fields: ["sector_type"]`).
  - `switching tabs keeps manager and fund and the Changes query` (URL `preset=1D&manager=Regan&tab=holdings` → click Changes → URL keeps `preset=1D&manager=Regan`, drops `tab`).
  - Existing `page.test.tsx` still passes unchanged (Changes is the default tab when `tab` is absent).
- [ ] **Step 2:** `pnpm vitest run app/funds` → new tests FAIL.
- [ ] **Step 3:** Implement. Column layout key `fundmgr:holdings-layout`; page sizes from `ALLOWED_PAGE_SIZES`; text filters debounced 300 ms like Changes; filter dropdown values from `/api/funds/holdings/filter-options`; Export CSV button in the header targets `/api/funds/holdings/export` when the Holdings tab is active.
- [ ] **Step 4:** `pnpm vitest run && npx tsc --noEmit && pnpm build` → pass.
- [ ] **Step 5: Commit**: `feat(funds): Holdings tab on /funds`.

---

### Task 6: Deploy, measure, document

- [ ] **Step 1:** Merge JP `feat/holdings-last-change` (Tasks 1–2) to `main`, push. Apply with `deploy/scripts/backup-and-migrate.sh --apply` (root via the host's established route). Expected diff in its report: `alembic` → `0013_holdings_rpcs`, nothing else moves.
- [ ] **Step 2: Verify on production, read-only:** `fund_last_change_state` has 17 rows, all `last_error IS NULL`, every `reflects_snapshot_id` = that fund's latest live snapshot; time `get_fund_holdings()` (All Managers, default sort) — must be ≤ ~1 s, else stop and report; `has_function_privilege('anon', …)` false for all three new functions. Record the backfill duration and a spot-check of five real bonds' Last Change against their history.
- [ ] **Step 3:** After the next scheduled poll writes a snapshot (or a manual `systemctl start regan-fund-poller.service`), confirm that fund's state advanced and the ingest itself succeeded.
- [ ] **Step 4:** Merge core-chat `feat/holdings-tab`, build `core-chat:<sha>` with the base compose file only, verify the image, repoint `~/.rollout-deploy-override.yml`, recreate `frontend` with both compose files. Probe `/api/funds/holdings` without a token → 401. Ask the owner to check the tab in the browser.
- [ ] **Step 5: Docs, same session:** `core-chat/docs/fund-manager.md` (Holdings tab, routes, URL params, Last Change definition incl. the 5% paydown rule); source of truth 05 (three RPCs), 07 (migrations 0012/0013, two tables, the trigger and its never-raise rule), 19 (core-chat image, funds alembic head), 26 §13 (pollers now fire the trigger on every snapshot commit — note for anyone adding a fourth poller). Run `check-doc-drift.py`. Commit and push each repo.
