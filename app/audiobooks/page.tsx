"use client";

/**
 * Audiobooks: turn an EPUB into a chaptered audiobook on the mini PC, then download it.
 *
 *   1. Choose an EPUB → it uploads to the mini PC (same path as Settings → File Upload).
 *   2. The worker reads it and lists the chapters it found (ads, excerpts and copyright pages start unticked).
 *   3. Check the chapters, fix the title, pick a voice (each has a sample), Start.
 *   4. Watch progress here (or wait for the email); when done, Download → BookPlayer.
 *
 * The work runs in audiobook-worker.service on the mini PC, one book at a time, and survives reboots; this page
 * only shows its status (polled). Admin-only — enforced in core-heartbeat; a non-admin sees the 403 message.
 *
 * Mobile rules from core-chat/CLAUDE.md: dvh not vh, safe-area insets at screen edges, 44pt touch targets on
 * coarse pointers.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  Download,
  Headphones,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { cn } from "@/lib/utils";
import { downloadFromMiniPc, formatBytes, uploadToMiniPc } from "@/lib/uploads";
import {
  CHARS_PER_SEC,
  type Job,
  type JobState,
  SessionExpired,
  type Voice,
  confirmJob,
  createJob,
  deleteJob,
  formatDuration,
  getJob,
  isActive,
  jobAction,
  listJobs,
  listVoices,
  progressPercent,
  voiceSampleUrl,
} from "@/lib/audiobooks";

const STATE_LABEL: Record<JobState, string> = {
  starting: "Starting",
  analyzing: "Reading the book",
  review: "Needs your review",
  queued: "Waiting its turn",
  recording: "Recording",
  assembling: "Finishing",
  waiting: "Paused — voice service",
  done: "Ready",
  failed: "Failed",
  cancelled: "Cancelled",
};

const inputCls =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 pointer-coarse:h-11";
const gutter = "pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]";

function StateBadge({ state }: { state: JobState }) {
  const tone =
    state === "done"
      ? "bg-primary text-primary-foreground"
      : state === "failed"
        ? "bg-destructive text-white"
        : state === "review"
          ? "border border-primary text-primary"
          : "bg-muted text-muted-foreground";
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", tone)}>
      {(state === "recording" || state === "analyzing" || state === "assembling" || state === "starting") && (
        <Loader2 className="size-3 animate-spin" />
      )}
      {STATE_LABEL[state] ?? state}
    </span>
  );
}

export default function AudiobooksPage() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [voices, setVoices] = useState<{ default: string; voices: Voice[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [upload, setUpload] = useState<{ name: string; percent: number } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // job id with an action in flight
  const fileRef = useRef<HTMLInputElement>(null);

  const handleError = useCallback((e: unknown) => {
    if (e instanceof SessionExpired) setSessionExpired(true);
    else setError(e instanceof Error ? e.message : String(e));
  }, []);

  const refresh = useCallback(async () => {
    try {
      setJobs(await listJobs());
      setError(null);
    } catch (e) {
      handleError(e);
    }
  }, [handleError]);

  useEffect(() => {
    void refresh();
    listVoices().then(setVoices).catch(() => undefined); // the jobs call reports any access problem
  }, [refresh]);

  // Poll: quickly while something is starting or being read, slower while recording, rarely when idle.
  const fast = jobs?.some((j) => j.state === "starting" || j.state === "analyzing") || busy !== null;
  const active = jobs?.some((j) => isActive(j.state));
  useEffect(() => {
    if (sessionExpired) return;
    const t = setTimeout(() => void refresh(), fast ? 3000 : active ? 10000 : 30000);
    return () => clearTimeout(t);
  }, [jobs, fast, active, refresh, sessionExpired]);

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".epub")) {
      setError("Choose an EPUB file (.epub).");
      return;
    }
    setError(null);
    setUpload({ name: file.name, percent: 0 });
    const r = await uploadToMiniPc(file, (percent) => setUpload({ name: file.name, percent }));
    if (!r.ok || !r.stored) {
      setUpload(null);
      setError(`Upload failed: ${r.error ?? "unknown error"}`);
      return;
    }
    try {
      const id = await createJob(r.stored.stored_as);
      setOpenId(id);
      await refresh();
    } catch (e) {
      handleError(e);
    } finally {
      setUpload(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function run(id: string, fn: () => Promise<unknown>) {
    setBusy(id);
    try {
      await fn();
      await refresh();
    } catch (e) {
      handleError(e);
    } finally {
      // Leave "busy" on briefly so the page polls fast while the worker picks the request up.
      setTimeout(() => setBusy((b) => (b === id ? null : b)), 6000);
    }
  }

  async function download(name: string) {
    const r = await downloadFromMiniPc(name);
    if (!r.ok) setError(`Download failed: ${r.error}`);
  }

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header
        className={cn(
          "box-content flex h-14 shrink-0 items-center gap-2 border-b border-border pt-[env(safe-area-inset-top)]",
          gutter,
        )}
      >
        <Button asChild variant="ghost" size="icon" className="size-9 pointer-coarse:size-11" aria-label="Back to chat">
          <Link href="/">
            <ArrowLeft className="size-5" />
          </Link>
        </Button>
        <h1 className="text-base font-medium">Audiobooks</h1>
        <span className="hidden text-xs text-muted-foreground sm:inline">EPUB → audiobook, made on the mini PC</span>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </header>

      {sessionExpired ? (
        <div className="grid flex-1 place-items-center px-6 text-center">
          <div className="max-w-sm">
            <p className="text-sm text-muted-foreground">Your session has expired. Please sign in again.</p>
            <Button asChild variant="outline" className="mt-4">
              <Link href="/login">Go to sign in</Link>
            </Button>
          </div>
        </div>
      ) : (
        <main className={cn("min-h-0 flex-1 overflow-y-auto pb-[max(1.5rem,env(safe-area-inset-bottom))]", gutter)}>
          <div className="mx-auto flex max-w-3xl flex-col gap-4 py-4">
            {/* New book */}
            <section className="rounded-lg border border-border p-4">
              <h2 className="text-sm font-medium">New audiobook</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Choose an EPUB. You&apos;ll check the chapters and pick a voice before recording starts.
              </p>
              <input
                ref={fileRef}
                type="file"
                accept=".epub,application/epub+zip"
                className="hidden"
                onChange={(e) => void onFile(e.target.files?.[0])}
              />
              {upload ? (
                <div className="mt-3">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span className="truncate">Uploading {upload.name}</span>
                    <span>{upload.percent}%</span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                    <div className="h-full bg-primary transition-all" style={{ width: `${upload.percent}%` }} />
                  </div>
                </div>
              ) : (
                <Button type="button" className="mt-3 gap-2 pointer-coarse:h-11" onClick={() => fileRef.current?.click()}>
                  <Upload className="size-4" /> Choose EPUB
                </Button>
              )}
            </section>

            {error && (
              <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/50 p-3 text-sm text-destructive">
                <span className="flex-1">{error}</span>
                <button type="button" aria-label="Dismiss" className="p-1" onClick={() => setError(null)}>
                  <X className="size-4" />
                </button>
              </div>
            )}

            {/* Books */}
            {jobs === null && !error && <p className="text-sm text-muted-foreground">Loading…</p>}
            {jobs?.length === 0 && <p className="text-sm text-muted-foreground">No audiobooks yet.</p>}
            {jobs?.map((j) => (
              <JobCard
                key={j.id}
                job={j}
                open={openId === j.id}
                busy={busy === j.id}
                voices={voices}
                onToggle={() => setOpenId((o) => (o === j.id ? null : j.id))}
                onConfirm={(body) => run(j.id, () => confirmJob(j.id, body))}
                onCancel={() => run(j.id, () => jobAction(j.id, "cancel"))}
                onRetry={() => run(j.id, () => jobAction(j.id, "retry"))}
                onDelete={() => run(j.id, () => deleteJob(j.id))}
                onDownload={() => j.output && void download(j.output)}
                onError={handleError}
              />
            ))}
          </div>
        </main>
      )}
    </div>
  );
}

function JobCard(props: {
  job: Job;
  open: boolean;
  busy: boolean;
  voices: { default: string; voices: Voice[] } | null;
  onToggle: () => void;
  onConfirm: (body: { voice: string; title: string; author: string; include: number[] }) => void;
  onCancel: () => void;
  onRetry: () => void;
  onDelete: () => void;
  onDownload: () => void;
  onError: (e: unknown) => void;
}) {
  const { job: j } = props;
  const title = j.title || j.upload || "Book";
  const pct = progressPercent(j);
  const showProgress = j.state === "recording" || j.state === "assembling" || j.state === "waiting" || j.state === "queued";
  const canCancel = isActive(j.state) && j.state !== "starting" && j.state !== "analyzing";
  const canRetry = (j.state === "failed" || j.state === "cancelled" || j.state === "waiting") && (j.chars_total ?? 0) > 0;
  const iconBtn = "gap-1.5 pointer-coarse:h-11";

  return (
    <section className="rounded-lg border border-border">
      <div className="flex flex-col gap-2 p-4">
        <div className="flex items-start gap-3">
          <Headphones className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{title}</p>
            {j.author && <p className="truncate text-sm text-muted-foreground">{j.author}</p>}
          </div>
          <StateBadge state={j.state} />
        </div>

        {j.message && j.state !== "done" && <p className="text-sm text-muted-foreground">{j.message}</p>}
        {j.state === "failed" && j.error && <p className="text-xs break-words text-destructive">{j.error}</p>}

        {showProgress && (
          <div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
            </div>
            <div className="mt-1 flex flex-wrap justify-between gap-x-3 text-xs text-muted-foreground">
              <span>
                {pct}% · {j.chapters_done ?? 0} of {j.chapters_total ?? "?"} chapters
              </span>
              {j.eta_seconds != null && j.eta_seconds > 0 && j.state !== "waiting" && (
                <span>about {formatDuration(j.eta_seconds)} left</span>
              )}
            </div>
          </div>
        )}

        {j.state === "done" && (
          <p className="text-sm text-muted-foreground">
            {j.hours != null && `${j.hours} hours`}
            {j.size_bytes != null && ` · ${formatBytes(j.size_bytes)}`}
            {j.output && ` · ${j.output}`}
          </p>
        )}
        {j.state === "done" && (j.flags?.length ?? 0) > 0 && (
          <details className="rounded-md bg-muted/50 p-2 text-xs">
            <summary className="cursor-pointer">
              {j.flags!.length} spot{j.flags!.length > 1 ? "s" : ""} where a passage may end early — worth a listen
            </summary>
            <ul className="mt-2 flex flex-col gap-1">
              {j.flags!.map((f, k) => (
                <li key={k}>
                  <span className="font-medium">{f.title}</span>: should end “…{f.expected}”
                </li>
              ))}
            </ul>
          </details>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          {j.state === "review" && (
            <Button type="button" size="sm" className={iconBtn} onClick={props.onToggle}>
              {props.open ? "Hide review" : "Review & start"}
            </Button>
          )}
          {j.state === "done" && j.output && (
            <Button type="button" size="sm" className={iconBtn} onClick={props.onDownload}>
              <Download className="size-4" /> Download
            </Button>
          )}
          {canRetry && (
            <Button type="button" size="sm" variant="outline" className={iconBtn} disabled={props.busy} onClick={props.onRetry}>
              <RotateCcw className="size-4" /> {j.state === "waiting" ? "Try now" : "Retry"}
            </Button>
          )}
          {canCancel && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className={iconBtn}
              disabled={props.busy}
              onClick={() => window.confirm(`Stop recording "${title}"? You can resume it later with Retry.`) && props.onCancel()}
            >
              <X className="size-4" /> Cancel
            </Button>
          )}
          {!isActive(j.state) && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className={cn(iconBtn, "text-muted-foreground")}
              disabled={props.busy}
              onClick={() =>
                window.confirm(
                  j.state === "done"
                    ? `Remove "${title}" from this list? The audiobook file stays in File Upload.`
                    : `Remove "${title}" and its recorded chapters?`,
                ) && props.onDelete()
              }
            >
              <Trash2 className="size-4" /> Remove
            </Button>
          )}
          {props.busy && <Loader2 className="size-4 animate-spin self-center text-muted-foreground" />}
        </div>
      </div>

      {j.state === "review" && props.open && (
        <Review jobId={j.id} voices={props.voices} busy={props.busy} onConfirm={props.onConfirm} onError={props.onError} />
      )}
    </section>
  );
}

function Review(props: {
  jobId: string;
  voices: { default: string; voices: Voice[] } | null;
  busy: boolean;
  onConfirm: (body: { voice: string; title: string; author: string; include: number[] }) => void;
  onError: (e: unknown) => void;
}) {
  const { jobId, onError } = props;
  const [job, setJob] = useState<Job | null>(null);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [voice, setVoice] = useState("");
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [playing, setPlaying] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    let live = true;
    getJob(jobId)
      .then((j) => {
        if (!live) return;
        setJob(j);
        setTitle(j.title ?? "");
        setAuthor(j.author ?? "");
        setPicked(new Set((j.chapters ?? []).filter((c) => c.include).map((c) => c.i)));
      })
      .catch(onError);
    return () => {
      live = false;
    };
  }, [jobId, onError]);

  useEffect(() => {
    if (!voice && props.voices) setVoice(props.voices.default);
  }, [props.voices, voice]);

  // Stop and free the sample when the panel closes.
  useEffect(
    () => () => {
      audioRef.current?.pause();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  async function play(id: string) {
    audioRef.current?.pause();
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    if (playing === id) {
      setPlaying(null);
      return;
    }
    try {
      const url = await voiceSampleUrl(id);
      urlRef.current = url;
      const a = new Audio(url);
      audioRef.current = a;
      a.onended = () => setPlaying(null);
      setPlaying(id);
      await a.play();
    } catch (e) {
      setPlaying(null);
      onError(e);
    }
  }

  const chapters = useMemo(() => job?.chapters ?? [], [job]);
  const chars = chapters.filter((c) => picked.has(c.i)).reduce((n, c) => n + c.chars, 0);
  const listenSecs = chars / CHARS_PER_SEC;
  const buildSecs = listenSecs / 4 / 0.8 + (listenSecs / 3600) * 40; // four streams at ~realtime, plus assembly

  const toggle = (i: number) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });

  if (!job) {
    return (
      <div className="border-t border-border p-4 text-sm text-muted-foreground">
        <Loader2 className="mr-2 inline size-4 animate-spin" /> Loading chapters…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 border-t border-border p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Title</span>
          <input className={inputCls} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Author</span>
          <input className={inputCls} value={author} maxLength={200} onChange={(e) => setAuthor(e.target.value)} />
        </label>
      </div>

      <fieldset>
        <legend className="text-sm font-medium">Voice</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {(props.voices?.voices ?? []).map((v) => (
            <div
              key={v.id}
              className={cn(
                "flex items-center gap-2 rounded-md border p-2",
                voice === v.id ? "border-primary ring-1 ring-primary" : "border-border",
              )}
            >
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 pointer-coarse:min-h-11">
                <input
                  type="radio"
                  name={`voice-${jobId}`}
                  className="size-4 accent-primary"
                  checked={voice === v.id}
                  onChange={() => setVoice(v.id)}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{v.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{v.description}</span>
                </span>
              </label>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-9 shrink-0 pointer-coarse:size-11"
                aria-label={playing === v.id ? `Stop ${v.name} sample` : `Play ${v.name} sample`}
                onClick={() => void play(v.id)}
              >
                {playing === v.id ? <Pause className="size-4" /> : <Play className="size-4" />}
              </Button>
            </div>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <legend className="text-sm font-medium">
            Chapters <span className="font-normal text-muted-foreground">({picked.size} of {chapters.length} ticked)</span>
          </legend>
          <div className="flex gap-1">
            <Button type="button" variant="ghost" size="sm" className="pointer-coarse:h-11" onClick={() => setPicked(new Set(chapters.map((c) => c.i)))}>
              All
            </Button>
            <Button type="button" variant="ghost" size="sm" className="pointer-coarse:h-11" onClick={() => setPicked(new Set())}>
              None
            </Button>
          </div>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Untick anything you don&apos;t want read aloud. Pages that look like ads, excerpts or front matter start unticked.
        </p>
        <ul className="mt-2 flex flex-col divide-y divide-border rounded-md border border-border">
          {chapters.map((c) => (
            <li key={c.i}>
              <label className="flex cursor-pointer items-start gap-3 p-2 pointer-coarse:min-h-11">
                <input
                  type="checkbox"
                  className="mt-1 size-4 shrink-0 accent-primary"
                  checked={picked.has(c.i)}
                  onChange={() => toggle(c.i)}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className={cn("text-sm font-medium", !picked.has(c.i) && "text-muted-foreground")}>{c.title}</span>
                    <span className="text-xs text-muted-foreground">{c.minutes < 1 ? "<1" : Math.round(c.minutes)} min</span>
                    {c.reason && <span className="text-xs text-amber-600 dark:text-amber-400">{c.reason}</span>}
                  </span>
                  {c.preview && <span className="line-clamp-2 text-xs text-muted-foreground">{c.preview}</span>}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          About {formatDuration(listenSecs)} of listening · takes about {formatDuration(buildSecs)} to make
        </p>
        <Button
          type="button"
          className="gap-2 pointer-coarse:h-11"
          disabled={props.busy || picked.size === 0 || !title.trim() || !voice}
          onClick={() => props.onConfirm({ voice, title: title.trim(), author: author.trim(), include: [...picked].sort((a, b) => a - b) })}
        >
          <Check className="size-4" /> Start recording
        </Button>
      </div>
    </div>
  );
}
