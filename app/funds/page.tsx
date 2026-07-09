"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  ChevronUp,
  Download,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { useIsAdmin } from "@/lib/useIsAdmin";
import { supabase } from "@/lib/supabaseClient";
import { cn } from "@/lib/utils";

const ALL = "all";
const SECURITY_TYPES = ["UST", "AGY", "MBS", "ACMBS", "CMO", "CMBS", "ABS", "CLO", "CORP", "HY", "SOV", "$MKT"];
const CHANGE_TYPES = ["New", "Old", "Increased", "Decreased", "Unchanged"];
const PRESETS: { key: string; days: number }[] = [
  { key: "1D", days: 1 },
  { key: "7D", days: 7 },
  { key: "30D", days: 30 },
  { key: "1Y", days: 365 },
];

type Manager = { id: string; canonical_name: string };
type Fund = { id: string; ticker: string; fund_name: string | null; manager_id: string };
type Row = {
  ticker: string;
  as_of_date: string;
  cusip: string | null;
  description: string | null;
  security_type: string | null;
  par_value: number | null;
  par_change: number | null;
  change_type: string | null;
  cpn: number | null;
  wam: number | null;
  wala: number | null;
  gen_ticker: string | null;
  cohort: string | null;
  sec_type: string | null;
};
type SortDir = "asc" | "desc";
type Filters = {
  ticker: string;
  cusip: string;
  description: string;
  security_type: string;
  change_type: string;
  par_min: string;
  par_max: string;
  cpn_min: string;
  wam_min: string;
  wala_min: string;
  gen_ticker: string;
  cohort: string;
  sec_type: string;
};
const EMPTY_FILTERS: Filters = {
  ticker: "",
  cusip: "",
  description: "",
  security_type: "",
  change_type: "",
  par_min: "",
  par_max: "",
  cpn_min: "",
  wam_min: "",
  wala_min: "",
  gen_ticker: "",
  cohort: "",
  sec_type: "",
};

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const fmtPar = (v: number | null) => (v == null ? "" : money.format(v));
const fmtChange = (v: number | null) => {
  if (v == null || v === 0) return v === 0 ? "$0" : "";
  const s = money.format(Math.abs(v));
  return v > 0 ? `+${s}` : `-${s}`;
};
const CHANGE_COLOR: Record<string, string> = {
  New: "text-sky-600 dark:text-sky-400",
  Increased: "text-emerald-600 dark:text-emerald-400",
  Decreased: "text-red-600 dark:text-red-400",
  Old: "text-amber-600 dark:text-amber-400",
  Unchanged: "text-muted-foreground",
};

// Table columns (order + default widths). Widths are user-resizable at runtime.
const COLUMNS: { key: string; label: string; align: "left" | "right"; w: number }[] = [
  { key: "ticker", label: "Fund", align: "left", w: 90 },
  { key: "as_of_date", label: "Date", align: "left", w: 108 },
  { key: "cusip", label: "Cusip", align: "left", w: 104 },
  { key: "description", label: "Description", align: "left", w: 260 },
  { key: "security_type", label: "Type", align: "left", w: 76 },
  { key: "par_value", label: "Par Value", align: "right", w: 116 },
  { key: "par_change", label: "Par Change", align: "right", w: 120 },
  { key: "change_type", label: "Change", align: "left", w: 96 },
  { key: "cpn", label: "CPN", align: "right", w: 76 },
  { key: "wam", label: "WAM", align: "right", w: 76 },
  { key: "wala", label: "WALA", align: "right", w: 80 },
  { key: "gen_ticker", label: "TICKER", align: "left", w: 104 },
  { key: "cohort", label: "COHORT", align: "left", w: 120 },
  { key: "sec_type", label: "SEC TYPE", align: "left", w: 100 },
];

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

type EnrichRow = {
  cusip: string;
  security_des: string | null;
  cpn: number | null;
  wam: number | null;
  wala: number | null;
  gen_ticker: string | null;
  cohort: string | null;
  sec_type: string | null;
};

// Minimal robust CSV parser — handles quoted fields (embedded commas/quotes/newlines).
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const cell = (cells: string[], i: number | undefined) => (i === undefined ? "" : (cells[i] ?? "").trim());
const numOrNull = (s: string): number | null => {
  if (s === "") return null;
  const n = Number(s.replace(/[, ]/g, ""));
  return Number.isFinite(n) ? n : null;
};

/** Parse the enrichment CSV, mapping its headers to the enrichment fields. */
function csvToEnrichRows(text: string): EnrichRow[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const H = rows[0].map((h) => h.trim().toUpperCase());
  const at = (name: string) => {
    const i = H.indexOf(name);
    return i === -1 ? undefined : i;
  };
  const c = {
    cusip: at("CUSIP"),
    des: at("SECURITY_DES"),
    cpn: at("CPN"),
    wam: at("MTG_WAM"),
    wala: at("MTG_WALA_CALC"),
    tkr: at("MTG_GEN_TICKER"),
    coh: at("SPEC_COHORT_WATERFALL"),
    typ: at("SECURITY_TYP"),
  };
  if (c.cusip === undefined) return [];
  const out: EnrichRow[] = [];
  for (let r = 1; r < rows.length; r++) {
    const cusip = cell(rows[r], c.cusip);
    if (!cusip) continue;
    out.push({
      cusip,
      security_des: cell(rows[r], c.des) || null,
      cpn: numOrNull(cell(rows[r], c.cpn)),
      wam: numOrNull(cell(rows[r], c.wam)),
      wala: numOrNull(cell(rows[r], c.wala)),
      gen_ticker: cell(rows[r], c.tkr) || null,
      cohort: cell(rows[r], c.coh) || null,
      sec_type: cell(rows[r], c.typ) || null,
    });
  }
  return out;
}

/** Themed labeled control wrapper. */
function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40";
const filterCls =
  "h-7 w-full min-w-0 rounded border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/40";

/** Clickable header that toggles server-side sort on its column. */
function SortHeader({
  col,
  label,
  sort,
  dir,
  onSort,
  onResizeStart,
  align = "left",
}: {
  col: string;
  label: string;
  sort: string;
  dir: SortDir;
  onSort: (col: string) => void;
  onResizeStart?: (col: string, e: ReactMouseEvent) => void;
  align?: "left" | "right";
}) {
  const active = sort === col;
  return (
    <th className={cn("relative overflow-hidden px-3 py-2 font-medium", align === "right" && "text-right")}>
      <button
        type="button"
        onClick={() => onSort(col)}
        className={cn(
          "inline-flex max-w-full items-center gap-1 truncate hover:text-foreground",
          align === "right" && "flex-row-reverse",
        )}
      >
        {label}
        {active ? (
          dir === "asc" ? <ChevronUp className="size-3.5 shrink-0" /> : <ChevronDown className="size-3.5 shrink-0" />
        ) : (
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-40" />
        )}
      </button>
      {/* Drag the right edge to resize this column. */}
      {onResizeStart && (
        <span
          onMouseDown={(e) => onResizeStart(col, e)}
          className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize touch-none select-none hover:bg-primary/50"
          role="separator"
          aria-orientation="vertical"
          aria-label={`Resize ${label} column`}
        />
      )}
    </th>
  );
}

export default function FundsPage() {
  const [managers, setManagers] = useState<Manager[]>([]);
  const [funds, setFunds] = useState<Fund[]>([]);
  const [latestDate, setLatestDate] = useState<string | null>(null);

  const [managerId, setManagerId] = useState<string>(ALL);
  const [fundId, setFundId] = useState<string>(ALL);
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  // false = default "1-day" (latest vs previous snapshot, instant matview);
  // true = explicit range sent to the live per-fund-anchored RPC.
  const [customRange, setCustomRange] = useState(false);
  const [preset, setPreset] = useState<string | null>("1D");

  const [sort, setSort] = useState<string>("par_change");
  const [dir, setDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);
  const [widths, setWidths] = useState<Record<string, number>>(() =>
    Object.fromEntries(COLUMNS.map((c) => [c.key, c.w])),
  );

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [debFilters, setDebFilters] = useState<Filters>(EMPTY_FILTERS);

  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(100);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = useIsAdmin();
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Admin-only: parse an enrichment CSV client-side and upsert it by CUSIP, then
  // re-fetch so the enriched columns show for matched positions.
  async function importData(file: File) {
    setImporting(true);
    setError(null);
    setImportMsg(null);
    try {
      const rows = csvToEnrichRows(await file.text());
      if (rows.length === 0) throw new Error("no rows / missing CUSIP column");
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const res = await fetch("/api/funds/import", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token ?? ""}`,
        },
        body: JSON.stringify({ rows }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? String(res.status));
      setImportMsg(`Imported ${body.imported} CUSIPs.`);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setError(`Import failed${e instanceof Error ? ` (${e.message})` : ""}.`);
    } finally {
      setImporting(false);
    }
  }

  // Admin-only: download every distinct CUSIP as a CSV. Sends the caller's
  // Supabase access token so the route's requireAdmin gate passes.
  async function exportCusips() {
    setExporting(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const res = await fetch("/api/funds/cusips", {
        headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
      });
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "cusips.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoke later — revoking the object URL synchronously right after click
      // can abort the download in some browsers.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setError(`CUSIP export failed${e instanceof Error ? ` (${e.message})` : ""}.`);
    } finally {
      setExporting(false);
    }
  }

  // Load dropdown data + seed the default date boxes (End = latest, Start = 1 prior).
  useEffect(() => {
    fetch("/api/funds/options")
      .then((r) => r.json())
      .then((d) => {
        setManagers(d.managers ?? []);
        setFunds(d.funds ?? []);
        if (d.latestDate) {
          setLatestDate(d.latestDate);
          setEndDate(d.latestDate);
          setStartDate(addDays(d.latestDate, -1));
        }
      })
      .catch(() => setError("Failed to load managers/funds."));
  }, []);

  // Debounce free-text filters so we don't fetch on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebFilters(filters), 350);
    return () => clearTimeout(t);
  }, [filters]);

  const fundsForManager = useMemo(
    () => (managerId === ALL ? funds : funds.filter((f) => f.manager_id === managerId)),
    [funds, managerId],
  );

  // Any change to selection / range / sort / filters returns to page 1.
  useEffect(() => {
    setPage(1);
  }, [managerId, fundId, sort, dir, customRange, startDate, endDate, debFilters]);

  // Fetch the table.
  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({ manager: managerId, fund: fundId, page: String(page), sort, dir });
    if (customRange && startDate && endDate) {
      qs.set("start", startDate);
      qs.set("end", endDate);
    }
    if (debFilters.ticker) qs.set("f_ticker", debFilters.ticker);
    if (debFilters.cusip) qs.set("f_cusip", debFilters.cusip);
    if (debFilters.description) qs.set("f_description", debFilters.description);
    if (debFilters.security_type) qs.set("f_type", debFilters.security_type);
    if (debFilters.change_type) qs.set("f_change", debFilters.change_type);
    if (debFilters.par_min) qs.set("f_par_min", debFilters.par_min);
    if (debFilters.par_max) qs.set("f_par_max", debFilters.par_max);
    if (debFilters.cpn_min) qs.set("f_cpn_min", debFilters.cpn_min);
    if (debFilters.wam_min) qs.set("f_wam_min", debFilters.wam_min);
    if (debFilters.wala_min) qs.set("f_wala_min", debFilters.wala_min);
    if (debFilters.gen_ticker) qs.set("f_gen_ticker", debFilters.gen_ticker);
    if (debFilters.cohort) qs.set("f_cohort", debFilters.cohort);
    if (debFilters.sec_type) qs.set("f_sec_type", debFilters.sec_type);

    fetch(`/api/funds/holdings?${qs}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setRows(d.rows ?? []);
        setTotal(d.total ?? 0);
        setPageSize(d.pageSize ?? 100);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError("Failed to load holdings.");
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [managerId, fundId, page, sort, dir, customRange, startDate, endDate, debFilters, refreshKey]);

  function toggleSort(col: string) {
    if (sort === col) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSort(col);
      setDir(col === "par_value" || col === "par_change" ? "desc" : "asc");
    }
  }

  // Drag a header's right edge to resize that column.
  function startResize(col: string, e: ReactMouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = widths[col] ?? 100;
    const onMove = (ev: MouseEvent) =>
      setWidths((w) => ({ ...w, [col]: Math.max(48, startW + (ev.clientX - startX)) }));
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
    };
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function applyPreset(key: string, days: number) {
    setPreset(key);
    if (key === "1D") {
      // default: latest vs previous snapshot (fast matview path)
      setCustomRange(false);
      if (latestDate) {
        setEndDate(latestDate);
        setStartDate(addDays(latestDate, -1));
      }
    } else if (latestDate) {
      setCustomRange(true);
      setEndDate(latestDate);
      setStartDate(addDays(latestDate, -days));
    }
  }

  function editDate(which: "start" | "end", v: string) {
    setPreset(null);
    setCustomRange(true);
    if (which === "start") setStartDate(v);
    else setEndDate(v);
  }

  const setF = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));

  const managerName = managerId === ALL ? null : managers.find((m) => m.id === managerId)?.canonical_name;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const totalWidth = Object.values(widths).reduce((a, b) => a + b, 0);
  const firstRow = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastRow = Math.min(page * pageSize, total);

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
        <Button asChild variant="ghost" size="icon" className="size-9" aria-label="Back to chat">
          <Link href="/">
            <ArrowLeft className="size-5" />
          </Link>
        </Button>
        <h1 className="text-base font-medium">Fund Holdings</h1>
        <div className="ml-auto flex items-center gap-2">
          {isAdmin && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) importData(f);
                  e.target.value = "";
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => fileInputRef.current?.click()}
                disabled={importing}
              >
                <Upload className="size-4" />
                {importing ? "Importing…" : "Import Data"}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={exportCusips}
                disabled={exporting}
              >
                <Download className="size-4" />
                {exporting ? "Exporting…" : "Export Cusips"}
              </Button>
            </>
          )}
          <ThemeToggle />
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col">
        {/* Controls (30%) */}
        <section className="h-[30%] shrink-0 overflow-auto border-b border-border p-4">
          <div className="flex flex-wrap items-end gap-4">
            <Field label="Fund Manager" className="w-56">
              <select
                className={inputCls}
                value={managerId}
                onChange={(e) => {
                  setManagerId(e.target.value);
                  setFundId(ALL);
                }}
              >
                <option value={ALL}>All Managers</option>
                {managers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.canonical_name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Fund" className="w-64">
              <select className={inputCls} value={fundId} onChange={(e) => setFundId(e.target.value)}>
                <option value={ALL}>All Funds{managerName ? ` (${managerName})` : ""}</option>
                {fundsForManager.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.ticker}
                    {f.fund_name ? ` — ${f.fund_name}` : ""}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Start" className="w-40">
              <input type="date" className={inputCls} value={startDate} max={endDate || undefined} onChange={(e) => editDate("start", e.target.value)} />
            </Field>
            <Field label="End" className="w-40">
              <input type="date" className={inputCls} value={endDate} max={latestDate || undefined} onChange={(e) => editDate("end", e.target.value)} />
            </Field>

            <Field label="Range">
              <div className="flex gap-1">
                {PRESETS.map((p) => (
                  <Button
                    key={p.key}
                    type="button"
                    size="sm"
                    variant={preset === p.key ? "default" : "outline"}
                    onClick={() => applyPreset(p.key, p.days)}
                  >
                    {p.key}
                  </Button>
                ))}
              </div>
            </Field>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Par change &amp; type are computed per fund against its nearest prior snapshot (business days).{" "}
            {customRange
              ? `Range: ${startDate} → ${endDate}.`
              : "Default: latest 1-day change vs each fund's previous snapshot (only when it's within ~2 weeks; funds with no recent prior snapshot show no change)."}
            {importMsg && <span className="ml-1 font-medium text-foreground">{importMsg}</span>}
          </p>
        </section>

        {/* Table (70%) */}
        <section className="flex h-[70%] min-h-0 flex-col">
          <div className="min-h-0 flex-1 overflow-auto">
            <table
              className="table-fixed border-collapse text-sm [&_tbody_td]:overflow-hidden [&_tbody_td]:text-ellipsis [&_tbody_td]:whitespace-nowrap"
              style={{ width: totalWidth }}
            >
              <colgroup>
                {COLUMNS.map((c) => (
                  <col key={c.key} style={{ width: widths[c.key] }} />
                ))}
              </colgroup>
              <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
                <tr className="text-left text-muted-foreground">
                  {COLUMNS.map((c) => (
                    <SortHeader
                      key={c.key}
                      col={c.key}
                      label={c.label}
                      align={c.align}
                      sort={sort}
                      dir={dir}
                      onSort={toggleSort}
                      onResizeStart={startResize}
                    />
                  ))}
                </tr>
                {/* Filter row */}
                <tr className="border-t border-border bg-background/60">
                  <td className="px-2 py-1">
                    <input className={filterCls} placeholder="filter" value={filters.ticker} onChange={(e) => setF({ ticker: e.target.value })} />
                  </td>
                  <td className="px-2 py-1" />
                  <td className="px-2 py-1">
                    <input className={filterCls} placeholder="filter" value={filters.cusip} onChange={(e) => setF({ cusip: e.target.value })} />
                  </td>
                  <td className="px-2 py-1">
                    <input className={filterCls} placeholder="filter" value={filters.description} onChange={(e) => setF({ description: e.target.value })} />
                  </td>
                  <td className="px-2 py-1">
                    <select className={filterCls} value={filters.security_type} onChange={(e) => setF({ security_type: e.target.value })}>
                      <option value="">All</option>
                      {SECURITY_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-1">
                    <input className={cn(filterCls, "text-right")} placeholder="min $" inputMode="numeric" value={filters.par_min} onChange={(e) => setF({ par_min: e.target.value.replace(/[^0-9]/g, "") })} />
                  </td>
                  <td className="px-2 py-1" />
                  <td className="px-2 py-1">
                    <select className={filterCls} value={filters.change_type} onChange={(e) => setF({ change_type: e.target.value })}>
                      <option value="">All</option>
                      {CHANGE_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-1">
                    <input className={cn(filterCls, "text-right")} placeholder="≥" inputMode="decimal"
                      value={filters.cpn_min} onChange={(e) => setF({ cpn_min: e.target.value.replace(/[^0-9.]/g, "") })} />
                  </td>
                  <td className="px-2 py-1">
                    <input className={cn(filterCls, "text-right")} placeholder="≥" inputMode="decimal"
                      value={filters.wam_min} onChange={(e) => setF({ wam_min: e.target.value.replace(/[^0-9.]/g, "") })} />
                  </td>
                  <td className="px-2 py-1">
                    <input className={cn(filterCls, "text-right")} placeholder="≥" inputMode="decimal"
                      value={filters.wala_min} onChange={(e) => setF({ wala_min: e.target.value.replace(/[^0-9.]/g, "") })} />
                  </td>
                  <td className="px-2 py-1">
                    <input className={filterCls} placeholder="filter"
                      value={filters.gen_ticker} onChange={(e) => setF({ gen_ticker: e.target.value })} />
                  </td>
                  <td className="px-2 py-1">
                    <input className={filterCls} placeholder="filter"
                      value={filters.cohort} onChange={(e) => setF({ cohort: e.target.value })} />
                  </td>
                  <td className="px-2 py-1">
                    <input className={filterCls} placeholder="filter"
                      value={filters.sec_type} onChange={(e) => setF({ sec_type: e.target.value })} />
                  </td>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.ticker}-${r.cusip}-${i}`} className="border-t border-border hover:bg-muted/40">
                    <td className="px-3 py-1.5 font-mono">{r.ticker}</td>
                    <td className="px-3 py-1.5 tabular-nums">{r.as_of_date}</td>
                    <td className="px-3 py-1.5 font-mono">{r.cusip ?? ""}</td>
                    <td className="px-3 py-1.5">{r.description ?? ""}</td>
                    <td className="px-3 py-1.5">{r.security_type ?? ""}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">{fmtPar(r.par_value)}</td>
                    <td
                      className={cn(
                        "px-3 py-1.5 text-right font-mono tabular-nums",
                        (r.par_change ?? 0) > 0 && "text-emerald-600 dark:text-emerald-400",
                        (r.par_change ?? 0) < 0 && "text-red-600 dark:text-red-400",
                      )}
                    >
                      {fmtChange(r.par_change)}
                    </td>
                    <td className={cn("px-3 py-1.5", r.change_type ? CHANGE_COLOR[r.change_type] : "")}>{r.change_type ?? ""}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">{r.cpn ?? ""}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">{r.wam ?? ""}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">{r.wala ?? ""}</td>
                    <td className="px-3 py-1.5 font-mono">{r.gen_ticker ?? ""}</td>
                    <td className="px-3 py-1.5">{r.cohort ?? ""}</td>
                    <td className="px-3 py-1.5">{r.sec_type ?? ""}</td>
                  </tr>
                ))}
                {!loading && rows.length === 0 && (
                  <tr>
                    <td colSpan={14} className="px-3 py-10 text-center text-muted-foreground">
                      {error ?? "No holdings for this selection."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {loading && <div className="px-3 py-10 text-center text-sm text-muted-foreground">Loading…</div>}
          </div>

          {/* Pagination */}
          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-4 py-2 text-sm text-muted-foreground">
            <span className={cn(error && "text-destructive")}>
              {error
                ? error
                : total === 0
                  ? "0 rows"
                  : `${firstRow.toLocaleString()}–${lastRow.toLocaleString()} of ${total.toLocaleString()}`}
            </span>
            <div className="flex items-center gap-2">
              <span>
                Page {page} / {totalPages}
              </span>
              <Button variant="outline" size="icon" className="size-8" disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))} aria-label="Previous page">
                <ChevronLeft className="size-4" />
              </Button>
              <Button variant="outline" size="icon" className="size-8" disabled={page >= totalPages || loading} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} aria-label="Next page">
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
