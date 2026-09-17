import { create } from "zustand";
import { deleteKbDocument, ingestFile, listKbDocuments, type KbDoc, type KbScope } from "@/lib/kb";

/**
 * Knowledge library state: the document list and every in-flight add or replace.
 *
 * Lives in a store, not in the panel component, because on a phone the panel is a
 * Radix Sheet and Radix unmounts a closed Sheet's children (core-chat/CLAUDE.md). An
 * ingest takes minutes; closing the sheet must not throw away its progress or strand
 * the job without anyone watching it.
 */

export type ItemStatus = "queued" | "working" | "ready" | "background" | "error";

export interface UploadItem {
  key: string;
  file: File;
  status: ItemStatus;
  stage?: string;
  error?: string;
}

export interface ReplaceState {
  filename: string;
  status: ItemStatus;
  stage?: string;
  error?: string;
}

interface KbLibraryState {
  docs: KbDoc[] | null;
  uploads: UploadItem[];
  /** In-flight or finished replacements, keyed by the document being replaced. */
  replacing: Record<string, ReplaceState>;
  deleting: string[];
  busy: boolean;

  loadDocs: () => Promise<void>;
  addFiles: (files: File[]) => void;
  removeUpload: (key: string) => void;
  ingestAll: (scope: KbScope) => Promise<void>;
  replace: (doc: KbDoc, file: File) => Promise<void>;
  remove: (doc: KbDoc) => Promise<void>;
}

export const useKbLibraryStore = create<KbLibraryState>((set, get) => ({
  docs: null,
  uploads: [],
  replacing: {},
  deleting: [],
  busy: false,

  loadDocs: async () => {
    set({ docs: await listKbDocuments() });
  },

  addFiles: (files) => {
    const next: UploadItem[] = files.map((file) => ({
      key: `${file.name}-${file.size}-${crypto.randomUUID()}`,
      file,
      status: "queued",
    }));
    set((s) => ({ uploads: [...s.uploads, ...next] }));
  },

  removeUpload: (key) => set((s) => ({ uploads: s.uploads.filter((u) => u.key !== key) })),

  ingestAll: async (scope) => {
    if (get().busy) return;
    set({ busy: true });
    const patch = (key: string, p: Partial<UploadItem>) =>
      set((s) => ({ uploads: s.uploads.map((u) => (u.key === key ? { ...u, ...p } : u)) }));
    for (const item of get().uploads) {
      if (item.status === "ready" || item.status === "background") continue;
      patch(item.key, { status: "working", stage: "starting", error: undefined });
      const res = await ingestFile(item.file, scope, (stage) => patch(item.key, { stage }));
      patch(
        item.key,
        res.ok
          ? { status: res.pending ? "background" : "ready", stage: undefined }
          : { status: "error", error: res.error },
      );
      if (res.ok && !res.pending) void get().loadDocs();
    }
    set({ busy: false });
  },

  replace: async (doc, file) => {
    const setState = (p: Partial<ReplaceState>) =>
      set((s) => ({
        replacing: { ...s.replacing, [doc.id]: { ...(s.replacing[doc.id] ?? { filename: file.name, status: "working" }), ...p } },
      }));
    setState({ filename: file.name, status: "working", stage: "starting", error: undefined });
    const res = await ingestFile(file, doc.scope, (stage) => setState({ stage }), doc.id);
    if (!res.ok) {
      setState({ status: "error", error: res.error, stage: undefined });
      return;
    }
    if (res.pending) {
      setState({ status: "background", stage: undefined });
      return;
    }
    // The old document is gone and the new one exists: refresh, then drop the marker.
    await get().loadDocs();
    set((s) => {
      const rest = { ...s.replacing };
      delete rest[doc.id];
      return { replacing: rest };
    });
  },

  remove: async (doc) => {
    set((s) => ({ deleting: [...s.deleting, doc.id] }));
    const ok = await deleteKbDocument(doc.id, doc.scope);
    set((s) => ({
      deleting: s.deleting.filter((id) => id !== doc.id),
      docs: ok && s.docs ? s.docs.filter((d) => d.id !== doc.id) : s.docs,
    }));
  },
}));
