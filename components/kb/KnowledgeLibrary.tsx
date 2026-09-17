"use client";

/**
 * The knowledge base's library: add, replace and remove documents.
 *
 * Replaces the "Knowledge Base" popup that used to open from the sidebar. It now lives
 * on the Knowledge page, beside the chat that reads from it — a side panel on desktop,
 * a sheet on a phone. All state is in useKbLibraryStore so an ingest survives the
 * sheet closing.
 *
 * Replace uploads a new file for an existing document. The knowledge base removes the
 * old version only after the new one has fully ingested, so there is never a moment
 * with neither.
 */
import { useEffect, useRef, useState } from "react";
import { Check, FileText, Loader2, Plus, RefreshCw, Search, Trash2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useIsAdmin } from "@/lib/useIsAdmin";
import type { KbDoc } from "@/lib/kb";
import { useKbLibraryStore, type ItemStatus } from "@/store/useKbLibraryStore";
import { cn } from "@/lib/utils";

const ACCEPT = ".pdf,.docx,.xlsx,.csv,.pptx,.html,.htm,.md,.txt";

export function KnowledgeLibrary() {
  const loadDocs = useKbLibraryStore((s) => s.loadDocs);
  useEffect(() => {
    void loadDocs();
  }, [loadDocs]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <AddSection />
        <DocumentsSection />
      </div>
    </div>
  );
}

function AddSection() {
  const isAdmin = useIsAdmin();
  const uploads = useKbLibraryStore((s) => s.uploads);
  const busy = useKbLibraryStore((s) => s.busy);
  const addFiles = useKbLibraryStore((s) => s.addFiles);
  const removeUpload = useKbLibraryStore((s) => s.removeUpload);
  const ingestAll = useKbLibraryStore((s) => s.ingestAll);
  const [global, setGlobal] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const pending = uploads.filter((u) => u.status !== "ready" && u.status !== "background").length;

  return (
    <section aria-labelledby="kb-add-heading" className="space-y-3">
      <h2 id="kb-add-heading" className="text-sm font-semibold text-foreground">Add documents</h2>

      {isAdmin && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2">
          <div>
            <p className="text-sm font-medium text-foreground">Global</p>
            <p className="text-xs text-muted-foreground">Available to everyone (admin).</p>
          </div>
          <Toggle checked={global} onChange={setGlobal} label="Add as global documents" />
        </div>
      )}

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(Array.from(e.dataTransfer.files)); }}
        className={cn(
          "flex w-full flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed p-6 text-center transition-colors",
          dragging ? "border-ring bg-muted/50" : "border-border hover:bg-muted/30",
        )}
      >
        <Upload className="size-5 text-muted-foreground" />
        <span className="text-sm text-foreground">Drop files or tap to choose</span>
        <span className="text-xs text-muted-foreground">PDF, DOCX, XLSX, CSV, PPTX, HTML, MD, TXT</span>
      </button>
      <input
        ref={inputRef}
        id="kb-add-files"
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => { addFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }}
      />

      {uploads.length > 0 && (
        <ul className="space-y-1.5">
          {uploads.map((u) => (
            <li key={u.key} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-foreground">{u.file.name}</p>
                <StatusLine status={u.status} stage={u.stage} error={u.error} />
              </div>
              <StatusIcon status={u.status} />
              {(u.status === "queued" || u.status === "error") && !busy && (
                <button
                  type="button"
                  aria-label={`Remove ${u.file.name} from the list`}
                  onClick={() => removeUpload(u.key)}
                  className="flex size-11 items-center justify-center rounded text-muted-foreground hover:bg-muted md:size-7"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <Button
        type="button"
        className="w-full"
        onClick={() => void ingestAll(global && isAdmin ? "global" : "private")}
        disabled={busy || pending === 0}
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
        {busy ? "Adding…" : pending > 0 ? `Add ${pending} to knowledge base` : "Add to knowledge base"}
      </Button>
    </section>
  );
}

function DocumentsSection() {
  const isAdmin = useIsAdmin();
  const docs = useKbLibraryStore((s) => s.docs);
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const filtered = (docs ?? []).filter(
    (d) => !q || d.title.toLowerCase().includes(q) || (d.summary ?? "").toLowerCase().includes(q),
  );

  return (
    <section aria-labelledby="kb-docs-heading" className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 id="kb-docs-heading" className="text-sm font-semibold text-foreground">Documents</h2>
        {docs && <span className="text-xs tabular-nums text-muted-foreground">{docs.length}</span>}
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          id="kb-doc-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search documents…"
          aria-label="Search documents"
          className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-base outline-none focus:border-ring md:text-sm"
        />
      </div>

      {docs === null ? (
        <div className="flex justify-center py-8"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
      ) : filtered.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {docs.length === 0 ? "No documents yet. Add some above." : "No documents match."}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {filtered.map((doc) => (
            <DocRow key={doc.id} doc={doc} canEdit={doc.scope === "private" || isAdmin} />
          ))}
        </ul>
      )}
    </section>
  );
}

function DocRow({ doc, canEdit }: { doc: KbDoc; canEdit: boolean }) {
  const replacing = useKbLibraryStore((s) => s.replacing[doc.id]);
  const deleting = useKbLibraryStore((s) => s.deleting.includes(doc.id));
  const replace = useKbLibraryStore((s) => s.replace);
  const remove = useKbLibraryStore((s) => s.remove);
  const fileRef = useRef<HTMLInputElement>(null);
  const [confirming, setConfirming] = useState(false);
  const working = replacing?.status === "working";

  return (
    <li className="rounded-lg border border-border px-3 py-2">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium text-foreground" title={doc.title}>{doc.title}</p>
            {doc.scope === "global" && (
              <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">Global</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">Added {doc.created_at.slice(0, 10)}</p>
          {doc.summary && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{doc.summary}</p>}
          {replacing && (
            <p className={cn("mt-1 text-xs", replacing.status === "error" ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>
              {replacing.status === "error"
                ? `Replace failed: ${replacing.error ?? "unknown error"}. The current version is unchanged.`
                : replacing.status === "background"
                  ? `Replacing with ${replacing.filename} — still processing. The current version stays until it finishes.`
                  : `Replacing with ${replacing.filename}${replacing.stage ? ` — ${replacing.stage}…` : "…"}`}
            </p>
          )}
        </div>
        {canEdit && (
          <div className="flex shrink-0 items-center">
            <input
              ref={fileRef}
              id={`kb-replace-${doc.id}`}
              type="file"
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void replace(doc, f);
              }}
            />
            <button
              type="button"
              aria-label={`Replace ${doc.title}`}
              title="Replace with a new version"
              disabled={working || deleting}
              onClick={() => fileRef.current?.click()}
              className="flex size-11 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50 md:size-8"
            >
              {working ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            </button>
            {confirming ? (
              <button
                type="button"
                onClick={() => { setConfirming(false); void remove(doc); }}
                onBlur={() => setConfirming(false)}
                className="h-11 rounded px-2 text-xs font-medium text-red-600 hover:bg-red-600/10 md:h-8 dark:text-red-400"
              >
                Remove?
              </button>
            ) : (
              <button
                type="button"
                aria-label={`Remove ${doc.title}`}
                title="Remove from the knowledge base"
                disabled={working || deleting}
                onClick={() => setConfirming(true)}
                className="flex size-11 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-red-600 disabled:opacity-50 md:size-8 dark:hover:text-red-400"
              >
                {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              </button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

function StatusLine({ status, stage, error }: { status: ItemStatus; stage?: string; error?: string }) {
  if (status === "error") return <p className="truncate text-xs text-red-600 dark:text-red-400">{error}</p>;
  if (status === "background")
    return <p className="text-xs text-amber-600 dark:text-amber-400">Still processing — it will appear under Documents when ready.</p>;
  if (status === "working" && stage) return <p className="text-xs text-muted-foreground">{stage}…</p>;
  return null;
}

function StatusIcon({ status }: { status: ItemStatus }) {
  if (status === "ready") return <Check className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />;
  if (status === "working") return <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />;
  if (status === "background") return <Loader2 className="size-4 shrink-0 text-amber-500" />;
  if (status === "error") return <X className="size-4 shrink-0 text-red-600 dark:text-red-400" />;
  return null;
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
        checked ? "bg-primary" : "bg-muted-foreground/30",
      )}
    >
      <span className={cn("inline-block size-4 transform rounded-full bg-white transition-transform", checked ? "translate-x-4" : "translate-x-0.5")} />
    </button>
  );
}
