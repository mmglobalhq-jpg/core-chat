"use client";

import { AlertCircle, Check, FileText, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DocumentStatus } from "@/lib/types";

interface DocChipProps {
  filename: string;
  status: DocumentStatus;
  /** When provided, shows a remove "×" (used for pending chips above the input). */
  onRemove?: () => void;
  className?: string;
}

/** A compact chip for an attached document: filetype icon + name + status
 *  (uploading/processing → spinner, ready → check, error → alert). */
export function DocChip({ filename, status, onRemove, className }: DocChipProps) {
  const pending = status === "uploading" || status === "processing";
  return (
    <div
      className={cn(
        "inline-flex max-w-[12rem] items-center gap-1.5 rounded-lg border border-border bg-muted/60 px-2 py-1 text-xs",
        status === "error" && "border-destructive/40",
        className,
      )}
      title={status === "error" ? `${filename} — failed to process` : filename}
    >
      {pending ? (
        <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
      ) : status === "error" ? (
        <AlertCircle className="size-3.5 shrink-0 text-destructive" />
      ) : (
        <FileText className="size-3.5 shrink-0 text-primary" />
      )}
      <span className="truncate">{filename}</span>
      {status === "ready" && <Check className="size-3 shrink-0 text-primary" />}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${filename}`}
          className="ml-0.5 shrink-0 rounded-full p-0.5 text-muted-foreground hover:text-foreground"
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  );
}
