"use client";

/**
 * Settings → File Upload. Sends files from the browser (including an iPhone) to
 * the mini PC's Windows folder, C:\Users\MMGlobal\Uploads, and lists/deletes what
 * is already there.
 *
 * Admin-only, but note that the hiding happens in SettingsMenu for tidiness only —
 * the real gate is profiles.is_admin checked in core-heartbeat on every verb.
 * `chat.mmglobal.us` sits behind no Cloudflare Access, so nothing enforced in this
 * file is enforced at all.
 *
 * Files upload one at a time rather than in parallel: each one streams to a 9p
 * mount, and a single sequential stream keeps both the progress readout and the
 * backend's folder-size budget honest.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Check, FileUp, HardDrive, Loader2, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  deleteUpload,
  formatBytes,
  listUploads,
  uploadToMiniPc,
  type StoredUpload,
  type UploadEntry,
} from "@/lib/uploads";

type ItemStatus = "queued" | "uploading" | "done" | "error";

interface Item {
  key: string;
  file: File;
  status: ItemStatus;
  percent: number;
  stored?: StoredUpload;
  error?: string;
}

export function FileUploadSection() {
  const [items, setItems] = useState<Item[]>([]);
  const [files, setFiles] = useState<UploadEntry[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = items.some((i) => i.status === "uploading" || i.status === "queued");

  const refresh = useCallback(async () => {
    setLoadingList(true);
    setFiles(await listUploads());
    setLoadingList(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const patch = useCallback((key: string, next: Partial<Item>) => {
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...next } : i)));
  }, []);

  const enqueue = useCallback(
    async (picked: FileList | File[]) => {
      const queued: Item[] = Array.from(picked).map((file, n) => ({
        key: `${Date.now()}-${n}-${file.name}`,
        file,
        status: "queued",
        percent: 0,
      }));
      if (!queued.length) return;
      setItems((prev) => [...prev, ...queued]);

      for (const item of queued) {
        patch(item.key, { status: "uploading" });
        const res = await uploadToMiniPc(item.file, (percent) => patch(item.key, { percent }));
        patch(
          item.key,
          res.ok
            ? { status: "done", percent: 100, stored: res.stored }
            : { status: "error", error: res.error },
        );
      }
      await refresh();
    },
    [patch, refresh],
  );

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files?.length) void enqueue(e.dataTransfer.files);
  };

  const remove = async (name: string) => {
    setConfirming(null);
    if (await deleteUpload(name)) await refresh();
  };

  return (
    <div className="space-y-5">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "flex flex-col items-center gap-3 rounded-xl border border-dashed p-6 text-center transition-colors",
          dragging ? "border-primary bg-primary/5" : "border-border bg-muted/30",
        )}
      >
        <span className="inline-flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <FileUp className="size-6" />
        </span>
        <div>
          <p className="text-sm font-medium text-foreground">Send files to the mini PC</p>
          <p className="mt-1 text-xs text-muted-foreground">
            They land in <span className="font-mono">C:\Users\MMGlobal\Uploads</span>, up to 100 MB
            each.
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) void enqueue(e.target.files);
            e.target.value = "";
          }}
        />
        {/* min-h-11 ≈ 44pt: the iPhone is a primary client for this panel. */}
        <Button
          type="button"
          size="lg"
          className="min-h-11"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
        >
          <Upload className="size-4" />
          Choose files
        </Button>
      </div>

      {items.length > 0 && (
        <ul className="space-y-2">
          {items.map((item) => (
            <li
              key={item.key}
              className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm"
            >
              <div className="flex items-center gap-2">
                <StatusIcon status={item.status} />
                <span className="min-w-0 flex-1 truncate text-foreground">{item.file.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {item.status === "uploading" ? `${item.percent}%` : formatBytes(item.file.size)}
                </span>
              </div>
              {item.status === "uploading" && (
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-border">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${item.percent}%` }}
                  />
                </div>
              )}
              {item.status === "error" && (
                <p className="mt-1 text-xs text-destructive">{item.error}</p>
              )}
              {/* A renamed file is never a silent surprise — Windows rejects names
                  the browser accepts (CON.txt, trailing dots), and collisions get a
                  suffix rather than overwriting. */}
              {item.status === "done" && item.stored?.rewritten && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Saved as <span className="font-mono">{item.stored.stored_as}</span>
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <HardDrive className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-medium text-foreground">On the mini PC</h3>
          {loadingList && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
        </div>
        {!loadingList && files.length === 0 ? (
          <p className="text-xs text-muted-foreground">The folder is empty.</p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            {files.map((f) => (
              <li key={f.name} className="flex items-center gap-2 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate text-foreground">{f.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatBytes(f.size_bytes)}
                </span>
                {confirming === f.name ? (
                  <span className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      className="min-h-11 md:min-h-0"
                      onClick={() => void remove(f.name)}
                    >
                      Delete
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="min-h-11 md:min-h-0"
                      onClick={() => setConfirming(null)}
                    >
                      Cancel
                    </Button>
                  </span>
                ) : (
                  <button
                    type="button"
                    aria-label={`Delete ${f.name}`}
                    onClick={() => setConfirming(f.name)}
                    className="-m-2 shrink-0 rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-destructive"
                  >
                    <Trash2 className="size-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Files are readable by anyone signed in to the mini PC&rsquo;s Windows account. Admin-only,
        and enforced on the server.
      </p>
    </div>
  );
}

function StatusIcon({ status }: { status: ItemStatus }) {
  if (status === "uploading") return <Loader2 className="size-4 shrink-0 animate-spin text-primary" />;
  if (status === "done") return <Check className="size-4 shrink-0 text-primary" />;
  if (status === "error") return <AlertCircle className="size-4 shrink-0 text-destructive" />;
  return <FileUp className="size-4 shrink-0 text-muted-foreground" />;
}
