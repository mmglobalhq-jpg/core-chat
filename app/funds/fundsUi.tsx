"use client";

/**
 * Building blocks shared by the two /funds tabs (Changes in page.tsx, Holdings in
 * HoldingsTab.tsx). Everything here was lifted out of page.tsx so the tabs cannot
 * drift apart: one authed fetch, one URL-as-state writer, one column-layout
 * persistence scheme, one header, one pagination bar, one way of rendering the
 * security columns (CUSIP, description, type, sector, amount, basis).
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
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
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
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
  MARKET_VALUE_DISCLOSURE,
  UNMAPPED_LABEL,
  formatSecurityType,
  fundDisplayLabel,
  getBasisLabel,
  truncateDecimalTowardZero,
} from "@/lib/fundManager";

// --------------------------------------------------------------------------- //
// Styles + small primitives
// --------------------------------------------------------------------------- //
export const inputCls =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40";
export const filterCls =
  "h-7 w-full min-w-0 rounded border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/40";

export function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

export function ConflictMark({ reason }: { reason: string | null }) {
  return (
    <TriangleAlert
      className="ml-1 inline size-3.5 shrink-0 text-amber-600 dark:text-amber-400"
      aria-label={reason ?? "Metadata conflict"}
    />
  );
}

// --------------------------------------------------------------------------- //
// Fetch + URL state
// --------------------------------------------------------------------------- //
export async function authedFetch(input: string, init?: RequestInit): Promise<Response> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return fetch(input, {
    ...init,
    headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${session?.access_token ?? ""}` },
  });
}

export type PatchUrl = (patch: Record<string, string | null>, mode?: "push" | "replace") => void;

/** The URL is the state: patch params in place, keeping every other one untouched. */
export function usePatchUrl(): PatchUrl {
  const router = useRouter();
  const sp = useSearchParams();
  return useCallback(
    (patch, mode = "replace") => {
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
}

/**
 * Debounce a free-text filter (300 ms) before `apply` writes it to the URL. `apply`
 * is read through a ref so the timer always sees the latest URL.
 */
export function useDebouncedUrlText(value: string, enabled: boolean, apply: (v: string) => void) {
  const applyRef = useRef(apply);
  applyRef.current = apply;
  useEffect(() => {
    if (!enabled) return;
    const t = setTimeout(() => applyRef.current(value), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
}

export type FundOption = { ticker: string; fund_manager: string };

/** Managers + funds for the scope pickers (loaded once). */
export function useFundOptions(handlers: {
  onLatestDate?: (d: string | null) => void;
  onError?: () => void;
} = {}): { managers: string[]; funds: FundOption[] } {
  const [managers, setManagers] = useState<string[]>([]);
  const [funds, setFunds] = useState<FundOption[]>([]);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  useEffect(() => {
    authedFetch("/api/funds/options")
      .then((r) => r.json())
      .then((d) => {
        setManagers(d.managers ?? []);
        setFunds(d.funds ?? []);
        handlersRef.current.onLatestDate?.(d.latestDate ?? null);
      })
      .catch(() => handlersRef.current.onError?.());
  }, []);
  return { managers, funds };
}

/** Fund <option>s: Allspring canonical names with the share-class aliases as hints. */
export function FundOptionList({ funds }: { funds: FundOption[] }) {
  return (
    <>
      {funds.map((f) => {
        const d = fundDisplayLabel(f.ticker);
        const aliasHint = d.aliases.length ? ` (${d.aliases.join(" / ")})` : "";
        return (
          <option key={f.ticker} value={f.ticker} title={d.aliases.join(" / ")}>
            {d.label}
            {aliasHint}
          </option>
        );
      })}
    </>
  );
}

/** Pull a filename out of a Content-Disposition header, if the server sent one. */
function dispositionFilename(res: Response): string | null {
  const cd = res.headers?.get?.("Content-Disposition") ?? "";
  const m = /filename="?([^";]+)"?/i.exec(cd);
  return m ? m[1] : null;
}

/**
 * CSV download with the busy flag and error surfacing both tabs need. `fallbackName`
 * is used when `preferServerName` is false or the server sent no filename.
 */
export function useCsvExport(onError: (message: string | null) => void) {
  const [exporting, setExporting] = useState(false);
  const run = useCallback(
    async (url: string, fallbackName: string, preferServerName = false) => {
      setExporting(true);
      onError(null);
      try {
        const res = await authedFetch(url);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `Export failed (${res.status})`);
        }
        const name = (preferServerName && dispositionFilename(res)) || fallbackName;
        const blob = await res.blob();
        const href = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = href;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(href), 10_000);
      } catch (e) {
        onError(e instanceof Error ? e.message : "Export failed.");
      } finally {
        setExporting(false);
      }
    },
    [onError],
  );
  return { exporting, run };
}

// --------------------------------------------------------------------------- //
// Header + tabs
// --------------------------------------------------------------------------- //
export function FundsHeader({
  onExport,
  exportDisabled,
  exporting,
  columnsMenu,
}: {
  onExport: () => void;
  exportDisabled: boolean;
  exporting: boolean;
  columnsMenu: ReactNode;
}) {
  return (
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
          onClick={onExport}
          disabled={exportDisabled || exporting}
        >
          <Download className="size-4" />
          {exporting ? "Exporting…" : "Export CSV"}
        </Button>
        {columnsMenu}
        <ThemeToggle />
      </div>
    </header>
  );
}

export type FundsTab = "changes" | "holdings";

/**
 * Changes | Holdings. The tabs share only the URL's manager + fund: switching to
 * Holdings adds tab=holdings, switching back removes it, and every other param is
 * left exactly where it was (so an existing Changes query re-runs in the new scope).
 */
export function FundsTabs({ active }: { active: FundsTab }) {
  const patchUrl = usePatchUrl();
  const tabs: { key: FundsTab; label: string }[] = [
    { key: "changes", label: "Changes" },
    { key: "holdings", label: "Holdings" },
  ];
  return (
    <div role="tablist" aria-label="Fund Manager view" className="mb-3 inline-flex rounded-md border border-border p-0.5">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={active === t.key}
          onClick={() => {
            if (active === t.key) return;
            patchUrl({ tab: t.key === "holdings" ? "holdings" : null }, "push");
          }}
          className={cn(
            "rounded px-3 py-1 text-sm font-medium pointer-coarse:min-h-11 pointer-coarse:px-4",
            active === t.key
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// --------------------------------------------------------------------------- //
// Column layout (order / hidden / widths persisted per browser, per tab)
// --------------------------------------------------------------------------- //
export type ColumnDef<K extends string> = {
  key: K;
  label: string;
  align: "left" | "right";
  w: number;
  pinned?: boolean; // pinned columns are always first, never hidden/reordered
  sticky?: boolean; // stays visible on horizontal scroll
  sortable?: boolean;
};

export type Layout<K extends string> = {
  order: K[];
  hidden: K[];
  widths: Partial<Record<K, number>>;
};

export function useColumnLayout<K extends string>(
  storageKey: string,
  columns: readonly ColumnDef<K>[],
  nonPinned: readonly K[],
) {
  const defaultLayout = useCallback(
    (): Layout<K> => ({ order: [...nonPinned], hidden: [], widths: {} }),
    [nonPinned],
  );
  const [layout, setLayout] = useState<Layout<K>>(defaultLayout);

  // Restore the persisted layout, dropping unknown keys and appending new ones.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
      if (saved && Array.isArray(saved.order)) {
        const order = (saved.order as K[]).filter((k) => nonPinned.includes(k));
        for (const k of nonPinned) if (!order.includes(k)) order.push(k);
        setLayout({
          order,
          hidden: ((saved.hidden ?? []) as K[]).filter((k) => nonPinned.includes(k)),
          widths: saved.widths ?? {},
        });
      }
    } catch {
      /* ignore malformed storage */
    }
  }, [storageKey, nonPinned]);

  const persistLayout = useCallback(
    (next: Layout<K>) => {
      setLayout(next);
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        /* ignore */
      }
    },
    [storageKey],
  );

  const widthOf = (k: K): number =>
    layout.widths[k] ?? columns.find((c) => c.key === k)?.w ?? 120;

  function startResize(col: K, e: ReactMouseEvent) {
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
        try {
          localStorage.setItem(storageKey, JSON.stringify(l));
        } catch {
          /* ignore */
        }
        return l;
      });
    };
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function moveColumn(key: K, delta: number) {
    const order = [...layout.order];
    const i = order.indexOf(key);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    persistLayout({ ...layout, order });
  }

  function toggleHidden(key: K) {
    const hidden = layout.hidden.includes(key)
      ? layout.hidden.filter((k) => k !== key)
      : [...layout.hidden, key];
    persistLayout({ ...layout, hidden });
  }

  return {
    layout,
    widthOf,
    startResize,
    moveColumn,
    toggleHidden,
    restore: () => persistLayout(defaultLayout()),
  };
}

/** Left offsets for sticky columns (cumulative widths of the sticky columns before). */
export function stickyOffsets<K extends string>(
  visible: readonly K[],
  isSticky: (k: K) => boolean,
  widthOf: (k: K) => number,
): (number | null)[] {
  let left = 0;
  return visible.map((k) => {
    if (!isSticky(k)) return null;
    const at = left;
    left += widthOf(k);
    return at;
  });
}

export function ColumnsMenu<K extends string>({
  pinned,
  layout,
  labelOf,
  onMove,
  onToggleHidden,
  onRestore,
}: {
  pinned: readonly K[];
  layout: Layout<K>;
  labelOf: (k: K) => string;
  onMove: (k: K, delta: number) => void;
  onToggleHidden: (k: K) => void;
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
        {pinned.map((k) => (
          <DropdownMenuItem key={k} disabled className="opacity-70">
            {labelOf(k)}
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
              aria-label={`Show ${labelOf(k)}`}
            />
            <span className="flex-1 truncate text-sm">{labelOf(k)}</span>
            <button
              type="button"
              className="rounded p-0.5 hover:bg-muted disabled:opacity-30"
              disabled={i === 0}
              onClick={() => onMove(k, -1)}
              aria-label={`Move ${labelOf(k)} up`}
            >
              <MoveUp className="size-3.5" />
            </button>
            <button
              type="button"
              className="rounded p-0.5 hover:bg-muted disabled:opacity-30"
              disabled={i === layout.order.length - 1}
              onClick={() => onMove(k, 1)}
              aria-label={`Move ${labelOf(k)} down`}
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

/** A resizable, optionally sortable, optionally sticky column header. */
export function SortHeader({
  label,
  align,
  sortable,
  active,
  dir,
  stickyLeft,
  onSort,
  onResizeStart,
}: {
  label: string;
  align: "left" | "right";
  sortable: boolean;
  active: boolean;
  dir: string;
  stickyLeft: number | null;
  onSort: () => void;
  onResizeStart: (e: ReactMouseEvent) => void;
}) {
  return (
    <th
      style={stickyLeft != null ? { left: stickyLeft } : undefined}
      className={cn(
        "relative overflow-hidden px-3 py-2 font-medium",
        align === "right" && "text-right",
        stickyLeft != null && "sticky z-20 bg-muted/90",
      )}
    >
      <button
        type="button"
        onClick={onSort}
        disabled={!sortable}
        className={cn(
          "inline-flex max-w-full items-center gap-1 truncate",
          sortable && "hover:text-foreground",
          !sortable && "cursor-default",
          align === "right" && "flex-row-reverse",
        )}
      >
        {label}
        {sortable &&
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
        onMouseDown={onResizeStart}
        className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize touch-none select-none hover:bg-primary/50"
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize ${label} column`}
      />
    </th>
  );
}

// --------------------------------------------------------------------------- //
// Cells
// --------------------------------------------------------------------------- //

/** A body cell: the shared padding, plus sticky placement when given an offset. */
export function DataCell({
  stickyLeft,
  className,
  title,
  children,
}: {
  stickyLeft: number | null;
  className?: string;
  title?: string;
  children: ReactNode;
}) {
  const sticky = stickyLeft != null;
  return (
    <td
      className={cn("px-3 py-1.5", sticky && "sticky z-10 bg-background", className)}
      style={sticky ? { left: stickyLeft } : undefined}
      title={title}
    >
      {children}
    </td>
  );
}

/** The columns both tabs render identically, keyed the same on both. */
export const SECURITY_COLUMNS = [
  "security_id",
  "description",
  "security_type",
  "sector_type",
  "position_amount",
  "comparison_basis",
] as const;
export type SecurityColKey = (typeof SECURITY_COLUMNS)[number];
export function isSecurityColumn(k: string): k is SecurityColKey {
  return (SECURITY_COLUMNS as readonly string[]).includes(k);
}

type SecurityRow = {
  security_id: string;
  description: string | null;
  security_type: string | null;
  sector_type: string | null;
  position_amount: string | null;
  comparison_basis: string | null;
  conflict_fields: string[];
  conflict_reason: string | null;
};

/**
 * Render one of the shared security columns. `sectorConflict` is true when the
 * sector itself is in dispute: the cell then shows the RPC's "Conflicting" in amber
 * instead of treating a null as "Unmapped".
 */
export function SecurityCell({
  colKey,
  row,
  sectorConflict,
  stickyLeft,
}: {
  colKey: SecurityColKey;
  row: SecurityRow;
  sectorConflict: boolean;
  stickyLeft: number | null;
}) {
  const conflicts = new Set(row.conflict_fields);
  switch (colKey) {
    case "security_id":
      return (
        <DataCell stickyLeft={stickyLeft} className="font-mono">
          {row.security_id}
        </DataCell>
      );
    case "description":
      return (
        <DataCell
          stickyLeft={stickyLeft}
          className="overflow-hidden text-ellipsis"
          title={row.description ?? ""}
        >
          {row.description ?? ""}
          {conflicts.has("description") && <ConflictMark reason={row.conflict_reason} />}
        </DataCell>
      );
    case "security_type":
      return (
        <DataCell stickyLeft={stickyLeft}>
          {/* Missing security type → em dash (never a sector/issuer substitute). */}
          {row.security_type == null ? (
            <span className="text-muted-foreground">{formatSecurityType(null)}</span>
          ) : (
            row.security_type
          )}
          {conflicts.has("security_type") && <ConflictMark reason={row.conflict_reason} />}
        </DataCell>
      );
    case "sector_type": {
      const unmapped = row.sector_type == null && !sectorConflict;
      return (
        <DataCell
          stickyLeft={stickyLeft}
          className={cn(
            sectorConflict && "text-amber-600 dark:text-amber-400",
            unmapped && "text-muted-foreground italic",
          )}
        >
          {/* Null sector → "Unmapped" (never stored). */}
          {unmapped ? UNMAPPED_LABEL : (row.sector_type ?? "")}
          {conflicts.has("sector_type") && <ConflictMark reason={row.conflict_reason} />}
        </DataCell>
      );
    }
    case "position_amount":
      return (
        <DataCell stickyLeft={stickyLeft} className="text-right font-mono tabular-nums">
          {row.position_amount == null ? "—" : truncateDecimalTowardZero(row.position_amount)}
        </DataCell>
      );
    case "comparison_basis":
      return (
        <DataCell stickyLeft={stickyLeft}>
          <span className="text-muted-foreground">{getBasisLabel(row.comparison_basis)}</span>
        </DataCell>
      );
  }
}

// --------------------------------------------------------------------------- //
// Notes + pagination
// --------------------------------------------------------------------------- //
export function MarketValueNote() {
  return (
    <div
      className="border-b border-border bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
      role="note"
    >
      {MARKET_VALUE_DISCLOSURE}
    </div>
  );
}

export function PaginationBar({
  total,
  page,
  pageSize,
  totalPages,
  loading,
  onPageSize,
  onPage,
}: {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  loading: boolean;
  onPageSize: (size: string) => void;
  onPage: (page: number) => void;
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] text-sm text-muted-foreground">
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
            className={cn(filterCls, "h-8 w-20 pointer-coarse:h-11")}
            value={pageSize}
            onChange={(e) => onPageSize(e.target.value)}
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
          className="size-8 pointer-coarse:size-11"
          disabled={page <= 1 || loading}
          onClick={() => onPage(page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft className="size-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="size-8 pointer-coarse:size-11"
          disabled={page >= totalPages || loading}
          onClick={() => onPage(page + 1)}
          aria-label="Next page"
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}
