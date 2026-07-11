"use client";

/**
 * Knowledge Base popup (opened from the Apps sidebar). A centered modal with two
 * tabs: "Add Knowledge" (multi-file upload → ingest, per-file progress, admin-only
 * Global toggle) and "Manage Knowledge" (searchable list, delete). All KB calls go
 * through the same-origin /api/kb/* proxies (lib/kb.ts).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, Check, FileText, Loader2, Plus, Search, Trash2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useIsAdmin } from "@/lib/useIsAdmin";
import { cn } from "@/lib/utils";
import {
  deleteKbDocument,
  ingestFile,
  listKbDocuments,
  type KbDoc,
  type KbScope,
} from "@/lib/kb";

type Tab = "add" | "manage";
type FileStatus = "queued" | "working" | "ready" | "error";
interface Item {
  key: string;
  file: File;
  status: FileStatus;
  stage?: string;
  error?: string;
}

export function KnowledgeBaseModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("add");

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Knowledge Base">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-background shadow-xl">
        <div className="flex items-center justify-between border-b border-border p-4">
          <div className="flex items-center gap-2">
            <BookOpen className="size-5 text-primary" />
            <h2 className="text-base font-semibold text-foreground">Knowledge Base</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-muted-foreground hover:bg-muted">
            <X className="size-4" />
          </button>
        </div>

        <div role="tablist" aria-label="Knowledge base sections" className="flex gap-1 border-b border-border p-2">
          <TabButton active={tab === "add"} onClick={() => setTab("add")} icon={<Plus className="size-4" />}>
            Add Knowledge
          </TabButton>
          <TabButton active={tab === "manage"} onClick={() => setTab("manage")} icon={<FileText className="size-4" />}>
            Manage Knowledge
          </TabButton>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {tab === "add" ? <AddTab /> : <ManageTab />}
        </div>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, icon, children }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors",
        active ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/50",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function AddTab() {
  const isAdmin = useIsAdmin();
  const [items, setItems] = useState<Item[]>([]);
  const [global, setGlobal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((files: FileList | null) => {
    if (!files) return;
    const next: Item[] = Array.from(files).map((file) => ({
      key: `${file.name}-${file.size}-${crypto.randomUUID()}`,
      file,
      status: "queued",
    }));
    setItems((prev) => [...prev, ...next]);
  }, []);

  async function ingestAll() {
    setBusy(true);
    const scope: KbScope = global && isAdmin ? "global" : "private";
    for (const item of items) {
      if (item.status === "ready") continue;
      const set = (patch: Partial<Item>) =>
        setItems((prev) => prev.map((it) => (it.key === item.key ? { ...it, ...patch } : it)));
      set({ status: "working", stage: "starting", error: undefined });
      const res = await ingestFile(item.file, scope, (stage) => set({ stage }));
      set(res.ok ? { status: "ready", stage: undefined } : { status: "error", error: res.error });
    }
    setBusy(false);
  }

  const pending = items.filter((i) => i.status !== "ready").length;
  const done = items.filter((i) => i.status === "ready").length;

  return (
    <div className="space-y-4" role="tabpanel" aria-label="Add Knowledge">
      {isAdmin && (
        <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2">
          <div>
            <p className="text-sm font-medium text-foreground">Global knowledge</p>
            <p className="text-xs text-muted-foreground">Make these available to everyone (admin).</p>
          </div>
          <Toggle checked={global} onChange={setGlobal} label="Global knowledge" />
        </div>
      )}

      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 text-center transition-colors",
          dragging ? "border-ring bg-muted/50" : "border-border hover:bg-muted/30",
        )}
      >
        <Upload className="size-6 text-muted-foreground" />
        <p className="text-sm text-foreground">Drag files here, or click to select</p>
        <p className="text-xs text-muted-foreground">PDF, DOCX, XLSX, CSV, PPTX, HTML, MD, TXT — multiple allowed</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }}
        />
      </div>

      {items.length > 0 && (
        <div className="space-y-1.5">
          {items.map((it) => (
            <div key={it.key} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-foreground">{it.file.name}</p>
                {it.status === "working" && (
                  <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
                  </div>
                )}
                {it.status === "error" && <p className="truncate text-xs text-red-600 dark:text-red-400">{it.error}</p>}
                {it.status === "working" && it.stage && <p className="text-xs text-muted-foreground">{it.stage}…</p>}
              </div>
              <StatusIcon status={it.status} />
              {(it.status === "queued" || it.status === "error") && !busy && (
                <button
                  type="button"
                  aria-label="Remove"
                  onClick={() => setItems((prev) => prev.filter((x) => x.key !== it.key))}
                  className="rounded p-1 text-muted-foreground hover:bg-muted"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {items.length === 0 ? "No files selected" : `${done}/${items.length} added`}
        </p>
        <Button type="button" onClick={ingestAll} disabled={busy || pending === 0}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          {busy ? "Adding…" : `Add ${pending || ""} to knowledge base`}
        </Button>
      </div>
    </div>
  );
}

function ManageTab() {
  const isAdmin = useIsAdmin();
  const [docs, setDocs] = useState<KbDoc[] | null>(null);
  const [query, setQuery] = useState("");
  const [deleting, setDeleting] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setDocs(await listKbDocuments());
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function remove(doc: KbDoc) {
    setDeleting((prev) => new Set(prev).add(doc.id));
    const ok = await deleteKbDocument(doc.id, doc.scope);
    if (ok) setDocs((prev) => (prev ? prev.filter((d) => d.id !== doc.id) : prev));
    setDeleting((prev) => { const n = new Set(prev); n.delete(doc.id); return n; });
  }

  const filtered = (docs ?? []).filter((d) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return d.title.toLowerCase().includes(q) || (d.summary ?? "").toLowerCase().includes(q);
  });

  return (
    <div className="space-y-3" role="tabpanel" aria-label="Manage Knowledge">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search documents…"
          className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm outline-none focus:border-ring"
        />
      </div>

      {docs === null ? (
        <div className="flex justify-center py-10"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
      ) : filtered.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {docs.length === 0 ? "No documents in the knowledge base yet." : "No documents match your search."}
        </p>
      ) : (
        <div className="space-y-1.5">
          {filtered.map((doc) => {
            const canDelete = doc.scope === "private" || isAdmin;
            return (
              <div key={doc.id} className="flex items-start gap-2 rounded-lg border border-border px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium text-foreground">{doc.title}</p>
                    {doc.scope === "global" && (
                      <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">Global</span>
                    )}
                  </div>
                  {doc.summary && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{doc.summary}</p>}
                </div>
                {canDelete && (
                  <button
                    type="button"
                    aria-label={`Remove ${doc.title}`}
                    onClick={() => remove(doc)}
                    disabled={deleting.has(doc.id)}
                    className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-red-600 disabled:opacity-50 dark:hover:text-red-400"
                  >
                    {deleting.has(doc.id) ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatusIcon({ status }: { status: FileStatus }) {
  if (status === "ready") return <Check className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />;
  if (status === "working") return <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />;
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
