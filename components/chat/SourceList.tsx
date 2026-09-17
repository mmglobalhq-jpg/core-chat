"use client";

import { useState } from "react";
import { ChevronDown, FileText } from "lucide-react";
import type { KnowledgeSource } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * The passages a Knowledge-chat answer cited, under the answer.
 *
 * Numbered to match the [n] markers in the text. Each opens to the excerpt that was
 * put in front of the model, so a claim can be checked where it is read. Collapsed by
 * default: on a phone a list of excerpts would push the next answer off screen.
 */
export function SourceList({ sources }: { sources: KnowledgeSource[] }) {
  const [open, setOpen] = useState<number | null>(null);
  if (sources.length === 0) return null;
  return (
    <div className="mt-1 flex w-full flex-col gap-1" aria-label="Sources">
      <p className="px-1 text-xs font-medium text-muted-foreground">Sources</p>
      <ul className="flex flex-col gap-1">
        {sources.map((s) => {
          const expanded = open === s.n;
          return (
            <li key={s.n} className="rounded-lg border border-border bg-card">
              <button
                type="button"
                onClick={() => setOpen(expanded ? null : s.n)}
                aria-expanded={expanded}
                className="flex min-h-11 w-full items-center gap-2 px-2.5 py-1.5 text-left text-[13px] md:min-h-8 md:text-xs"
              >
                <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 font-medium tabular-nums text-primary">
                  {s.n}
                </span>
                <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-foreground">{s.title}</span>
                <ChevronDown
                  className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-180")}
                />
              </button>
              {expanded && (
                <p className="border-t border-border px-3 py-2 text-[13px] leading-relaxed text-muted-foreground md:text-xs">
                  {s.excerpt}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
