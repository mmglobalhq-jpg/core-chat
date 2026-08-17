"use client";

/**
 * Notes: create, edit, delete.
 *
 * TWO-PANE ON DESKTOP, ONE AT A TIME ON MOBILE. The list and the editor are the
 * same components in both; the phone simply shows whichever one is in focus,
 * because a 375px-wide split view gives neither pane enough room to be usable.
 *
 * SAVING IS DEBOUNCED, AND ALSO FLUSHED ON EXIT. Saving per keystroke would be
 * a request per character; saving only on blur loses work when a phone
 * backgrounds the tab. So: 800ms after typing stops, and unconditionally when
 * the note is switched away from, deleted, or the page is hidden.
 *
 * Mobile rules from core-chat/CLAUDE.md: dvh not vh, safe-area insets at screen
 * edges, 44pt touch targets.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import {
  type Note,
  BODY_MAX,
  TITLE_MAX,
  createNote,
  deleteNote,
  displayTitle,
  formatNoteDate,
  listNotes,
  saveNote,
} from "@/lib/notes";
import { cn } from "@/lib/utils";

const SAVE_DEBOUNCE_MS = 800;

type Status = "loading" | "ready" | "error" | "signedout";

export default function NotesPage() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string>("");
  const [saving, setSaving] = useState(false);

  // The editor's live text. Held here rather than read from `notes` so typing
  // never waits on a round trip.
  const [draft, setDraft] = useState({ title: "", body: "" });

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Read by the flush path, which must not close over a stale draft.
  const pending = useRef<{ id: string; title: string; body: string } | null>(null);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const rows = await listNotes();
      if (rows === null) {
        setStatus("signedout");
        return;
      }
      setNotes(rows);
      setStatus("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Write whatever is pending, now. Safe to call when nothing is pending. */
  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    setSaving(true);
    try {
      const saved = await saveNote(p.id, { title: p.title, body: p.body });
      setNotes((prev) =>
        prev
          .map((n) => (n.id === saved.id ? saved : n))
          .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }, []);

  // A phone backgrounding the tab is the common way to lose an unsaved edit, so
  // flush on hide as well as on unmount.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      void flush();
    };
  }, [flush]);

  const edit = useCallback((fields: { title: string; body: string }) => {
    if (!selectedId) return;
    setDraft(fields);
    pending.current = { id: selectedId, ...fields };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
  }, [selectedId, flush]);

  const select = useCallback(async (note: Note) => {
    await flush(); // the outgoing note's edits land before the incoming one loads
    setSelectedId(note.id);
    setDraft({ title: note.title, body: note.body });
    setError("");
  }, [flush]);

  const onCreate = useCallback(async () => {
    await flush();
    try {
      const note = await createNote();
      setNotes((prev) => [note, ...prev]);
      setSelectedId(note.id);
      setDraft({ title: "", body: "" });
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create that note.");
    }
  }, [flush]);

  const onDelete = useCallback(async (note: Note) => {
    const label = displayTitle(note);
    if (!window.confirm(`Delete "${label}"? This cannot be undone.`)) return;
    // Drop anything queued for this note — otherwise the debounced save would
    // race the delete and resurrect it as a 404.
    if (pending.current?.id === note.id) pending.current = null;
    if (timer.current) clearTimeout(timer.current);
    try {
      await deleteNote(note.id);
      setNotes((prev) => prev.filter((n) => n.id !== note.id));
      if (selectedId === note.id) {
        setSelectedId(null);
        setDraft({ title: "", body: "" });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete that note.");
    }
  }, [selectedId]);

  /** Mobile "All notes" back action: save first, then drop the selection. */
  const clearSelection = useCallback(async () => {
    await flush();
    setSelectedId(null);
  }, [flush]);

  const selected = notes.find((n) => n.id === selectedId) ?? null;

  return (
    <div className="mx-auto flex h-[100dvh] w-full max-w-5xl flex-col px-4 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]">
      <header className="flex items-center justify-between gap-3 border-b border-border pb-3">
        <Link
          href="/"
          className="-m-2 flex min-h-11 items-center gap-2 rounded-lg p-2 text-sm text-muted-foreground hover:bg-muted"
        >
          <ArrowLeft className="size-4" />
          Chat
        </Link>
        <div className="text-xs uppercase tracking-widest text-muted-foreground">
          Notes
        </div>
        <button
          type="button"
          onClick={() => void onCreate()}
          disabled={status !== "ready"}
          className="-m-2 flex min-h-11 items-center gap-1.5 rounded-lg p-2 text-sm text-muted-foreground hover:bg-muted disabled:opacity-40"
        >
          <Plus className="size-4" />
          New
        </button>
      </header>

      {error && (
        <p role="alert" className="border-b border-border py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {status === "loading" && <Message text="Loading…" />}
      {status === "signedout" && <Message text="Sign in to see your notes." />}
      {status === "error" && !error && <Message text="Could not load your notes." />}

      {status === "ready" && (
        <div className="flex min-h-0 flex-1 gap-4 py-3">
          {/* List. Hidden on mobile while a note is open. */}
          <div
            className={cn(
              "min-h-0 w-full shrink-0 overflow-y-auto md:block md:w-72",
              selected && "hidden",
            )}
          >
            {notes.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                No notes yet. Use “New” to write one.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {notes.map((note) => (
                  <li key={note.id}>
                    <div
                      className={cn(
                        "flex items-center gap-2 rounded-lg",
                        note.id === selectedId && "bg-muted",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => void select(note)}
                        className="min-h-11 min-w-0 flex-1 px-2 py-2 text-left"
                      >
                        <span className="block truncate text-sm font-medium text-foreground">
                          {displayTitle(note)}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {formatNoteDate(note.updated_at)}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void onDelete(note)}
                        aria-label={`Delete ${displayTitle(note)}`}
                        className="mr-1 min-h-11 rounded-lg px-2 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Editor. */}
          {selected ? (
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <button
                type="button"
                onClick={() => void clearSelection()}
                className="mb-1 -ml-2 flex min-h-11 w-fit items-center gap-1 rounded-lg px-2 text-sm text-muted-foreground hover:bg-muted md:hidden"
              >
                <ArrowLeft className="size-4" />
                All notes
              </button>
              <input
                value={draft.title}
                onChange={(e) => edit({ ...draft, title: e.target.value })}
                placeholder="Title"
                maxLength={TITLE_MAX}
                aria-label="Note title"
                className="w-full bg-transparent py-2 text-lg font-semibold text-foreground outline-none placeholder:text-muted-foreground"
              />
              <textarea
                value={draft.body}
                onChange={(e) => edit({ ...draft, body: e.target.value })}
                placeholder="Write something…"
                maxLength={BODY_MAX}
                aria-label="Note body"
                className="min-h-0 flex-1 resize-none bg-transparent py-1 text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground"
              />
              <p className="py-1 text-right text-xs text-muted-foreground">
                {saving ? "Saving…" : `Edited ${formatNoteDate(selected.updated_at)}`}
              </p>
            </div>
          ) : (
            <div className="hidden min-w-0 flex-1 items-center justify-center md:flex">
              <p className="text-sm text-muted-foreground">
                Select a note, or create one.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Message({ text }: { text: string }) {
  return <p className="py-12 text-center text-sm text-muted-foreground">{text}</p>;
}
