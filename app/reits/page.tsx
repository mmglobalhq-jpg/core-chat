"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { ReportMarkdown } from "@/components/reits/ReportMarkdown";
import { supabase } from "@/lib/supabaseClient";
import { cn } from "@/lib/utils";

// ---- Browser-side view of the small, stable API contracts ----
type Issuer = { symbol: string; name: string; reportCount: number; latestReportDate: string | null };
type ReportSummary = {
  id: string;
  issuerSymbol: string;
  issuerName: string;
  title: string;
  portfolioDate: string | null;
  publicationDate: string | null;
  version: number | null;
};
type ReportDetail = ReportSummary & { bodyMarkdown: string };

const DEFAULT_ISSUER = "ARR";
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Format a YYYY-MM-DD string without timezone drift, e.g. "May 31, 2026". */
function fmtDate(d: string | null): string | null {
  if (!d) return null;
  const [y, m, day] = d.split("-");
  const mi = Number(m) - 1;
  if (!y || !MONTHS[mi] || !day) return d;
  return `${MONTHS[mi]} ${Number(day)}, ${y}`;
}

class SessionExpired extends Error {}

/** Fetch with the current Supabase bearer token; 401 -> SessionExpired. */
async function authedFetch<T>(url: string, signal?: AbortSignal): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(url, {
    signal,
    cache: "no-store",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (res.status === 401) throw new SessionExpired();
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) msg = body.error;
    } catch {
      /* ignore parse errors */
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

function ReitResearchPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const issuerParam = sp.get("issuer");
  const reportParam = sp.get("report");

  const [issuers, setIssuers] = useState<Issuer[] | null>(null);
  const [issuersError, setIssuersError] = useState<string | null>(null);
  const [reports, setReports] = useState<ReportSummary[] | null>(null);
  const [reportsError, setReportsError] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReportDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  // Bump to force a re-fetch of the issuer list (retry control).
  const [issuersReload, setIssuersReload] = useState(0);

  const onSessionExpired = useCallback(() => setSessionExpired(true), []);

  // Merge a patch into the URL query (drives all selection state).
  const patchUrl = useCallback(
    (patch: Record<string, string | null>, mode: "push" | "replace") => {
      const next = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) next.delete(k);
        else next.set(k, v);
      }
      const qs = next.toString();
      const url = qs ? `/reits?${qs}` : "/reits";
      if (mode === "push") router.push(url);
      else router.replace(url);
    },
    [router, sp],
  );

  // ---- 1) Load the issuer catalog ----
  useEffect(() => {
    const ac = new AbortController();
    setIssuers(null);
    setIssuersError(null);
    authedFetch<{ issuers: Issuer[] }>("/api/reits/issuers", ac.signal)
      .then((r) => setIssuers(r.issuers))
      .catch((e) => {
        if (ac.signal.aborted) return;
        if (e instanceof SessionExpired) return onSessionExpired();
        setIssuersError(e instanceof Error ? e.message : "Failed to load REITs");
        setIssuers([]);
      });
    return () => ac.abort();
  }, [issuersReload, onSessionExpired]);

  // The resolved issuer: URL value if it exists, else ARR, else the first issuer.
  const selectedIssuer = useMemo(() => {
    if (!issuers || issuers.length === 0) return null;
    const byUrl = issuerParam && issuers.find((i) => i.symbol === issuerParam);
    if (byUrl) return byUrl;
    return issuers.find((i) => i.symbol === DEFAULT_ISSUER) ?? issuers[0];
  }, [issuers, issuerParam]);

  // Normalize the URL when the issuer param is absent/invalid.
  useEffect(() => {
    if (!selectedIssuer) return;
    if (issuerParam !== selectedIssuer.symbol) {
      patchUrl({ issuer: selectedIssuer.symbol, report: null }, "replace");
    }
  }, [selectedIssuer, issuerParam, patchUrl]);

  // ---- 2) Load reports for the selected issuer ----
  useEffect(() => {
    if (!selectedIssuer) return;
    const ac = new AbortController();
    setReports(null);
    setReportsError(null);
    authedFetch<{ reports: ReportSummary[] }>(
      `/api/reits/reports?issuer=${encodeURIComponent(selectedIssuer.symbol)}`,
      ac.signal,
    )
      .then((r) => setReports(r.reports))
      .catch((e) => {
        if (ac.signal.aborted) return;
        if (e instanceof SessionExpired) return onSessionExpired();
        setReportsError(e instanceof Error ? e.message : "Failed to load reports");
        setReports([]);
      });
    return () => ac.abort();
  }, [selectedIssuer, onSessionExpired]);

  // The resolved report: URL value if it exists in the list, else the newest.
  const selectedReportId = useMemo(() => {
    if (!reports || reports.length === 0) return null;
    if (reportParam && reports.some((r) => r.id === reportParam)) return reportParam;
    return reports[0].id; // newest first
  }, [reports, reportParam]);

  // Normalize the URL when the report param is absent/invalid (fall back to newest).
  useEffect(() => {
    if (!selectedIssuer || !reports) return;
    if (selectedReportId && reportParam !== selectedReportId) {
      patchUrl({ issuer: selectedIssuer.symbol, report: selectedReportId }, "replace");
    }
  }, [selectedIssuer, reports, selectedReportId, reportParam, patchUrl]);

  // ---- 3) Load the selected report body ----
  useEffect(() => {
    if (!selectedReportId) {
      setDetail(null);
      return;
    }
    const ac = new AbortController();
    setDetailLoading(true);
    setDetailError(null);
    authedFetch<{ report: ReportDetail }>(
      `/api/reits/reports/${encodeURIComponent(selectedReportId)}`,
      ac.signal,
    )
      .then((r) => {
        setDetail(r.report);
        setDetailLoading(false);
      })
      .catch((e) => {
        if (ac.signal.aborted) return;
        setDetailLoading(false);
        if (e instanceof SessionExpired) return onSessionExpired();
        setDetailError(e instanceof Error ? e.message : "Failed to load report");
      });
    return () => ac.abort();
  }, [selectedReportId, onSessionExpired]);

  // ---- Render ----
  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
        <Button asChild variant="ghost" size="icon" className="size-9" aria-label="Back to chat">
          <Link href="/">
            <ArrowLeft className="size-5" />
          </Link>
        </Button>
        <h1 className="text-base font-medium">REIT Research</h1>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
        </div>
      </header>

      {sessionExpired ? (
        <SessionExpiredState />
      ) : (
        <>
          {/* Controls: issuer dropdown + summary meta */}
          <section className="shrink-0 border-b border-border px-4 py-3">
            <div className="flex flex-wrap items-center gap-3">
              <label htmlFor="reit-issuer" className="text-sm font-medium text-muted-foreground">
                REIT
              </label>
              <select
                id="reit-issuer"
                className="h-9 min-w-64 rounded-md border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                value={selectedIssuer?.symbol ?? ""}
                disabled={!issuers || issuers.length === 0}
                onChange={(e) => patchUrl({ issuer: e.target.value, report: null }, "push")}
              >
                {!selectedIssuer && <option value="">Loading…</option>}
                {(issuers ?? []).map((i) => (
                  <option key={i.symbol} value={i.symbol}>
                    {i.name} ({i.symbol})
                  </option>
                ))}
              </select>
              {selectedIssuer && (
                <span className="text-xs text-muted-foreground">
                  {selectedIssuer.reportCount} report{selectedIssuer.reportCount === 1 ? "" : "s"}
                  {selectedIssuer.latestReportDate
                    ? ` · latest ${fmtDate(selectedIssuer.latestReportDate)}`
                    : ""}
                </span>
              )}
            </div>
          </section>

          {/* Body: report list (left / top) + selected report (right / bottom) */}
          <main className="flex min-h-0 flex-1 flex-col md:flex-row">
            <aside className="flex max-h-64 shrink-0 flex-col overflow-auto border-b border-border md:max-h-none md:w-80 md:border-b-0 md:border-r">
              <ReportListPanel
                issuers={issuers}
                issuersError={issuersError}
                reports={reports}
                reportsError={reportsError}
                selectedReportId={selectedReportId}
                onRetryIssuers={() => setIssuersReload((n) => n + 1)}
                onSelect={(id) =>
                  patchUrl({ issuer: selectedIssuer?.symbol ?? DEFAULT_ISSUER, report: id }, "push")
                }
              />
            </aside>

            <div className="min-h-0 flex-1 overflow-auto">
              <ReportViewPanel
                loading={detailLoading}
                error={detailError}
                detail={selectedReportId ? detail : null}
                hasReports={!!reports && reports.length > 0}
              />
            </div>
          </main>
        </>
      )}
    </div>
  );
}

function ReportListPanel({
  issuers,
  issuersError,
  reports,
  reportsError,
  selectedReportId,
  onRetryIssuers,
  onSelect,
}: {
  issuers: Issuer[] | null;
  issuersError: string | null;
  reports: ReportSummary[] | null;
  reportsError: string | null;
  selectedReportId: string | null;
  onRetryIssuers: () => void;
  onSelect: (id: string) => void;
}) {
  if (issuersError) {
    return (
      <ErrorBlock message={issuersError} onRetry={onRetryIssuers} label="Couldn't load REITs" />
    );
  }
  if (issuers && issuers.length === 0) {
    return <InfoBlock message="No REITs are available yet." />;
  }
  if (reportsError) {
    return <InfoBlock message={reportsError} />;
  }
  if (!reports) {
    return <ListSkeleton />;
  }
  if (reports.length === 0) {
    return <InfoBlock message="No reports for this REIT yet." />;
  }
  return (
    <ul className="flex flex-col p-2">
      {reports.map((r) => {
        const active = r.id === selectedReportId;
        return (
          <li key={r.id}>
            <button
              type="button"
              onClick={() => onSelect(r.id)}
              aria-current={active}
              className={cn(
                "w-full rounded-lg px-3 py-2 text-left transition-colors",
                active
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-accent/50 text-foreground",
              )}
            >
              <span className="line-clamp-2 text-sm font-medium">{r.title}</span>
              <span className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                {r.portfolioDate && <span>{fmtDate(r.portfolioDate)}</span>}
                {r.publicationDate && <span>· pub {fmtDate(r.publicationDate)}</span>}
                {r.version != null && r.version > 1 && <span>· v{r.version}</span>}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function ReportViewPanel({
  loading,
  error,
  detail,
  hasReports,
}: {
  loading: boolean;
  error: string | null;
  detail: ReportDetail | null;
  hasReports: boolean;
}) {
  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <InfoBlock message={error} />
      </div>
    );
  }
  if (loading && !detail) {
    return <ReportSkeleton />;
  }
  if (!detail) {
    return (
      <div className="grid h-full place-items-center px-6 py-10 text-sm text-muted-foreground">
        {hasReports ? "Select a report to read it." : "No report selected."}
      </div>
    );
  }
  return (
    <article className="mx-auto max-w-3xl px-6 py-8">
      <h2 className="text-2xl font-semibold leading-snug">{detail.title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        {detail.issuerName} ({detail.issuerSymbol})
        {detail.portfolioDate ? ` · Portfolio as of ${fmtDate(detail.portfolioDate)}` : ""}
        {detail.publicationDate ? ` · Published ${fmtDate(detail.publicationDate)}` : ""}
        {detail.version != null && detail.version > 1 ? ` · v${detail.version}` : ""}
      </p>
      <hr className="my-6 border-border" />
      <ReportMarkdown markdown={detail.bodyMarkdown} />
    </article>
  );
}

function SessionExpiredState() {
  return (
    <div className="grid flex-1 place-items-center px-6 text-center">
      <div className="max-w-sm">
        <p className="text-sm text-muted-foreground">
          Your session has expired. Please sign in again to view REIT research.
        </p>
        <Button asChild variant="outline" className="mt-4">
          <Link href="/login">Go to sign in</Link>
        </Button>
      </div>
    </div>
  );
}

function ErrorBlock({
  message,
  onRetry,
  label,
}: {
  message: string;
  onRetry: () => void;
  label: string;
}) {
  return (
    <div className="p-4 text-sm">
      <p className="font-medium text-foreground">{label}</p>
      <p className="mt-1 text-muted-foreground">{message}</p>
      <Button type="button" variant="outline" size="sm" className="mt-3 gap-2" onClick={onRetry}>
        <RefreshCw className="size-3.5" />
        Retry
      </Button>
    </div>
  );
}

function InfoBlock({ message }: { message: string }) {
  return <p className="p-4 text-sm text-muted-foreground">{message}</p>;
}

function ListSkeleton() {
  return (
    <div className="space-y-2 p-3" aria-hidden>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-12 animate-pulse rounded-lg bg-muted" />
      ))}
    </div>
  );
}

function ReportSkeleton() {
  return (
    <div className="mx-auto max-w-3xl space-y-3 px-6 py-8" aria-hidden>
      <div className="h-7 w-3/4 animate-pulse rounded bg-muted" />
      <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
      <div className="mt-6 space-y-2">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="h-4 animate-pulse rounded bg-muted" />
        ))}
      </div>
    </div>
  );
}

export default function ReitsPage() {
  return (
    <Suspense
      fallback={
        <div className="grid h-dvh place-items-center text-muted-foreground">Loading…</div>
      }
    >
      <ReitResearchPage />
    </Suspense>
  );
}
