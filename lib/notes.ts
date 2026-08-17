/**
 * Client-side types and fetchers for Notes.
 *
 * Unlike `lib/briefing.ts`, this is read AND write: a note is the user's own
 * text, so the browser is the authoritative source for its content. What the
 * browser is never authoritative about is *whose* note it is — the API derives
 * `user_id` from the verified access token and ignores anything in the body.
 */
import { supabase } from "@/lib/supabaseClient";

export interface Note {
  id: string;
  title: string;
  body: string;
  created_at: string;
  updated_at: string;
}

/** Mirrors the CHECK constraints in migration 0011. Kept in sync deliberately. */
export const TITLE_MAX = 200;
export const BODY_MAX = 100000;

/** What an untitled note is called in the list. Never stored. */
export const UNTITLED = "Untitled note";

export function displayTitle(note: Note): string {
  const t = note.title.trim();
  if (t) return t;
  // Fall back to the first non-empty line of the body, so a note the user never
  // titled is still recognisable in the list.
  const firstLine = note.body.split("\n").map((l) => l.trim()).find(Boolean);
  return firstLine ? firstLine.slice(0, 80) : UNTITLED;
}

export function formatNoteDate(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "";
  const now = new Date();
  const sameDay = parsed.toDateString() === now.toDateString();
  if (sameDay) {
    return parsed.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  return parsed.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: parsed.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

/**
 * Bearer token for the current session.
 *
 * Returns null when signed out rather than throwing: every caller has a
 * signed-out branch to render, and an exception there would surface as a
 * generic error instead of "sign in".
 */
async function authHeader(): Promise<Record<string, string> | null> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : null;
}

/** Thrown with the API's own message, which is written to be shown to a person. */
export class NotesError extends Error {}

async function readError(res: Response, fallback: string): Promise<never> {
  let message = fallback;
  try {
    const body = await res.json();
    if (typeof body?.error === "string") message = body.error;
  } catch {
    // Non-JSON error body — keep the fallback.
  }
  throw new NotesError(message);
}

export async function listNotes(): Promise<Note[] | null> {
  const headers = await authHeader();
  if (!headers) return null;
  const res = await fetch("/api/notes", { headers });
  if (!res.ok) return readError(res, "Could not load your notes.");
  const body = await res.json();
  return (body.notes ?? []) as Note[];
}

export async function createNote(): Promise<Note> {
  const headers = await authHeader();
  if (!headers) throw new NotesError("Sign in to create a note.");
  const res = await fetch("/api/notes", { method: "POST", headers });
  if (!res.ok) return readError(res, "Could not create that note.");
  return (await res.json()).note as Note;
}

export async function saveNote(
  id: string,
  fields: { title: string; body: string },
): Promise<Note> {
  const headers = await authHeader();
  if (!headers) throw new NotesError("Sign in to save.");
  const res = await fetch(`/api/notes/${id}`, {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  });
  if (!res.ok) return readError(res, "Could not save that note.");
  return (await res.json()).note as Note;
}

export async function deleteNote(id: string): Promise<void> {
  const headers = await authHeader();
  if (!headers) throw new NotesError("Sign in to delete.");
  const res = await fetch(`/api/notes/${id}`, { method: "DELETE", headers });
  if (!res.ok) await readError(res, "Could not delete that note.");
}
