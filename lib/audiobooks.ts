/**
 * Client helpers for the Audiobooks page (/audiobooks): talk to /api/audiobooks/* (proxied to core-heartbeat,
 * which hands the work to the mini PC's audiobook worker). The book file itself goes up through the existing
 * Settings → File Upload path (`uploadToMiniPc`), and the finished .m4b comes down through its ticket download
 * (`downloadFromMiniPc`) — this file only adds the job conversation in between.
 */
import { supabase } from "@/lib/supabaseClient";

export type JobState =
  | "starting"
  | "analyzing"
  | "review"
  | "queued"
  | "recording"
  | "assembling"
  | "waiting"
  | "done"
  | "failed"
  | "cancelled";

export interface Chapter {
  i: number;
  title: string;
  chars: number;
  minutes: number;
  preview: string;
  source: string;
  include: boolean;
  reason: string | null;
}

export interface Flag {
  chapter: number;
  title: string;
  expected: string;
  heard: string;
}

export interface Job {
  id: string;
  state: JobState;
  message?: string;
  upload?: string;
  title?: string;
  author?: string;
  voice?: string;
  chapters_found?: number;
  chapters_total?: number;
  chapters_done?: number;
  chars_total?: number;
  chars_done?: number;
  eta_seconds?: number | null;
  created?: number;
  updated?: number;
  done_at?: number;
  output?: string;
  size_bytes?: number;
  hours?: number;
  flags?: Flag[];
  attempts?: number;
  error?: string | null;
  last_error?: string | null;
  cleaned?: boolean;
  chapters?: Chapter[];
}

export interface Voice {
  id: string;
  name: string;
  description: string;
}

export class SessionExpired extends Error {}

/** Andrew's measured speaking rate; used only for the "about N hours" estimate on the review screen. */
export const CHARS_PER_SEC = 17.4;

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const res = await fetch(`/api/audiobooks/${path}`, {
    method,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${session?.access_token ?? ""}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) throw new SessionExpired();
  const data = (await res.json().catch(() => ({}))) as T & { detail?: string; error?: string };
  if (!res.ok) throw new Error(data.detail ?? data.error ?? `Request failed (${res.status})`);
  return data;
}

export const listVoices = () => call<{ default: string; voices: Voice[] }>("GET", "voices");
export const listJobs = async () => (await call<{ jobs: Job[] }>("GET", "jobs")).jobs;
export const getJob = (id: string) => call<Job>("GET", `jobs/${id}`);
export const createJob = async (upload: string) => (await call<{ id: string }>("POST", "jobs", { upload })).id;
export const confirmJob = (id: string, body: { voice: string; title: string; author: string; include: number[] }) =>
  call<{ ok: boolean }>("POST", `jobs/${id}/confirm`, body);
export const jobAction = (id: string, action: "cancel" | "retry") => call<{ ok: boolean }>("POST", `jobs/${id}/${action}`);
export const deleteJob = (id: string) => call<{ ok: boolean }>("DELETE", `jobs/${id}`);

/**
 * A playable URL for a voice's sample. An <audio src> cannot send the Bearer header, so the clip (~170 KB) is
 * fetched with it and played from a blob URL. The caller revokes the URL when done.
 */
export async function voiceSampleUrl(voiceId: string): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const res = await fetch(`/api/audiobooks/voices/${encodeURIComponent(voiceId)}/sample`, {
    headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
  });
  if (res.status === 401) throw new SessionExpired();
  if (!res.ok) throw new Error(`sample unavailable (${res.status})`);
  return URL.createObjectURL(await res.blob());
}

/** "3 h 20 min", "45 min", "under a minute". */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return "under a minute";
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}

/** A job is still moving (the page polls faster while one is). */
export const isActive = (s: JobState) =>
  s === "starting" || s === "analyzing" || s === "queued" || s === "recording" || s === "assembling" || s === "waiting";

export function progressPercent(j: Job): number {
  if (j.state === "done") return 100;
  if (!j.chars_total) return 0;
  return Math.min(99, Math.round(((j.chars_done ?? 0) / j.chars_total) * 100));
}
