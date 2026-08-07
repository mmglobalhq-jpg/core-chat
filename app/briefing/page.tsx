"use client";

/**
 * The day's briefing.
 *
 * Read-only. Everything shown here came off the public web, so every headline
 * and body is rendered as TEXT — React escapes by default and nothing here uses
 * dangerouslySetInnerHTML. That is not incidental: a headline is
 * attacker-controlled input, and this is the second place (after the email
 * renderer) where it reaches a rendering engine.
 *
 * Mobile rules from core-chat/CLAUDE.md: dvh not vh, safe-area insets at the
 * screen edges, 44pt touch targets.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ExternalLink, RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import {
  type Briefing,
  type BriefingSection,
  deepDive,
  formatBriefingDate,
  sourceLabel,
  topSections,
} from "@/lib/briefing";

export default function BriefingPage() {
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error" | "signedout">("loading");

  const load = useCallback(async () => {
    setState("loading");
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      setState("signedout");
      return;
    }
    try {
      const res = await fetch("/api/briefing", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(String(res.status));
      const body = await res.json();
      setBriefing(body.briefing);
      setState("ready");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-2xl flex-col px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]">
      <header className="flex items-center justify-between gap-3 border-b border-border pb-3">
        <Link
          href="/"
          className="-m-2 flex min-h-11 items-center gap-2 rounded-lg p-2 text-sm text-muted-foreground hover:bg-muted"
        >
          <ArrowLeft className="size-4" />
          Chat
        </Link>
        <div className="text-right">
          <div className="text-xs uppercase tracking-widest text-muted-foreground">
            Daily Briefing
          </div>
          {briefing && (
            <div className="text-sm font-semibold text-foreground">
              {formatBriefingDate(briefing.briefing_date)}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => void load()}
          aria-label="Refresh"
          className="-m-2 min-h-11 rounded-lg p-2 text-muted-foreground hover:bg-muted"
        >
          <RefreshCw className="size-4" />
        </button>
      </header>

      <main className="flex-1 py-4">
        {state === "loading" && <Message text="Loading…" />}
        {state === "signedout" && <Message text="Sign in to see your briefing." />}
        {state === "error" && <Message text="Could not load your briefing." />}
        {state === "ready" && !briefing && (
          <Message text="No briefing yet. Once one has been generated it appears here." />
        )}
        {state === "ready" && briefing && <BriefingBody briefing={briefing} />}
      </main>
    </div>
  );
}

function Message({ text }: { text: string }) {
  return <p className="py-12 text-center text-sm text-muted-foreground">{text}</p>;
}

function BriefingBody({ briefing }: { briefing: Briefing }) {
  const top = topSections(briefing);
  const deep = deepDive(briefing);

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">
          Top {top.length}
        </h2>
        <ol className="divide-y divide-border">
          {top.map((section) => (
            <li key={`${section.kind}-${section.rank}`} className="py-4">
              <div className="flex gap-3">
                <span className="text-sm font-semibold text-muted-foreground">
                  {section.rank}
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-base font-semibold leading-snug text-foreground">
                    {section.headline}
                  </h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    {section.body}
                  </p>
                  <SourceLink section={section} />
                </div>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {deep && (
        <section className="rounded-xl border border-border bg-muted/30 p-4">
          <h2 className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">
            Deep Dive
          </h2>
          <h3 className="text-lg font-semibold leading-snug text-foreground">
            {deep.headline}
          </h3>
          <div className="mt-2 space-y-3">
            {deep.body
              .split("\n")
              .map((p) => p.trim())
              .filter(Boolean)
              .map((paragraph, i) => (
                <p key={i} className="text-sm leading-relaxed text-foreground/90">
                  {paragraph}
                </p>
              ))}
          </div>
          <SourceLink section={deep} />
        </section>
      )}
    </div>
  );
}

function SourceLink({ section }: { section: BriefingSection }) {
  return (
    <a
      href={section.url}
      target="_blank"
      // noreferrer as well as noopener: these are third-party links from feeds we
      // do not control, and there is no reason to leak the referrer to them.
      rel="noopener noreferrer"
      className="mt-2 inline-flex min-h-11 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
    >
      {sourceLabel(section)}
      <ExternalLink className="size-3" />
    </a>
  );
}
