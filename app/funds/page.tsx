"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowUpDown,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Columns3,
  Download,
  MoveDown,
  MoveUp,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { supabase } from "@/lib/supabaseClient";
import { cn } from "@/lib/utils";
import {
  ALLOWED_PAGE_SIZES,
  CHANGE_TYPES,
  DEFAULT_PAGE_SIZE,
  DEFAULT_SORT_COLUMN,
  MARKET_VALUE_DISCLOSURE,
  UNMAPPED_LABEL,
  UNMAPPED_TOKEN,
  formatSecurityType,
  fundDisplayLabel,
  getAmountLabels,
  getBasisLabel,
  getComparisonMode,
  normalizePositionChangeRow,
  truncateDecimalTowardZero,
  type ChangeRow,
  type ChangesResponse,
  type ComparisonMode,
  type FundStatus,
} from "@/lib/fundManager";

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

type ColDef = {
  key: ColKey;
  label: string;
  align: "left" | "right";
  w: number;
  pinned?: boolean; // pinned columns are always first, never hidden/reordered
  sortable?: boolean;
};

// position_amount/position_change labels are basis-aware at render (see labelFor);
// comparison_basis (Basis) is shown only for mixed-basis results.
const COLUMNS: ColDef[] = [
  { key: "fund_ticker", label: "Fund", align: "left", w: 90, pinned: true },
  { key: "security_id", label: "CUSIP / Security ID", align: "left", w: 170, pinned: true, sortable: true },
  { key: "description", label: "Description", align: "left", w: 280, sortable: true },
  { key: "security_type", label: "Security Type", align: "left", w: 150, sortable: true },
  { key: "sector_type", label: "Sector Type", align: "left", w: 120, sortable: true },
  { key: "position_amount", label: "Position Amount", align: "right", w: 150, sortable: true },
  { key: "position_change", label: "Position Change", align: "right", w: 150, sortable: true },
  { key: "comparison_basis", label: "Basis", align: "left", w: 110 },
  { key: "change_type", label: "Change Type", align: "left", w: 160, sortable: true },
];
const COL_BY_KEY = Object.fromEntries(COLUMNS.map((c) => [c.key, c])) as Record<ColKey, ColDef>;
const PINNED: ColKey[] = COLUMNS.filter((c) => c.pinned).map((c) => c.key);
// The Basis column is auto-managed (shown only for mixed results), so it is kept
// out of the reorder / show-hide machinery.
const NON_PINNED: ColKey[] = COLUMNS.filter(
  (c) => !c.pinned && c.key !== "comparison_basis",
).map((c) => c.key);
const LAYOUT_KEY = "fundmgr:layout";

type Layout = { order: ColKey[]; hidden: ColKey[]; widths: Partial<Record<ColKey, number>> };
const DEFAULT_LAYOUT: Layout = { order: NON_PINNED, hidden: [], widths: {} };

// --------------------------------------------------------------------------- //
// Formatting
// --------------------------------------------------------------------------- //
const PRESETS: { key: string; label: string }[] = [
  { key: "1D", label: "1D" },
  { key: "7D", label: "7D" },
  { key: "30D", label: "30D" },
  { key: "1Y", label: "1Y" },
];

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}
function addYears(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y - n, m - 1, d));
  return dt.toISOString().slice(0, 10);
}
/** Requested start date for a preset relative to a requested end date. */
function presetStart(end: string, key: string): string {
  if (key === "1D") return addDays(end, -1);
  if (key === "7D") return addDays(end, -7);
  if (key === "30D") return addDays(end, -30);
  if (key === "1Y") return addYears(end, 1);
  return end;
}
/** DD/MM/YY display format for resolved dates (never a polling timestamp). */
function fmtDMY(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y.slice(2)}`;
}

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

const inputCls =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40";
const filterCls =
  "h-7 w-full min-w-0 rounded border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/40";

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

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

async function authedFetch(input: string, init?: RequestInit): Promise<Response> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return fetch(input, {
    ...init,
    headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${session?.access_token ?? ""}` },
  });
}

// --------------------------------------------------------------------------- //
// Page
// --------------------------------------------------------------------------- //
export default function FundsPageWrapper() {
  return (
    <Suspense
      fallback={<div className="grid h-dvh place-items-center text-muted-foreground">Loading…</div>}
    >
      <FundManagerPage />
    </Suspense>
  );
}

function FundManagerPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const committed = readCommitted(sp);
  const hasQuery = Boolean(committed.start && committed.end);

  // Options.
  const [managers, setManagers] = useState<string[]>([]);
  const [allFunds, setAllFunds] = useState<{ ticker: string; fund_manager: string }[]>([]);
  const [securityTypes, setSecurityTypes] = useState<string[]>([]);
  const [sectorTypes, setSectorTypes] = useState<string[]>([]);
  const [sectorHasNull, setSectorHasNull] = useState(false);

  // Draft top-controls (edited but not executed until Submit).
  const [draft, setDraft] = useState<Committed>(committed);
  const [scopeLatest, setScopeLatest] = useState<string | null>(null);

  // Results.
  const [data, setData] = useState<ChangesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Column layout (persisted per browser).
  const [layout, setLayout] = useState<Layout>(DEFAULT_LAYOUT);
  // Collapsed fund groups (session only — deliberately not persisted).
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Local text-filter state (debounced into the URL).
  const [qSecurity, setQSecurity] = useState(sp.get("q_security") ?? "");
  const [qDescription, setQDescription] = useState(sp.get("q_description") ?? "");

  const [exporting, setExporting] = useState(false);
  const reqId = useRef(0);

  // Re-sync the draft controls whenever the committed (URL) query changes via
  // navigation or Submit (back/forward restores the controls).
  useEffect(() => {
    setDraft(committed);
    setQSecurity(sp.get("q_security") ?? "");
    setQDescription(sp.get("q_description") ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [committed.manager, committed.fund, committed.start, committed.end, committed.preset]);

  // Load managers + funds + latest once.
  useEffect(() => {
    authedFetch("/api/funds/options")
      .then((r) => r.json())
      .then((d) => {
        setManagers(d.managers ?? []);
        setAllFunds(d.funds ?? []);
        setScopeLatest(d.latestDate ?? null);
      })
      .catch(() => setError("Failed to load managers and funds."));
  }, []);

  // Restore persisted column layout.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) || "null");
      if (saved && Array.isArray(saved.order)) {
        const order = (saved.order as ColKey[]).filter((k) => NON_PINNED.includes(k));
        for (const k of NON_PINNED) if (!order.includes(k)) order.push(k);
        setLayout({
          order,
          hidden: (saved.hidden ?? []).filter((k: ColKey) => NON_PINNED.includes(k)),
          widths: saved.widths ?? {},
        });
      }
    } catch {
      /* ignore malformed storage */
    }
  }, []);

  const persistLayout = useCallback((next: Layout) => {
    setLayout(next);
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, []);

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

  // Filter-option values for the committed scope.
  useEffect(() => {
    if (!hasQuery) return;
    const p = new URLSearchParams();
    if (committed.manager) p.set("manager", committed.manager);
    if (committed.fund) p.set("fund", committed.fund);
    authedFetch(`/api/funds/filter-options?${p}`)
      .then((r) => r.json())
      .then((d) => {
        setSecurityTypes(d.security_types ?? []);
        setSectorTypes(d.sector_types ?? []);
        setSectorHasNull(Boolean(d.sector_has_null));
      })
      .catch(() => {});
  }, [hasQuery, committed.manager, committed.fund]);

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
    const params = new URLSearchParams(spString);
    params.delete("preset");
    authedFetch(`/api/funds/changes?${params}`, { signal: ctrl.signal })
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
  useEffect(() => {
    if (!hasQuery) return;
    const t = setTimeout(() => {
      patchUrl({ q_security: qSecurity || null, page: null }, "replace");
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qSecurity]);
  useEffect(() => {
    if (!hasQuery) return;
    const t = setTimeout(() => {
      patchUrl({ q_description: qDescription || null, page: null }, "replace");
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qDescription]);

  // --- URL writers ------------------------------------------------------- //
  const patchUrl = useCallback(
    (patch: Record<string, string | null>, mode: "push" | "replace" = "replace") => {
      const next = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v == null || v === "") next.delete(k);
        else next.set(k, v);
      }
      const url = `/funds?${next.toString()}`;
      if (mode === "push") router.push(url);
      else router.replace(url);
    },
    [router, sp],
  );

  function submit() {
    if (!draft.start || !draft.end) return;
    // A new comparison is a history entry; filters/sort/page reset.
    const next = new URLSearchParams();
    if (draft.manager) next.set("manager", draft.manager);
    if (draft.fund) next.set("fund", draft.fund);
    next.set("start", draft.start);
    next.set("end", draft.end);
    if (draft.preset) next.set("preset", draft.preset);
    next.set("page", "1");
    next.set("page_size", sp.get("page_size") ?? String(DEFAULT_PAGE_SIZE));
    router.push(`/funds?${next.toString()}`);
  }

  function applyPreset(key: string) {
    const end = draft.end || scopeLatest || "";
    if (!end) {
      setDraft((d) => ({ ...d, preset: key }));
      return;
    }
    setDraft((d) => ({ ...d, preset: key, end, start: presetStart(end, key) }));
  }

  // Default the draft End to the latest available date when empty.
  useEffect(() => {
    if (!draft.end && scopeLatest) setDraft((d) => ({ ...d, end: scopeLatest }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const widthOf = (k: ColKey) => layout.widths[k] ?? COL_BY_KEY[k].w;
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

  function startResize(col: ColKey, e: ReactMouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = widthOf(col);
    const onMove = (ev: MouseEvent) => {
      const w = Math.max(56, startW + (ev.clientX - startX));
      setLayout((l) => ({ ...l, widths: { ...l.widths, [col]: w } }));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      setLayout((l) => {
        const next = l;
        try {
          localStorage.setItem(LAYOUT_KEY, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
    };
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function moveColumn(key: ColKey, delta: number) {
    const order = [...layout.order];
    const i = order.indexOf(key);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    persistLayout({ ...layout, order });
  }
  function toggleHidden(key: ColKey) {
    const hidden = layout.hidden.includes(key)
      ? layout.hidden.filter((k) => k !== key)
      : [...layout.hidden, key];
    persistLayout({ ...layout, hidden });
  }

  function toggleChangeType(ct: string) {
    const set = new Set(activeChangeTypes);
    if (set.has(ct)) set.delete(ct);
    else set.add(ct);
    patchUrl({ change_type: [...set].join(",") || null, page: null }, "replace");
  }

  async function exportCsv() {
    setExporting(true);
    setError(null);
    try {
      const params = new URLSearchParams(spString);
      params.delete("preset");
      params.delete("page");
      params.delete("page_size");
      const res = await authedFetch(`/api/funds/export?${params}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Export failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `fund-position-changes_${committed.start}_${committed.end}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setExporting(false);
    }
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
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
        <Button asChild variant="ghost" size="icon" className="size-9" aria-label="Back to chat">
          <Link href="/">
            <ArrowLeft className="size-5" />
          </Link>
        </Button>
        <h1 className="text-base font-medium">Fund Manager</h1>
        <div className="ml-auto flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={exportCsv}
            disabled={!hasQuery || exporting}
          >
            <Download className="size-4" />
            {exporting ? "Exporting…" : "Export CSV"}
          </Button>
          <ColumnsMenu
            layout={layout}
            onMove={moveColumn}
            onToggleHidden={toggleHidden}
            onRestore={() => persistLayout(DEFAULT_LAYOUT)}
          />
          <ThemeToggle />
        </div>
      </header>

      {/* Controls (~20%) — nothing runs until Submit. */}
      <section className="max-h-[26%] shrink-0 overflow-auto border-b border-border p-4">
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
              {fundsForManager.map((f) => {
                const d = fundDisplayLabel(f.ticker);
                const aliasHint = d.aliases.length ? ` (${d.aliases.join(" / ")})` : "";
                return (
                  <option key={f.ticker} value={f.ticker} title={d.aliases.join(" / ")}>
                    {d.label}
                    {aliasHint}
                  </option>
                );
              })}
            </select>
          </Field>

          <Field label="Start Date" className="w-40">
            <input
              type="date"
              className={inputCls}
              value={draft.start}
              onChange={(e) => setDraft((d) => ({ ...d, start: e.target.value, preset: "" }))}
            />
          </Field>
          <Field label="End Date" className="w-40">
            <input
              type="date"
              className={inputCls}
              value={draft.end}
              onChange={(e) => setDraft((d) => ({ ...d, end: e.target.value, preset: "" }))}
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

          <Button type="button" onClick={submit} disabled={!draft.start || !draft.end || dateRangeInvalid}>
            Submit
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {dateRangeInvalid
            ? "Start Date must be on or before End Date."
            : "Dates are resolved per fund to the latest accepted snapshot on or before each requested date (shown as DD/MM/YY in each fund header). Future dates are allowed."}
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
            {(mode === "market_value" || mode === "mixed") && (
              <div
                className="border-b border-border bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
                role="note"
              >
                {MARKET_VALUE_DISCLOSURE}
              </div>
            )}

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
                      const active = sort === k;
                      return (
                        <th
                          key={k}
                          style={c.pinned ? { left: idx === 0 ? 0 : widthOf("fund_ticker") } : undefined}
                          className={cn(
                            "relative overflow-hidden px-3 py-2 font-medium",
                            c.align === "right" && "text-right",
                            c.pinned && "sticky z-20 bg-muted/90",
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => toggleSort(k)}
                            disabled={!c.sortable}
                            className={cn(
                              "inline-flex max-w-full items-center gap-1 truncate",
                              c.sortable && "hover:text-foreground",
                              !c.sortable && "cursor-default",
                              c.align === "right" && "flex-row-reverse",
                            )}
                          >
                            {labelFor(k)}
                            {c.sortable &&
                              (active ? (
                                dir === "asc" ? (
                                  <ChevronUp className="size-3.5 shrink-0" />
                                ) : (
                                  <ChevronDown className="size-3.5 shrink-0" />
                                )
                              ) : (
                                <ArrowUpDown className="size-3 shrink-0 opacity-40" />
                              ))}
                          </button>
                          <span
                            onMouseDown={(e) => startResize(k, e)}
                            className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize touch-none select-none hover:bg-primary/50"
                            role="separator"
                            aria-orientation="vertical"
                            aria-label={`Resize ${labelFor(k)} column`}
                          />
                        </th>
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
                        fundWidth={widthOf("fund_ticker")}
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

            {/* Pagination */}
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-2 text-sm text-muted-foreground">
              <div className="flex items-center gap-3">
                <span>
                  {total === 0
                    ? "0 rows"
                    : `${((page - 1) * pageSize + 1).toLocaleString()}–${Math.min(
                        page * pageSize,
                        total,
                      ).toLocaleString()} of ${total.toLocaleString()}`}
                </span>
                <label className="flex items-center gap-1">
                  Rows
                  <select
                    className={cn(filterCls, "h-8 w-20")}
                    value={pageSize}
                    onChange={(e) => patchUrl({ page_size: e.target.value, page: "1" }, "replace")}
                  >
                    {ALLOWED_PAGE_SIZES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="flex items-center gap-2">
                <span>
                  Page {page} / {Math.max(1, totalPages)}
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  className="size-8"
                  disabled={page <= 1 || loading}
                  onClick={() => patchUrl({ page: String(page - 1) }, "replace")}
                  aria-label="Previous page"
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="size-8"
                  disabled={page >= totalPages || loading}
                  onClick={() => patchUrl({ page: String(page + 1) }, "replace")}
                  aria-label="Next page"
                >
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
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
  fundWidth,
  collapsed,
  onToggle,
}: {
  ticker: string;
  rows: ChangeRow[];
  status: FundStatus | undefined;
  colSpan: number;
  cols: ColKey[];
  fundWidth: number;
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
              {fmtDMY(status?.actual_start_date ?? null)} → {fmtDMY(status?.actual_end_date ?? null)}
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
                leftOffset={idx === 0 ? 0 : idx === 1 ? fundWidth : null}
              />
            ))}
          </tr>
        ))}
    </>
  );
}

function ConflictMark({ reason }: { reason: string | null }) {
  return (
    <TriangleAlert
      className="ml-1 inline size-3.5 shrink-0 text-amber-600 dark:text-amber-400"
      aria-label={reason ?? "Metadata conflict"}
    />
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
  const conflicts = new Set(row.conflict_fields);
  const pinned = leftOffset != null;
  const base = cn("px-3 py-1.5", pinned && "sticky z-10 bg-background");
  const style = pinned ? { left: leftOffset } : undefined;

  let className = base;
  let content: React.ReactNode = null;
  let title: string | undefined;

  switch (colKey) {
    case "fund_ticker":
      className = cn(base, "font-mono");
      content = row.fund_ticker;
      break;
    case "security_id":
      className = cn(base, "font-mono");
      content = row.security_id;
      break;
    case "description":
      className = cn(base, "overflow-hidden text-ellipsis");
      title = row.description ?? "";
      content = (
        <>
          {row.description ?? ""}
          {conflicts.has("description") && <ConflictMark reason={row.conflict_reason} />}
        </>
      );
      break;
    case "security_type":
      content = (
        <>
          {/* Missing security type → em dash (never a sector/issuer substitute). */}
          {row.security_type == null ? (
            <span className="text-muted-foreground">{formatSecurityType(null)}</span>
          ) : (
            row.security_type
          )}
          {conflicts.has("security_type") && <ConflictMark reason={row.conflict_reason} />}
        </>
      );
      break;
    case "sector_type": {
      const unmapped = row.sector_type == null && row.change_type !== "Metadata Conflict";
      className = cn(
        base,
        row.change_type === "Metadata Conflict" && "text-amber-600 dark:text-amber-400",
        unmapped && "text-muted-foreground italic",
      );
      content = (
        <>
          {/* Null sector → "Unmapped" (never stored). */}
          {row.sector_type == null && row.change_type !== "Metadata Conflict"
            ? UNMAPPED_LABEL
            : (row.sector_type ?? "")}
          {conflicts.has("sector_type") && <ConflictMark reason={row.conflict_reason} />}
        </>
      );
      break;
    }
    case "position_amount":
      className = cn(base, "text-right font-mono tabular-nums");
      content = row.position_amount == null ? "—" : truncateDecimalTowardZero(row.position_amount);
      break;
    case "position_change": {
      const neg = (row.position_change ?? "").trim().startsWith("-");
      className = cn(
        base,
        "text-right font-mono tabular-nums",
        row.position_change != null && !neg && "text-emerald-600 dark:text-emerald-400",
        row.position_change != null && neg && "text-red-600 dark:text-red-400",
      );
      content = row.position_change == null ? "—" : truncateDecimalTowardZero(row.position_change);
      break;
    }
    case "comparison_basis":
      content = <span className="text-muted-foreground">{getBasisLabel(row.comparison_basis)}</span>;
      break;
    case "change_type": {
      const meta = CHANGE_META[row.change_type];
      const Icon = meta?.icon;
      content = (
        <span className={cn("inline-flex items-center gap-1.5", meta?.color)}>
          {Icon && <Icon className="size-3.5 shrink-0" aria-hidden />}
          {row.change_type}
        </span>
      );
      break;
    }
  }

  return (
    <td className={className} style={style} title={title}>
      {content}
    </td>
  );
}

// --------------------------------------------------------------------------- //
// Menus
// --------------------------------------------------------------------------- //
function ColumnsMenu({
  layout,
  onMove,
  onToggleHidden,
  onRestore,
}: {
  layout: Layout;
  onMove: (k: ColKey, delta: number) => void;
  onToggleHidden: (k: ColKey) => void;
  onRestore: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Columns3 className="size-4" />
          Columns
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Pinned</DropdownMenuLabel>
        {PINNED.map((k) => (
          <DropdownMenuItem key={k} disabled className="opacity-70">
            {COL_BY_KEY[k].label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Columns</DropdownMenuLabel>
        {layout.order.map((k, i) => (
          <div key={k} className="flex items-center gap-1 px-2 py-1">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={!layout.hidden.includes(k)}
              onChange={() => onToggleHidden(k)}
              aria-label={`Show ${COL_BY_KEY[k].label}`}
            />
            <span className="flex-1 truncate text-sm">{COL_BY_KEY[k].label}</span>
            <button
              type="button"
              className="rounded p-0.5 hover:bg-muted disabled:opacity-30"
              disabled={i === 0}
              onClick={() => onMove(k, -1)}
              aria-label={`Move ${COL_BY_KEY[k].label} up`}
            >
              <MoveUp className="size-3.5" />
            </button>
            <button
              type="button"
              className="rounded p-0.5 hover:bg-muted disabled:opacity-30"
              disabled={i === layout.order.length - 1}
              onClick={() => onMove(k, 1)}
              aria-label={`Move ${COL_BY_KEY[k].label} down`}
            >
              <MoveDown className="size-3.5" />
            </button>
          </div>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onRestore}>Restore default layout</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

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
