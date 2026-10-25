"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ChevronDown,
  ChevronRight,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  CHANGE_TYPES,
  DEFAULT_PAGE_SIZE,
  DEFAULT_SORT_COLUMN,
  UNMAPPED_LABEL,
  UNMAPPED_TOKEN,
  formatDMY,
  getAmountLabels,
  getComparisonMode,
  normalizePositionChangeRow,
  truncateDecimalTowardZero,
  type ChangeRow,
  type ChangesResponse,
  type ComparisonMode,
  type FundStatus,
} from "@/lib/fundManager";
import { HoldingsTab } from "./HoldingsTab";
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
// Column layout
// --------------------------------------------------------------------------- //
type ColKey =
  | "fund_ticker"
  | "security_id"
  | "description"
  | "security_type"
  | "sector_type"
  | "position_amount"
  | "position_change"
  | "comparison_basis"
  | "change_type";

// position_amount/position_change labels are basis-aware at render (see labelFor);
// comparison_basis (Basis) is shown only for mixed-basis results.
const COLUMNS: ColumnDef<ColKey>[] = [
  { key: "fund_ticker", label: "Fund", align: "left", w: 90, pinned: true, sticky: true },
  { key: "security_id", label: "CUSIP / Security ID", align: "left", w: 170, pinned: true, sticky: true, sortable: true },
  { key: "description", label: "Description", align: "left", w: 280, sortable: true },
  { key: "security_type", label: "Security Type", align: "left", w: 150, sortable: true },
  { key: "sector_type", label: "Sector Type", align: "left", w: 120, sortable: true },
  { key: "position_amount", label: "Position Amount", align: "right", w: 150, sortable: true },
  { key: "position_change", label: "Position Change", align: "right", w: 150, sortable: true },
  { key: "comparison_basis", label: "Basis", align: "left", w: 110 },
  { key: "change_type", label: "Change Type", align: "left", w: 160, sortable: true },
];
const COL_BY_KEY = Object.fromEntries(COLUMNS.map((c) => [c.key, c])) as Record<
  ColKey,
  ColumnDef<ColKey>
>;
const PINNED: ColKey[] = COLUMNS.filter((c) => c.pinned).map((c) => c.key);
// The Basis column is auto-managed (shown only for mixed results), so it is kept
// out of the reorder / show-hide machinery.
const NON_PINNED: ColKey[] = COLUMNS.filter(
  (c) => !c.pinned && c.key !== "comparison_basis",
).map((c) => c.key);
const LAYOUT_KEY = "fundmgr:layout";

// --------------------------------------------------------------------------- //
// Formatting
// --------------------------------------------------------------------------- //
const PRESETS: { key: string; label: string }[] = [
  { key: "1D", label: "1D" },
  { key: "7D", label: "7D" },
  { key: "30D", label: "30D" },
  { key: "1Y", label: "1Y" },
];

// Presets no longer compute dates in the browser. They send the preset key, and the
// RPC resolves each fund against its own snapshot history (see PRESET_LOOKBACK).
//
// The old arithmetic was `end - N calendar days`, which had two faults. It counted
// calendar days, so on a Monday "1D" asked for Sunday — a date no fund publishes.
// And a single date pair cannot be right for funds with different publication lags:
// MBSX publishes same-day while MBSF runs a business day behind, so on 2026-09-14
// the "1D" window was blank for 16 of 17 funds. Counting snapshots instead is
// weekend-, holiday- and lag-aware without the browser carrying an NYSE calendar.

const CHANGE_META: Record<
  string,
  { icon: typeof TrendingUp; color: string; iconLabel: string }
> = {
  Added: { icon: TrendingUp, color: "text-emerald-600 dark:text-emerald-400", iconLabel: "up" },
  Increased: { icon: TrendingUp, color: "text-emerald-600 dark:text-emerald-400", iconLabel: "up" },
  Removed: { icon: TrendingDown, color: "text-red-600 dark:text-red-400", iconLabel: "down" },
  Decreased: { icon: TrendingDown, color: "text-red-600 dark:text-red-400", iconLabel: "down" },
  "Metadata Conflict": {
    icon: TriangleAlert,
    color: "text-amber-600 dark:text-amber-400",
    iconLabel: "warning",
  },
};

// --------------------------------------------------------------------------- //
// URL state
// --------------------------------------------------------------------------- //
type Committed = { manager: string; fund: string; start: string; end: string; preset: string };

function readCommitted(sp: URLSearchParams): Committed {
  return {
    manager: sp.get("manager") ?? "",
    fund: sp.get("fund") ?? "",
    start: sp.get("start") ?? "",
    end: sp.get("end") ?? "",
    preset: sp.get("preset") ?? "",
  };
}

// --------------------------------------------------------------------------- //
// Page
// --------------------------------------------------------------------------- //
export default function FundsPageWrapper() {
  return (
    <Suspense
      fallback={<div className="grid h-dvh place-items-center text-muted-foreground">Loading…</div>}
    >
      <FundsView />
    </Suspense>
  );
}

/** The tab lives in the URL (tab=holdings); Changes is the default. */
function FundsView() {
  const sp = useSearchParams();
  if (sp.get("tab") === "holdings") {
    return <HoldingsTab manager={sp.get("manager") ?? ""} fund={sp.get("fund") ?? ""} />;
  }
  return <FundManagerPage />;
}

function FundManagerPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const committed = readCommitted(sp);
  // A preset is a complete query on its own — it needs no dates, because each fund
  // resolves its own window server-side.
  const hasQuery = Boolean((committed.start && committed.end) || committed.preset);

  const patchUrl = usePatchUrl();

  // Options.
  const [securityTypes, setSecurityTypes] = useState<string[]>([]);
  const [sectorTypes, setSectorTypes] = useState<string[]>([]);
  const [sectorHasNull, setSectorHasNull] = useState(false);

  // Draft top-controls (edited but not executed until Submit).
  const [draft, setDraft] = useState<Committed>(committed);
  const [scopeLatest, setScopeLatest] = useState<string | null>(null);
  // True once End is the user's OWN choice — typed into the field, or restored from a
  // URL that carried one. Until then End is derived, and must follow the scope's latest
  // date rather than whatever it was first seeded with. See the effect below.
  const endPinnedRef = useRef<boolean>(Boolean(committed.end));

  // Results.
  const [data, setData] = useState<ChangesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Column layout (persisted per browser).
  const { layout, widthOf, startResize, moveColumn, toggleHidden, restore } = useColumnLayout(
    LAYOUT_KEY,
    COLUMNS,
    NON_PINNED,
  );
  // Collapsed fund groups (session only — deliberately not persisted).
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Local text-filter state (debounced into the URL).
  const [qSecurity, setQSecurity] = useState(sp.get("q_security") ?? "");
  const [qDescription, setQDescription] = useState(sp.get("q_description") ?? "");

  const { exporting, run: runExport } = useCsvExport(setError);
  const reqId = useRef(0);

  // Re-sync the draft controls whenever the committed (URL) query changes via
  // navigation or Submit (back/forward restores the controls).
  useEffect(() => {
    setDraft(committed);
    // A URL that carries an End is an explicit choice (a shared link, or back/forward
    // onto a query the user submitted), so it must not be overwritten by the scope.
    endPinnedRef.current = Boolean(committed.end);
    setQSecurity(sp.get("q_security") ?? "");
    setQDescription(sp.get("q_description") ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [committed.manager, committed.fund, committed.start, committed.end, committed.preset]);

  // Load managers + funds + latest once.
  const { managers, funds: allFunds } = useFundOptions({
    onLatestDate: setScopeLatest,
    onError: () => setError("Failed to load managers and funds."),
  });

  // Latest date for the DRAFT scope (drives End default + presets).
  useEffect(() => {
    const p = new URLSearchParams();
    if (draft.manager) p.set("manager", draft.manager);
    if (draft.fund) p.set("fund", draft.fund);
    authedFetch(`/api/funds/latest-date?${p}`)
      .then((r) => r.json())
      .then((d) => setScopeLatest(d.latestDate ?? null))
      .catch(() => {});
  }, [draft.manager, draft.fund]);

  // Filter-option values for the committed scope, narrowed to the two snapshots
  // actually being compared. Passing the window is what keeps this fast — unscoped
  // it walks all of history (38.5 s for JP Morgan in production) — and it also stops
  // the dropdowns offering values that cannot appear in the result.
  //
  // It runs alongside the table fetch rather than after it, so a slow lookup never
  // delays the rows.
  useEffect(() => {
    if (!hasQuery) return;
    const p = new URLSearchParams();
    if (committed.manager) p.set("manager", committed.manager);
    if (committed.fund) p.set("fund", committed.fund);
    if (committed.preset) p.set("preset", committed.preset);
    else {
      p.set("start", committed.start);
      p.set("end", committed.end);
    }
    let live = true;
    authedFetch(`/api/funds/filter-options?${p}`)
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
  }, [
    hasQuery,
    committed.manager,
    committed.fund,
    committed.preset,
    committed.start,
    committed.end,
  ]);

  // Fetch the table whenever any URL param changes (server-driven; race-safe).
  const spString = sp.toString();
  useEffect(() => {
    if (!hasQuery) {
      setData(null);
      return;
    }
    const id = ++reqId.current;
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    // `preset` is forwarded, not stripped: the server maps it to a per-fund
    // lookback. Stripping it here was safe only while presets were pre-resolved
    // into dates in the browser.
    authedFetch(`/api/funds/changes?${spString}`, { signal: ctrl.signal })
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? `Request failed (${r.status})`);
        return body as ChangesResponse;
      })
      .then((d) => {
        // Normalize each row (basis-aware; legacy par-only fallback) once here so
        // the table, summary, and export all read position_* consistently.
        const normalized: ChangesResponse = {
          ...d,
          changes: (d.changes ?? []).map((r) =>
            normalizePositionChangeRow(r as unknown as Record<string, unknown>),
          ),
        };
        if (id === reqId.current) setData(normalized);
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        if (id === reqId.current) {
          setError(e instanceof Error ? e.message : "Failed to load position changes.");
          setData(null);
        }
      })
      .finally(() => {
        if (id === reqId.current) setLoading(false);
      });
    return () => ctrl.abort();
  }, [hasQuery, spString]);

  // Debounce the two free-text filters into the URL (300 ms).
  useDebouncedUrlText(qSecurity, hasQuery, (v) =>
    patchUrl({ q_security: v || null, page: null }, "replace"),
  );
  useDebouncedUrlText(qDescription, hasQuery, (v) =>
    patchUrl({ q_description: v || null, page: null }, "replace"),
  );

  // --- URL writers ------------------------------------------------------- //
  function submit() {
    if (!draft.preset && (!draft.start || !draft.end)) return;
    // A new comparison is a history entry; filters/sort/page reset.
    const next = new URLSearchParams();
    if (draft.manager) next.set("manager", draft.manager);
    if (draft.fund) next.set("fund", draft.fund);
    if (draft.preset) {
      next.set("preset", draft.preset);
    } else {
      next.set("start", draft.start);
      next.set("end", draft.end);
    }
    next.set("page", "1");
    next.set("page_size", sp.get("page_size") ?? String(DEFAULT_PAGE_SIZE));
    router.push(`/funds?${next.toString()}`);
  }

  function applyPreset(key: string) {
    // A preset carries no dates: each fund is resolved against its own latest
    // snapshot server-side. Clearing start/end keeps the two from disagreeing, and
    // un-pins End so typing a date later is recognised as a deliberate choice.
    endPinnedRef.current = false;
    setDraft((d) => ({ ...d, preset: d.preset === key ? "" : key, start: "", end: "" }));
  }

  // A derived End follows the SCOPE's latest available date, so the manual date
  // fields open somewhere the selected manager actually has data.
  //
  // This used to fill End only when it was empty, so End kept whatever the *global*
  // latest was at mount even after the user narrowed to one manager. That was invisible
  // for as long as every daily poller shared a publication lag: the global maximum and
  // the per-manager maximum were the same date, and a stale End happened to be right.
  //
  // Anchoring on the scope fixed that for a single manager, but could not reach the
  // two cases that remained: lag that differs *within* one manager (MBSF trails MBSX
  // by a business day), and the All Managers scope, whose maximum belongs to whichever
  // source publishes earliest. On 2026-09-14 a 1D preset was blank for 16 of 17 funds.
  // Presets no longer carry dates at all — each fund resolves its own window — so this
  // effect now only seeds the manual fields.
  //
  // A user-chosen End is never overwritten; only a derived one follows the scope.
  useEffect(() => {
    if (!scopeLatest || endPinnedRef.current) return;
    setDraft((d) => (d.preset || d.end === scopeLatest ? d : { ...d, end: scopeLatest }));
  }, [scopeLatest]);

  const fundsForManager = useMemo(
    () => (draft.manager ? allFunds.filter((f) => f.fund_manager === draft.manager) : allFunds),
    [allFunds, draft.manager],
  );

  const dateRangeInvalid = Boolean(draft.start && draft.end && draft.start > draft.end);

  // Result comparison mode (par / market_value / mixed) drives labels + the Basis column.
  const mode: ComparisonMode = useMemo(
    () => getComparisonMode(data?.changes ?? [], data?.fund_status ?? []),
    [data],
  );
  const amountLabels = getAmountLabels(mode);
  /** Basis-aware header label for a column key. */
  const labelFor = (k: ColKey): string => {
    if (k === "position_amount") return amountLabels.amount;
    if (k === "position_change") return amountLabels.change;
    return COL_BY_KEY[k].label;
  };

  // Visible, ordered columns (pinned first, then persisted order minus hidden). The
  // Basis column is force-inserted (before Change Type) only for mixed-basis results.
  const visibleCols: ColKey[] = useMemo(() => {
    const ordered = [...PINNED, ...layout.order.filter((k) => !layout.hidden.includes(k))];
    if (mode !== "mixed") return ordered;
    const at = ordered.indexOf("change_type");
    const idx = at >= 0 ? at : ordered.length;
    return [...ordered.slice(0, idx), "comparison_basis", ...ordered.slice(idx)];
  }, [layout, mode]);
  const totalWidth = visibleCols.reduce((a, k) => a + widthOf(k), 0);

  const sort = sp.get("sort") ?? DEFAULT_SORT_COLUMN;
  const dir = sp.get("dir") ?? "desc";
  const pageSize = Number(sp.get("page_size") ?? DEFAULT_PAGE_SIZE);
  const page = Number(sp.get("page") ?? 1);
  const activeChangeTypes = (sp.get("change_type") ?? "").split(",").filter(Boolean);

  function toggleSort(col: ColKey) {
    if (!COL_BY_KEY[col].sortable) return;
    // Column keys are already the whitelisted basis-aware RPC sort keys: the amount
    // column IS `position_amount` and the change column IS `position_change`.
    if (sort === col) {
      patchUrl({ dir: dir === "asc" ? "desc" : "asc" }, "replace");
    } else {
      const initialDir = col === "position_amount" || col === "position_change" ? "desc" : "asc";
      patchUrl({ sort: col, dir: initialDir }, "replace");
    }
  }

  const offsets = stickyOffsets(visibleCols, (k) => Boolean(COL_BY_KEY[k].sticky), widthOf);

  function toggleChangeType(ct: string) {
    const set = new Set(activeChangeTypes);
    if (set.has(ct)) set.delete(ct);
    else set.add(ct);
    patchUrl({ change_type: [...set].join(",") || null, page: null }, "replace");
  }

  function exportCsv() {
    // `preset` is kept — the export RPC resolves it per fund exactly as the table does.
    const params = new URLSearchParams(spString);
    params.delete("page");
    params.delete("page_size");
    void runExport(
      `/api/funds/export?${params}`,
      committed.preset
        ? `fund-position-changes_${committed.preset}.csv`
        : `fund-position-changes_${committed.start}_${committed.end}.csv`,
    );
  }

  // Group the current page's rows by fund, preserving server order.
  const groups = useMemo(() => {
    const rows = data?.changes ?? [];
    const out: { ticker: string; rows: ChangeRow[] }[] = [];
    for (const r of rows) {
      const last = out[out.length - 1];
      if (last && last.ticker === r.fund_ticker) last.rows.push(r);
      else out.push({ ticker: r.fund_ticker, rows: [r] });
    }
    return out;
  }, [data]);

  const statusByTicker = useMemo(() => {
    const m = new Map<string, FundStatus>();
    for (const f of data?.fund_status ?? []) m.set(f.fund_ticker, f);
    return m;
  }, [data]);

  const total = data?.pagination.total_rows ?? 0;
  const totalPages = data?.pagination.total_pages ?? 0;
  const problemFunds = (data?.fund_status ?? []).filter((f) => f.status !== "ok");
  const zeroChanges = hasQuery && !loading && !error && total === 0;

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <FundsHeader
        onExport={exportCsv}
        exportDisabled={!hasQuery}
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

      {/* Controls (~20%) — nothing runs until Submit. */}
      <section className="max-h-[26%] shrink-0 overflow-auto border-b border-border p-4">
        <FundsTabs active="changes" />
        <div className="flex flex-wrap items-end gap-4">
          <Field label="Fund Manager" className="w-52">
            <select
              className={inputCls}
              value={draft.manager}
              onChange={(e) => setDraft((d) => ({ ...d, manager: e.target.value, fund: "" }))}
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
              value={draft.fund}
              onChange={(e) => setDraft((d) => ({ ...d, fund: e.target.value }))}
            >
              <option value="">All Funds</option>
              <FundOptionList funds={fundsForManager} />
            </select>
          </Field>

          {/* Typing a date drops the preset — the two modes are mutually exclusive. */}
          <Field label="Start Date" className="w-40">
            <input
              type="date"
              className={cn(inputCls, draft.preset && "opacity-50")}
              value={draft.start}
              placeholder={draft.preset ? "per fund" : undefined}
              onChange={(e) => setDraft((d) => ({ ...d, start: e.target.value, preset: "" }))}
            />
          </Field>
          <Field label="End Date" className="w-40">
            <input
              type="date"
              className={cn(inputCls, draft.preset && "opacity-50")}
              value={draft.end}
              onChange={(e) => {
                endPinnedRef.current = true;
                setDraft((d) => ({ ...d, end: e.target.value, preset: "" }));
              }}
            />
          </Field>

          <Field label="Range">
            <div className="flex gap-1">
              {PRESETS.map((p) => (
                <Button
                  key={p.key}
                  type="button"
                  size="sm"
                  variant={draft.preset === p.key ? "default" : "outline"}
                  onClick={() => applyPreset(p.key)}
                >
                  {p.label}
                </Button>
              ))}
            </div>
          </Field>

          <Button
            type="button"
            onClick={submit}
            disabled={(!draft.preset && (!draft.start || !draft.end)) || dateRangeInvalid}
          >
            Submit
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {dateRangeInvalid
            ? "Start Date must be on or before End Date."
            : draft.preset
              ? `${draft.preset}: each fund is compared against its own trading history, so funds that publish on different schedules are all up to date. The resolved dates are shown in each fund header.`
              : "Start Date is inclusive — changes made on that date are included. Each fund resolves to its own nearest snapshots, shown as DD/MM/YY in the fund header. Future dates are allowed."}
        </p>
      </section>

      {/* Results (~80%) */}
      <section className="flex min-h-0 flex-1 flex-col">
        {!hasQuery ? (
          <div className="grid flex-1 place-items-center px-6 text-center text-sm text-muted-foreground">
            Choose a manager, fund, and date range (or a preset), then press Submit to compare
            positions.
          </div>
        ) : (
          <>
            {/* Immediate filters (server-driven, no Submit needed). */}
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
              <input
                className={cn(filterCls, "h-8 w-44")}
                placeholder="CUSIP / Security ID…"
                value={qSecurity}
                onChange={(e) => setQSecurity(e.target.value)}
                aria-label="Filter by CUSIP or Security ID"
              />
              <input
                className={cn(filterCls, "h-8 w-52")}
                placeholder="Description…"
                value={qDescription}
                onChange={(e) => setQDescription(e.target.value)}
                aria-label="Filter by description"
              />
              <select
                className={cn(filterCls, "h-8 w-40")}
                value={sp.get("f_security_type") ?? ""}
                onChange={(e) =>
                  patchUrl({ f_security_type: e.target.value || null, page: null }, "replace")
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
                className={cn(filterCls, "h-8 w-36")}
                value={sp.get("f_sector_type") ?? ""}
                onChange={(e) =>
                  patchUrl({ f_sector_type: e.target.value || null, page: null }, "replace")
                }
                aria-label="Filter by sector type"
              >
                <option value="">All Sector Types</option>
                {sectorTypes.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
                {/* Null-sector rows: shown as "Unmapped", sent to the RPC as __UNMAPPED__. */}
                {sectorHasNull && <option value={UNMAPPED_TOKEN}>{UNMAPPED_LABEL}</option>}
              </select>
              <ChangeTypeMenu active={activeChangeTypes} onToggle={toggleChangeType} />
              {activeChangeTypes.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8"
                  onClick={() => patchUrl({ change_type: null, page: null }, "replace")}
                >
                  Clear types
                </Button>
              )}
            </div>

            {/* Market-value disclosure — shown for MARKET_VALUE-only and mixed results. */}
            {(mode === "market_value" || mode === "mixed") && <MarketValueNote />}

            {/* Per-fund status notices (insufficient history / no snapshot). */}
            {problemFunds.length > 0 && (
              <div className="border-b border-border bg-muted/30 px-4 py-1.5 text-xs text-muted-foreground">
                {problemFunds.map((f) => (
                  <span key={f.fund_ticker} className="mr-4 inline-flex items-center gap-1">
                    <span className="font-mono font-medium text-foreground">{f.fund_ticker}</span>:{" "}
                    {STATUS_LABEL[f.status]} {f.reason ? `— ${f.reason}` : ""}
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
                  {groups.map((g) => {
                    const st = statusByTicker.get(g.ticker);
                    const isCollapsed = collapsed.has(g.ticker);
                    return (
                      <FundGroup
                        key={g.ticker}
                        ticker={g.ticker}
                        rows={g.rows}
                        status={st}
                        colSpan={visibleCols.length}
                        cols={visibleCols}
                        offsets={offsets}
                        collapsed={isCollapsed}
                        onToggle={() =>
                          setCollapsed((s) => {
                            const n = new Set(s);
                            if (n.has(g.ticker)) n.delete(g.ticker);
                            else n.add(g.ticker);
                            return n;
                          })
                        }
                      />
                    );
                  })}
                  {zeroChanges && (
                    <tr>
                      <td
                        colSpan={visibleCols.length}
                        className="px-3 py-12 text-center text-muted-foreground"
                      >
                        No position changes found for the resolved dates.
                      </td>
                    </tr>
                  )}
                  {error && (
                    <tr>
                      <td
                        colSpan={visibleCols.length}
                        className="px-3 py-12 text-center text-destructive"
                      >
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
              onPageSize={(size) => patchUrl({ page_size: size, page: "1" }, "replace")}
              onPage={(p) => patchUrl({ page: String(p) }, "replace")}
            />
          </>
        )}
      </section>
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = {
  insufficient_history: "Insufficient history",
  no_start_snapshot: "No start snapshot",
  no_end_snapshot: "No end snapshot",
  ok: "OK",
};

// --------------------------------------------------------------------------- //
// Fund group (header repeated on each page where the fund appears)
// --------------------------------------------------------------------------- //
function FundGroup({
  ticker,
  rows,
  status,
  colSpan,
  cols,
  offsets,
  collapsed,
  onToggle,
}: {
  ticker: string;
  rows: ChangeRow[];
  status: FundStatus | undefined;
  colSpan: number;
  cols: ColKey[];
  offsets: (number | null)[];
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className="border-t border-border bg-secondary/60">
        <td colSpan={colSpan} className="sticky left-0 px-3 py-1.5">
          <button
            type="button"
            onClick={onToggle}
            className="inline-flex items-center gap-2 text-left"
            aria-expanded={!collapsed}
          >
            {collapsed ? (
              <ChevronRight className="size-4 shrink-0" />
            ) : (
              <ChevronDown className="size-4 shrink-0" />
            )}
            <span className="font-mono text-sm font-semibold text-foreground">{ticker}</span>
            <span className="text-xs text-muted-foreground">
              {/* The first date is the comparison BASELINE — the snapshot changes are
                  measured against — not the first day of the requested window. */}
              <span title="Comparison baseline — changes are measured from this snapshot">
                baseline {formatDMY(status?.actual_start_date ?? null)}
              </span>{" "}
              → {formatDMY(status?.actual_end_date ?? null)}
              {" · "}
              {rows.length} on page of {status?.matching_row_count ?? rows.length} rows
              {status && status.warning_count > 0 && (
                <span className="ml-2 inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                  <TriangleAlert className="size-3.5" aria-hidden />
                  {status.warning_count} warning{status.warning_count === 1 ? "" : "s"}
                </span>
              )}
            </span>
          </button>
        </td>
      </tr>
      {!collapsed &&
        rows.map((r, i) => (
          <tr
            key={`${r.fund_ticker}-${r.security_id}-${i}`}
            className="border-t border-border hover:bg-muted/40"
          >
            {cols.map((k, idx) => (
              <Cell
                key={k}
                colKey={k}
                row={r}
                leftOffset={offsets[idx]}
              />
            ))}
          </tr>
        ))}
    </>
  );
}

function Cell({
  colKey,
  row,
  leftOffset,
}: {
  colKey: ColKey;
  row: ChangeRow;
  leftOffset: number | null;
}) {
  if (isSecurityColumn(colKey)) {
    return (
      <SecurityCell
        colKey={colKey}
        row={row}
        sectorConflict={row.change_type === "Metadata Conflict"}
        stickyLeft={leftOffset}
      />
    );
  }
  switch (colKey) {
    case "fund_ticker":
      return (
        <DataCell stickyLeft={leftOffset} className="font-mono">
          {row.fund_ticker}
        </DataCell>
      );
    case "position_change": {
      const neg = (row.position_change ?? "").trim().startsWith("-");
      return (
        <DataCell
          stickyLeft={leftOffset}
          className={cn(
            "text-right font-mono tabular-nums",
            row.position_change != null && !neg && "text-emerald-600 dark:text-emerald-400",
            row.position_change != null && neg && "text-red-600 dark:text-red-400",
          )}
        >
          {row.position_change == null ? "—" : truncateDecimalTowardZero(row.position_change)}
        </DataCell>
      );
    }
    case "change_type": {
      const meta = CHANGE_META[row.change_type];
      const Icon = meta?.icon;
      return (
        <DataCell stickyLeft={leftOffset}>
          <span className={cn("inline-flex items-center gap-1.5", meta?.color)}>
            {Icon && <Icon className="size-3.5 shrink-0" aria-hidden />}
            {row.change_type}
          </span>
        </DataCell>
      );
    }
  }
}

// --------------------------------------------------------------------------- //
// Menus
// --------------------------------------------------------------------------- //
function ChangeTypeMenu({
  active,
  onToggle,
}: {
  active: string[];
  onToggle: (ct: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5">
          Change Type
          {active.length > 0 && (
            <span className="rounded bg-primary/15 px-1 text-xs text-primary">{active.length}</span>
          )}
          <ChevronDown className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        {CHANGE_TYPES.map((ct) => (
          <DropdownMenuCheckboxItem
            key={ct}
            checked={active.includes(ct)}
            onCheckedChange={() => onToggle(ct)}
            onSelect={(e) => e.preventDefault()}
          >
            {ct}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
