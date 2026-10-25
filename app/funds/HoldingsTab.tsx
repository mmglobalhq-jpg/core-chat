"use client";

/**
 * Holdings tab of /funds: each fund's latest accepted snapshot as ONE flat list
 * (not grouped), with every row carrying its own fund's As-of date and the
 * precomputed Last Change. Unlike Changes there are no dates, presets or Submit:
 * the list loads as soon as the tab opens or the scope changes.
 *
 * URL ownership: this tab reads `manager` + `fund` (shared with Changes) and owns
 * the h_* params and `changed`. It never reads or writes a Changes param, so
 * switching tabs back and forth leaves each tab's query intact.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DEFAULT_PAGE_SIZE,
  UNMAPPED_LABEL,
  UNMAPPED_TOKEN,
  formatDMY,
  fundDisplayLabel,
  getAmountLabels,
  getComparisonMode,
  type ComparisonMode,
} from "@/lib/fundManager";
import {
  DEFAULT_HOLDINGS_SORT,
  HOLDINGS_SORT_COLUMNS,
  formatLastChange,
  type HoldingRow,
  type HoldingsResponse,
  type HoldingsSortColumn,
} from "@/lib/fundHoldings";
import {
  ColumnsMenu,
  DataCell,
  Field,
  FundOptionList,
  FundsHeader,
  FundsTabs,
  MarketValueNote,
  PaginationBar,
  SecurityCell,
  SortHeader,
  authedFetch,
  filterCls,
  inputCls,
  isSecurityColumn,
  stickyOffsets,
  useColumnLayout,
  useCsvExport,
  useDebouncedUrlText,
  useFundOptions,
  usePatchUrl,
  type ColumnDef,
} from "./fundsUi";

// --------------------------------------------------------------------------- //
// Columns
// --------------------------------------------------------------------------- //
type HColKey =
  | "fund_ticker"
  | "as_of_date"
  | "security_id"
  | "description"
  | "security_type"
  | "sector_type"
  | "position_amount"
  | "comparison_basis"
  | "last_change";

// position_amount's label is basis-aware at render; comparison_basis (Basis) is
// shown only for mixed-basis results. Column keys double as the h_sort values.
const COLUMNS: ColumnDef<HColKey>[] = [
  { key: "fund_ticker", label: "Fund", align: "left", w: 130, pinned: true, sticky: true, sortable: true },
  { key: "as_of_date", label: "As of", align: "left", w: 84, pinned: true, sortable: true },
  { key: "security_id", label: "CUSIP / Security ID", align: "left", w: 150, pinned: true, sticky: true, sortable: true },
  { key: "description", label: "Description", align: "left", w: 260, sortable: true },
  { key: "security_type", label: "Security Type", align: "left", w: 150, sortable: true },
  { key: "sector_type", label: "Sector Type", align: "left", w: 120, sortable: true },
  { key: "position_amount", label: "Position Amount", align: "right", w: 150, sortable: true },
  { key: "comparison_basis", label: "Basis", align: "left", w: 110 },
  { key: "last_change", label: "Last Change", align: "left", w: 190, sortable: true },
];
const COL_BY_KEY = Object.fromEntries(COLUMNS.map((c) => [c.key, c])) as Record<
  HColKey,
  ColumnDef<HColKey>
>;
const PINNED: HColKey[] = COLUMNS.filter((c) => c.pinned).map((c) => c.key);
const NON_PINNED: HColKey[] = COLUMNS.filter(
  (c) => !c.pinned && c.key !== "comparison_basis",
).map((c) => c.key);
// Its own key, so the two tabs' layouts never overwrite each other.
const LAYOUT_KEY = "fundmgr:holdings-layout";

// Every URL param this tab sends to the API. Anything else in the URL belongs to
// the Changes tab (or to `tab` itself) and is never forwarded.
const HOLDINGS_PARAMS = [
  "manager",
  "fund",
  "h_page",
  "h_page_size",
  "h_sort",
  "h_dir",
  "h_q_security",
  "h_q_description",
  "h_f_security_type",
  "h_f_sector_type",
  "changed",
] as const;

const CHANGED_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Changed: any time" },
  { value: "1D", label: "Changed: last day" },
  { value: "7D", label: "Changed: last week" },
  { value: "30D", label: "Changed: last month" },
];

// Amount-like columns open newest/largest first; text columns open A→Z.
const DESC_FIRST: ReadonlySet<HColKey> = new Set(["last_change", "as_of_date", "position_amount"]);

const TAG_CLS: Record<"Added" | "Par ↑" | "Par ↓", string> = {
  Added: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  "Par ↑": "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  "Par ↓": "bg-red-500/10 text-red-700 dark:text-red-400",
};

function pickHoldingsParams(sp: URLSearchParams): URLSearchParams {
  const out = new URLSearchParams();
  for (const k of HOLDINGS_PARAMS) {
    const v = sp.get(k);
    if (v != null && v !== "") out.set(k, v);
  }
  return out;
}

/**
 * A free-text filter: local while typing, debounced into the URL (resetting the
 * page), and re-synced when the URL changes underneath it (back/forward, a shared
 * link). The echo of our own write is ignored, so keystrokes typed while the
 * router catches up are never overwritten by the older value.
 */
function useUrlTextFilter(param: string): [string, (v: string) => void] {
  const sp = useSearchParams();
  const patchUrl = usePatchUrl();
  const urlValue = sp.get(param) ?? "";
  const [value, setValue] = useState(urlValue);
  const written = useRef<string | null>(null);
  useEffect(() => {
    if (urlValue === written.current) return;
    written.current = null;
    setValue(urlValue);
  }, [urlValue]);
  useDebouncedUrlText(value, true, (v) => {
    if (v === urlValue) return;
    written.current = v;
    patchUrl({ [param]: v || null, h_page: null }, "replace");
  });
  return [value, setValue];
}

// --------------------------------------------------------------------------- //
// Tab
// --------------------------------------------------------------------------- //
export function HoldingsTab({ manager, fund }: { manager: string; fund: string }) {
  const sp = useSearchParams();
  const patchUrl = usePatchUrl();

  const [error, setError] = useState<string | null>(null);
  const { managers, funds: allFunds } = useFundOptions({
    onError: () => setError("Failed to load managers and funds."),
  });

  const [securityTypes, setSecurityTypes] = useState<string[]>([]);
  const [sectorTypes, setSectorTypes] = useState<string[]>([]);
  const [sectorHasNull, setSectorHasNull] = useState(false);

  const [data, setData] = useState<HoldingsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const reqId = useRef(0);

  const { layout, widthOf, startResize, moveColumn, toggleHidden, restore } = useColumnLayout(
    LAYOUT_KEY,
    COLUMNS,
    NON_PINNED,
  );
  const { exporting, run: runExport } = useCsvExport(setError);

  const [qSecurity, setQSecurity] = useUrlTextFilter("h_q_security");
  const [qDescription, setQDescription] = useUrlTextFilter("h_q_description");

  // Filter dropdown values for the holdings in scope.
  useEffect(() => {
    const p = new URLSearchParams();
    if (manager) p.set("manager", manager);
    if (fund) p.set("fund", fund);
    let live = true;
    authedFetch(`/api/funds/holdings/filter-options?${p}`)
      .then((r) => r.json())
      .then((d) => {
        if (!live) return;
        setSecurityTypes(d.security_types ?? []);
        setSectorTypes(d.sector_types ?? []);
        setSectorHasNull(Boolean(d.sector_has_null));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [manager, fund]);

  // The table: fetched immediately whenever any Holdings param changes (race-safe).
  const query = pickHoldingsParams(sp).toString();
  useEffect(() => {
    const id = ++reqId.current;
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    authedFetch(`/api/funds/holdings?${query}`, { signal: ctrl.signal })
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? `Request failed (${r.status})`);
        return body as HoldingsResponse;
      })
      .then((d) => {
        if (id === reqId.current) setData(d);
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        if (id === reqId.current) {
          setError(e instanceof Error ? e.message : "Failed to load holdings.");
          setData(null);
        }
      })
      .finally(() => {
        if (id === reqId.current) setLoading(false);
      });
    return () => ctrl.abort();
  }, [query]);

  const mode: ComparisonMode = useMemo(
    () => getComparisonMode(data?.holdings ?? [], data?.fund_status ?? []),
    [data],
  );
  const labelFor = (k: HColKey): string =>
    k === "position_amount" ? getAmountLabels(mode).amount : COL_BY_KEY[k].label;

  // Pinned first, then the persisted order minus hidden; Basis is force-inserted
  // before Last Change only for mixed-basis results.
  const visibleCols: HColKey[] = useMemo(() => {
    const ordered = [...PINNED, ...layout.order.filter((k) => !layout.hidden.includes(k))];
    if (mode !== "mixed") return ordered;
    const at = ordered.indexOf("last_change");
    const idx = at >= 0 ? at : ordered.length;
    return [...ordered.slice(0, idx), "comparison_basis", ...ordered.slice(idx)];
  }, [layout, mode]);
  const totalWidth = visibleCols.reduce((a, k) => a + widthOf(k), 0);
  const offsets = stickyOffsets(visibleCols, (k) => Boolean(COL_BY_KEY[k].sticky), widthOf);

  const sortParam = sp.get("h_sort");
  const sort: HoldingsSortColumn = HOLDINGS_SORT_COLUMNS.includes(sortParam as HoldingsSortColumn)
    ? (sortParam as HoldingsSortColumn)
    : DEFAULT_HOLDINGS_SORT;
  const dir = sp.get("h_dir") ?? "desc";
  const pageSize = Number(sp.get("h_page_size") ?? DEFAULT_PAGE_SIZE);
  const page = Number(sp.get("h_page") ?? 1);

  function toggleSort(col: HColKey) {
    if (!COL_BY_KEY[col].sortable) return;
    if (sort === col) patchUrl({ h_dir: dir === "asc" ? "desc" : "asc", h_page: null }, "replace");
    else patchUrl({ h_sort: col, h_dir: DESC_FIRST.has(col) ? "desc" : "asc", h_page: null }, "replace");
  }

  function setScope(patch: { manager?: string; fund?: string }) {
    // A scope change loads immediately and starts from page 1. A fund belongs to
    // its manager, so changing the manager clears the fund. The scope is shared with
    // Changes, so its scope-dependent state goes too: a stale `page` would show
    // "Page 7 / 2" over an empty table, and an old filter would apply unseen.
    patchUrl(
      {
        ...("manager" in patch ? { manager: patch.manager ?? null, fund: null } : {}),
        ...("fund" in patch ? { fund: patch.fund ?? null } : {}),
        h_page: null,
        page: null,
        f_security_type: null,
        f_sector_type: null,
      },
      "replace",
    );
  }

  function exportCsv() {
    const params = pickHoldingsParams(sp);
    params.delete("h_page");
    params.delete("h_page_size");
    void runExport(
      `/api/funds/holdings/export?${params}`,
      `fund-holdings_${new Date().toISOString().slice(0, 10)}.csv`,
      true,
    );
  }

  const fundsForManager = useMemo(
    () => (manager ? allFunds.filter((f) => f.fund_manager === manager) : allFunds),
    [allFunds, manager],
  );

  const rows = data?.holdings ?? [];
  const staleFunds = (data?.fund_status ?? []).filter((f) => f.stale);
  const total = data?.pagination.total_rows ?? 0;
  const totalPages = data?.pagination.total_pages ?? 0;
  const empty = !loading && !error && data != null && total === 0;

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <FundsHeader
        onExport={exportCsv}
        exportDisabled={false}
        exporting={exporting}
        columnsMenu={
          <ColumnsMenu
            pinned={PINNED}
            layout={layout}
            labelOf={(k) => COL_BY_KEY[k].label}
            onMove={moveColumn}
            onToggleHidden={toggleHidden}
            onRestore={restore}
          />
        }
      />

      {/* Scope — applies immediately; there is nothing to submit. */}
      <section className="shrink-0 border-b border-border p-4">
        <FundsTabs active="holdings" />
        <div className="flex flex-wrap items-end gap-4">
          <Field label="Fund Manager" className="w-52">
            <select
              className={inputCls}
              value={manager}
              onChange={(e) => setScope({ manager: e.target.value })}
            >
              <option value="">All Managers</option>
              {managers.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Fund" className="w-52">
            <select
              className={inputCls}
              value={fund}
              onChange={(e) => setScope({ fund: e.target.value })}
            >
              <option value="">All Funds</option>
              <FundOptionList funds={fundsForManager} />
            </select>
          </Field>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Each fund&apos;s latest snapshot, shown with its own As of date (DD/MM/YY). Last Change is
          when a holding was added or its par moved; paydowns of 5% or less are not counted.
        </p>
      </section>

      <section className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
          <input
            className={cn(filterCls, "h-8 w-44 pointer-coarse:h-11")}
            placeholder="CUSIP / Security ID…"
            value={qSecurity}
            onChange={(e) => setQSecurity(e.target.value)}
            aria-label="Filter by CUSIP or Security ID"
          />
          <input
            className={cn(filterCls, "h-8 w-52 pointer-coarse:h-11")}
            placeholder="Description…"
            value={qDescription}
            onChange={(e) => setQDescription(e.target.value)}
            aria-label="Filter by description"
          />
          <select
            className={cn(filterCls, "h-8 w-40 pointer-coarse:h-11")}
            value={sp.get("h_f_security_type") ?? ""}
            onChange={(e) =>
              patchUrl({ h_f_security_type: e.target.value || null, h_page: null }, "replace")
            }
            aria-label="Filter by security type"
          >
            <option value="">All Security Types</option>
            {securityTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select
            className={cn(filterCls, "h-8 w-36 pointer-coarse:h-11")}
            value={sp.get("h_f_sector_type") ?? ""}
            onChange={(e) =>
              patchUrl({ h_f_sector_type: e.target.value || null, h_page: null }, "replace")
            }
            aria-label="Filter by sector type"
          >
            <option value="">All Sector Types</option>
            {sectorTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
            {sectorHasNull && <option value={UNMAPPED_TOKEN}>{UNMAPPED_LABEL}</option>}
          </select>
          <select
            className={cn(filterCls, "h-8 w-44 pointer-coarse:h-11")}
            value={sp.get("changed") ?? ""}
            onChange={(e) => patchUrl({ changed: e.target.value || null, h_page: null }, "replace")}
            aria-label="Changed"
          >
            {CHANGED_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        {(mode === "market_value" || mode === "mixed") && <MarketValueNote />}

        {/* Lag is surfaced, never hidden: the rows still show, with a notice. */}
        {staleFunds.length > 0 && (
          <div
            className="flex flex-col gap-0.5 border-b border-border bg-amber-50 px-4 py-1.5 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
            role="status"
          >
            {staleFunds.map((f) => (
              <span key={f.fund_ticker} className="inline-flex items-center gap-1">
                <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
                <span>{`${f.fund_ticker}: last-change data is behind its latest snapshot`}</span>
              </span>
            ))}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto">
          <table
            className="table-fixed border-collapse text-sm [&_tbody_td]:overflow-hidden [&_tbody_td]:whitespace-nowrap"
            style={{ width: totalWidth }}
          >
            <colgroup>
              {visibleCols.map((k) => (
                <col key={k} style={{ width: widthOf(k) }} />
              ))}
            </colgroup>
            <thead className="sticky top-0 z-10 bg-muted/90 backdrop-blur">
              <tr className="text-left text-muted-foreground">
                {visibleCols.map((k, idx) => {
                  const c = COL_BY_KEY[k];
                  return (
                    <SortHeader
                      key={k}
                      label={labelFor(k)}
                      align={c.align}
                      sortable={Boolean(c.sortable)}
                      active={sort === k}
                      dir={dir}
                      stickyLeft={offsets[idx]}
                      onSort={() => toggleSort(k)}
                      onResizeStart={(e) => startResize(k, e)}
                    />
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={`${r.fund_ticker}-${r.security_id}-${i}`}
                  className="border-t border-border hover:bg-muted/40"
                >
                  {visibleCols.map((k, idx) => (
                    <HoldingCell key={k} colKey={k} row={r} stickyLeft={offsets[idx]} />
                  ))}
                </tr>
              ))}
              {empty && (
                <tr>
                  <td
                    colSpan={visibleCols.length}
                    className="px-3 py-12 text-center text-muted-foreground"
                  >
                    No holdings match these filters.
                  </td>
                </tr>
              )}
              {error && (
                <tr>
                  <td colSpan={visibleCols.length} className="px-3 py-12 text-center text-destructive">
                    {error}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {loading && (
            <div className="px-3 py-10 text-center text-sm text-muted-foreground">Loading…</div>
          )}
        </div>

        <PaginationBar
          total={total}
          page={page}
          pageSize={pageSize}
          totalPages={totalPages}
          loading={loading}
          onPageSize={(size) => patchUrl({ h_page_size: size, h_page: null }, "replace")}
          onPage={(p) => patchUrl({ h_page: String(p) }, "replace")}
        />
      </section>
    </div>
  );
}

// --------------------------------------------------------------------------- //
// Cells
// --------------------------------------------------------------------------- //
function HoldingCell({
  colKey,
  row,
  stickyLeft,
}: {
  colKey: HColKey;
  row: HoldingRow;
  stickyLeft: number | null;
}) {
  if (isSecurityColumn(colKey)) {
    return (
      <SecurityCell
        colKey={colKey}
        row={row}
        sectorConflict={row.conflict_fields.includes("sector_type")}
        stickyLeft={stickyLeft}
      />
    );
  }
  switch (colKey) {
    case "fund_ticker": {
      const d = fundDisplayLabel(row.fund_ticker);
      return (
        <DataCell
          stickyLeft={stickyLeft}
          className={cn("text-ellipsis", d.aliases.length === 0 && "font-mono")}
          title={d.aliases.length ? d.aliases.join(" / ") : undefined}
        >
          {d.label}
        </DataCell>
      );
    }
    case "as_of_date":
      return (
        <DataCell stickyLeft={stickyLeft} className="font-mono tabular-nums">
          {formatDMY(row.as_of_date)}
        </DataCell>
      );
    case "last_change": {
      const lc = formatLastChange(row);
      return (
        <DataCell stickyLeft={stickyLeft}>
          {lc.tag ? (
            <span className="inline-flex items-center gap-1.5">
              <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium", TAG_CLS[lc.tag])}>
                {lc.tag}
              </span>
              <span className="font-mono tabular-nums">{lc.date}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">{lc.text}</span>
          )}
        </DataCell>
      );
    }
  }
}
