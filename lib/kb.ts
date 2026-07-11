/**
 * Knowledge-base client helpers. Uploads reuse the existing user-docs storage path
 * (lib/documents.uploadOriginal); the KB service is reached through the same-origin
 * /api/kb/* proxies (which forward the Bearer JWT to core-heartbeat). The KB's own
 * document metadata lives in the KB service, so we don't create a `documents` row.
 */
import { supabase } from "@/lib/supabaseClient";
import { uploadOriginal } from "@/lib/documents";

export type KbScope = "private" | "global";

export interface KbDoc {
  id: string;
  title: string;
  summary: string | null;
  doc_type: string | null;
  created_at: string;
  scope: KbScope;
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
  return headers;
}

/** Upload a file and ingest it into the KB, polling the job to completion.
 *  `onStage` reports progress stages for the per-file UI. */
export async function ingestFile(
  file: File,
  scope: KbScope,
  onStage: (stage: string) => void,
): Promise<{ ok: boolean; error?: string }> {
  const docId = crypto.randomUUID();

  onStage("uploading");
  const uploaded = await uploadOriginal(docId, file);
  if (!uploaded) return { ok: false, error: "upload failed" };

  onStage("ingesting");
  const res = await fetch("/api/kb/ingest", {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ doc_id: docId, filename: file.name, content_type: file.type || null, scope }),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    return { ok: false, error: (d as { detail?: string }).detail ?? `ingest failed (HTTP ${res.status})` };
  }
  const { job_id } = (await res.json()) as { job_id?: string };
  if (!job_id) return { ok: false, error: "no job id returned" };

  // Poll the job (~2s cadence, up to ~2 min).
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const jr = await fetch(`/api/kb/jobs/${job_id}`, { headers: await authHeaders() });
    if (!jr.ok) continue;
    const j = (await jr.json()) as { status?: string; error?: string; progress?: { stage?: string } };
    if (j.status === "completed") return { ok: true };
    if (j.status === "failed") return { ok: false, error: j.error ?? "ingest failed" };
    if (j.progress?.stage) onStage(j.progress.stage);
  }
  return { ok: false, error: "timed out" };
}

export async function listKbDocuments(): Promise<KbDoc[]> {
  const res = await fetch("/api/kb/documents", { headers: await authHeaders() });
  if (!res.ok) return [];
  const d = (await res.json()) as { documents?: KbDoc[] };
  return d.documents ?? [];
}

export async function deleteKbDocument(id: string, scope: KbScope): Promise<boolean> {
  const res = await fetch(`/api/kb/documents/${id}?scope=${scope}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  return res.ok;
}
