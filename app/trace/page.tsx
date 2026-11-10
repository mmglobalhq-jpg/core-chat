"use client";

/**
 * Trace: FINRA TRACE trade history for agency MBS pools, one row per trade.
 *
 * Paste CUSIPs, pick SIFMA business days, get every trade with its own price (in
 * 32nds), size, side and counterparty type. The default range is the current and
 * previous business day.
 *
 * FETCHED IN BATCHES. FINRA's service hangs on long date ranges but answers a
 * one-day query in ~1 s, so the server asks one CUSIP-day at a time. The page splits
 * the search into calls of at most MAX_JOBS CUSIP-days and runs them one after
 * another: each call stays far below Cloudflare's ~100 s origin timeout, and the
 * page can show progress on a long search.
 *
 * Mobile rules from core-chat/CLAUDE.md: dvh not vh, safe-area insets at screen
 * edges, 44pt touch targets on coarse pointers.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { supabase } from "@/lib/supabaseClient";
import { cn } from "@/lib/utils";
import {
  CALENDAR_THROUGH,
  MAX_BUSINESS_DAYS,
  MAX_CUSIPS,
  type LookupResult,
  businessDays,
  defaultRange,
  fmt32,
  fmtDecimal,
  parseCusips,
  planBatches,
  rangeOfBusinessDays,
} from "@/lib/trace/calendar";
import type { TraceTrade } from "@/lib/trace/finra";

const PRESETS = [
  { label: "2 days", n: 2 },
  { label: "1 week", n: 5 },
  { label: "1 month", n: 21 },
  { label: "3 months", n: 63 },
] as const;
const PARTY: Record<string, string> = { C: "Customer", D: "Dealer", A: "Affiliate" };
const STORAGE_KEY = "trace.cusips";

const inputCls =
  "h-9 rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 pointer-coarse:h-11";

class SessionExpired extends Error {}

async function authedPost<T>(url: string, body: unknown, signal: AbortSignal): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(url, {
    method: "POST",
    signal,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (res.status === 401) throw new SessionExpired();
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j?.error) msg = j.error;
    } catch {
      /* ignore parse errors */
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

type Note = { cusip: string; msg: string };
type Result = { trades: TraceTrade[]; notes: Note[]; start: string; end: string; days: number };

const fmtQty = (v: number | null) => (v == null ? "" : v.toLocaleString("en-US"));
const party = (c: string | null) => (c ? (PARTY[c] ?? c) : "");

export default function TracePage() {
  const [cusipText, setCusipText] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [copied, setCopied] = useState(false);
  const datesTouched = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  // Defaults and the last CUSIP list (a per-browser convenience; may be unavailable).
  useEffect(() => {
    const d = defaultRange();
    setStart(d.start);
    setEnd(d.end);
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setCusipText(saved);
    } catch {
      /* storage blocked */
    }
    return () => abortRef.current?.abort();
  }, []);

  const applyPreset = (n: number) => {
    const r = rangeOfBusinessDays(defaultRange().end, n);
    datesTouched.current = true;
    setStart(r.start);
    setEnd(r.end);
  };

  const cusips = useMemo(() => parseCusips(cusipText), [cusipText]);
  const rangeDays = useMemo(
    () => (start && end && start <= end ? businessDays(start, end) : []),
    [start, end],
  );
  const rangeError =
    !start || !end
      ? "Pick a start and end date."
      : start > end
        ? "Start date is after end date."
        : rangeDays.length > MAX_BUSINESS_DAYS
          ? `That range is ${rangeDays.length} business days; the most is ${MAX_BUSINESS_DAYS} (about a year).`
          : rangeDays.length === 0
            ? "No business days in that range."
            : null;
  const cusipError =
    cusips.length > MAX_CUSIPS ? `${cusips.length} CUSIPs entered; the most is ${MAX_CUSIPS}.` : null;

  const run = useCallback(async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setRunning(true);
    setError(null);
    setResult(null);
    setProgress(null);
    try {
      localStorage.setItem(STORAGE_KEY, cusipText);
    } catch {
      /* storage blocked */
    }
    try {
      // The tab may have been open since a prior day: refresh untouched defaults.
      let s = start;
      let e = end;
      if (!datesTouched.current) {
        ({ start: s, end: e } = defaultRange());
        setStart(s);
        setEnd(e);
      }
      const days = businessDays(s, e);

      const { results } = await authedPost<{ results: LookupResult[] }>(
        "/api/trace/lookup",
        { cusips },
        ac.signal,
      );
      const notes: Note[] = [];
      for (const r of results) {
        if (r.status === "invalid") notes.push({ cusip: r.cusip, msg: "Not a valid CUSIP (format or check digit)." });
        else if (r.status === "notfound") notes.push({ cusip: r.cusip, msg: "Not found on FINRA." });
        else if (r.status === "other") notes.push({ cusip: r.cusip, msg: `Type ${r.bondType ?? "unknown"}, not MBS. Skipped.` });
      }
      const mbs = results.filter((r) => r.status === "mbs").map((r) => r.cusip);

      const batches = planBatches(mbs, days);
      const trades: TraceTrade[] = [];
      setProgress({ done: 0, total: batches.length });
      for (const [i, b] of batches.entries()) {
        const r = await authedPost<{ trades: TraceTrade[] }>("/api/trace/trades", b, ac.signal);
        trades.push(...r.trades);
        setProgress({ done: i + 1, total: batches.length });
      }

      const seen = new Set(trades.map((t) => t.cusip));
      for (const c of mbs) if (!seen.has(c)) notes.push({ cusip: c, msg: "No trades in this date range." });
      trades.sort((a, b) =>
        `${b.tradeExecutionDate} ${b.tradeExecutionTime}`.localeCompare(
          `${a.tradeExecutionDate} ${a.tradeExecutionTime}`,
        ),
      );
      setResult({ trades, notes, start: s, end: e, days: days.length });
    } catch (err) {
      if (ac.signal.aborted) return;
      if (err instanceof SessionExpired) setSessionExpired(true);
      else setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      if (abortRef.current === ac) {
        setRunning(false);
        setProgress(null);
      }
    }
  }, [cusipText, cusips, start, end]);

  // Tab-separated so it pastes into Excel as columns. The apostrophe keeps Excel
  // from reading "91-10" as a date; the decimal column stays numeric.
  const copyTable = async () => {
    if (!result) return;
    const head = ["CUSIP", "Trade Date", "Time", "Settle Date", "Quantity", "Price (32nds)",
      "Price (decimal)", "Side", "Reporting Party", "Contra"];
    const lines = [
      head.join("\t"),
      ...result.trades.map((t) =>
        [t.cusip, t.tradeExecutionDate, t.tradeExecutionTime, t.tradeSettlementDate ?? "",
          t.reportedTradeVolume ?? "", t.lastSalePrice == null ? "" : `'${fmt32(t.lastSalePrice)}`,
          t.lastSalePrice ?? "", t.reportingPartySideCode ?? "", party(t.reportingPartyTypeCode),
          party(t.contraPartyTypeCode)].join("\t"),
      ),
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Couldn't copy to the clipboard.");
    }
  };

  const canRun = !running && cusips.length > 0 && !rangeError && !cusipError;
  const nCusips = result ? new Set(result.trades.map((t) => t.cusip)).size : 0;

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      {/* viewportFit "cover": pad past the status bar / notch. */}
      <header className="box-content flex h-14 shrink-0 items-center gap-2 border-b border-border pt-[env(safe-area-inset-top)] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]">
        <Button asChild variant="ghost" size="icon" className="size-9 pointer-coarse:size-11" aria-label="Back to chat">
          <Link href="/">
            <ArrowLeft className="size-5" />
          </Link>
        </Button>
        <h1 className="text-base font-medium">Trace</h1>
        <span className="hidden text-xs text-muted-foreground sm:inline">
          FINRA TRACE · MBS trades · SIFMA business days
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5 pointer-coarse:h-11"
            disabled={!result || result.trades.length === 0}
            onClick={copyTable}
          >
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied ? "Copied" : "Copy table"}
          </Button>
          <ThemeToggle />
        </div>
      </header>

      {sessionExpired ? (
        <div className="grid flex-1 place-items-center px-6 text-center">
          <div className="max-w-sm">
            <p className="text-sm text-muted-foreground">
              Your session has expired. Please sign in again to search TRACE.
            </p>
            <Button asChild variant="outline" className="mt-4">
              <Link href="/login">Go to sign in</Link>
            </Button>
          </div>
        </div>
      ) : (
        <>
          {/* Controls */}
          <section className="shrink-0 border-b border-border px-4 py-3 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]">
            <form
              className="flex flex-col gap-3 md:flex-row md:items-start"
              onSubmit={(e) => {
                e.preventDefault();
                if (canRun) void run();
              }}
            >
              <label className="flex flex-col gap-1.5 md:w-72">
                <span className="text-xs font-medium text-muted-foreground">CUSIPs</span>
                <textarea
                  value={cusipText}
                  onChange={(e) => setCusipText(e.target.value)}
                  placeholder={"31418EBR0\n…"}
                  spellCheck={false}
                  autoCapitalize="characters"
                  autoCorrect="off"
                  rows={4}
                  className="min-h-24 resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-sm uppercase shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                />
                <span className="text-xs text-muted-foreground">
                  {cusipError ?? "One or many — separate with new lines, spaces or commas."}
                </span>
              </label>

              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">Trade dates</span>
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    aria-label="Start date"
                    className={cn(inputCls, "w-40")}
                    value={start}
                    max={CALENDAR_THROUGH}
                    onChange={(e) => {
                      datesTouched.current = true;
                      setStart(e.target.value);
                    }}
                  />
                  <span className="text-xs text-muted-foreground">to</span>
                  <input
                    type="date"
                    aria-label="End date"
                    className={cn(inputCls, "w-40")}
                    value={end}
                    max={CALENDAR_THROUGH}
                    onChange={(e) => {
                      datesTouched.current = true;
                      setEnd(e.target.value);
                    }}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  {PRESETS.map((p) => (
                    <Button
                      key={p.n}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="pointer-coarse:h-11"
                      onClick={() => applyPreset(p.n)}
                    >
                      {p.label}
                    </Button>
                  ))}
                </div>
                <span className="text-xs text-muted-foreground">
                  {rangeError ??
                    `${rangeDays.length} business day${rangeDays.length === 1 ? "" : "s"} (SIFMA calendar)`}
                </span>
              </div>

              <Button type="submit" className="pointer-coarse:h-11 md:mt-6" disabled={!canRun}>
                {running ? "Fetching…" : "Get trades"}
              </Button>
            </form>
          </section>

          {/* Results */}
          <section className="flex min-h-0 flex-1 flex-col">
            {(running || result || error) && (
              <div
                className="shrink-0 border-b border-border px-4 py-2 text-sm text-muted-foreground"
                role="status"
              >
                {running
                  ? progress
                    ? `Querying FINRA… batch ${progress.done} of ${progress.total}`
                    : "Looking up CUSIPs…"
                  : result
                    ? `${result.trades.length.toLocaleString()} trade${result.trades.length === 1 ? "" : "s"} · ${nCusips} CUSIP${nCusips === 1 ? "" : "s"} · ${result.start} to ${result.end} (${result.days} business day${result.days === 1 ? "" : "s"})`
                    : null}
                {error && (
                  <span role="alert" className="text-destructive">
                    {error}
                  </span>
                )}
              </div>
            )}
            {result && result.notes.length > 0 && (
              <div className="shrink-0 border-b border-border bg-muted/30 px-4 py-1.5 text-xs text-muted-foreground">
                {result.notes.map((n) => (
                  <div key={n.cusip}>
                    <span className="font-mono font-medium text-foreground">{n.cusip}</span>: {n.msg}
                  </div>
                ))}
              </div>
            )}

            {!result ? (
              <div className="grid flex-1 place-items-center px-6 text-center text-sm text-muted-foreground">
                {running ? "Fetching trades…" : "Enter CUSIPs and press Get trades."}
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-auto pb-[env(safe-area-inset-bottom)]">
                <table className="w-full border-collapse text-sm">
                  <thead className="sticky top-0 z-10 bg-muted/90 backdrop-blur">
                    <tr className="text-left text-muted-foreground [&_th]:whitespace-nowrap [&_th]:px-3 [&_th]:py-2 [&_th]:text-xs [&_th]:font-medium">
                      <th>CUSIP</th>
                      <th>Trade date</th>
                      <th>Time</th>
                      <th>Settle date</th>
                      <th className="text-right">Quantity</th>
                      <th className="text-right">Price</th>
                      <th>Side</th>
                      <th>Reporting party</th>
                      <th>Contra</th>
                    </tr>
                  </thead>
                  <tbody className="[&_td]:whitespace-nowrap [&_td]:px-3 [&_td]:py-1.5">
                    {result.trades.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="py-12 text-center text-muted-foreground">
                          No trades found.
                        </td>
                      </tr>
                    ) : (
                      result.trades.map((t, i) => (
                        <tr key={i} className="border-t border-border hover:bg-muted/40">
                          <td className="font-mono">{t.cusip}</td>
                          <td className="tabular-nums">{t.tradeExecutionDate}</td>
                          <td className="tabular-nums">{t.tradeExecutionTime}</td>
                          <td className="tabular-nums">{t.tradeSettlementDate}</td>
                          <td className="text-right font-mono tabular-nums">{fmtQty(t.reportedTradeVolume)}</td>
                          <td className="text-right font-mono tabular-nums" title={fmtDecimal(t.lastSalePrice)}>
                            {fmt32(t.lastSalePrice)}
                          </td>
                          <td
                            className={cn(
                              "font-medium",
                              t.reportingPartySideCode === "B" && "text-emerald-600 dark:text-emerald-400",
                              t.reportingPartySideCode === "S" && "text-destructive",
                            )}
                          >
                            {t.reportingPartySideCode}
                          </td>
                          <td>{party(t.reportingPartyTypeCode)}</td>
                          <td>{party(t.contraPartyTypeCode)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
