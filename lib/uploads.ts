/**
 * Client helpers for Settings → File Upload: send files to the mini PC's Windows
 * folder (C:\Users\MMGlobal\Uploads) through the same-origin /api/uploads proxy.
 *
 * Uploads use XMLHttpRequest rather than fetch, for one reason: `fetch` exposes no
 * upload progress. A 100 MB file from a phone over a slow 9p mount is minutes of
 * apparently-nothing, and a dead UI during that window is indistinguishable from a
 * hang. XHR's `upload.onprogress` is the only way to show real progress in a
 * browser today.
 */
import { supabase } from "@/lib/supabaseClient";

export interface StoredUpload {
  stored_as: string;
  original_name: string;
  rewritten: boolean;
  size_bytes: number;
  windows_path: string;
}

export interface UploadEntry {
  name: string;
  size_bytes: number;
  modified: number;
}

async function authHeader(): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return `Bearer ${session?.access_token ?? ""}`;
}

/** Upload one file, reporting 0–100 progress. Never throws; returns the error. */
export async function uploadToMiniPc(
  file: File,
  onProgress: (percent: number) => void,
  signal?: AbortSignal,
): Promise<{ ok: boolean; stored?: StoredUpload; error?: string }> {
  const auth = await authHeader();
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/uploads");
    xhr.setRequestHeader("Authorization", auth);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    // Percent-encoded so a non-ASCII filename survives the header round-trip;
    // the gateway decodes it before hardening the name.
    xhr.setRequestHeader("X-Upload-Filename", encodeURIComponent(file.name));

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let body: { detail?: string } & Partial<StoredUpload> = {};
      try {
        body = JSON.parse(xhr.responseText) as typeof body;
      } catch {
        /* fall through to a status-based message */
      }
      if (xhr.status === 200 && body.stored_as) {
        resolve({ ok: true, stored: body as StoredUpload });
      } else {
        resolve({ ok: false, error: body.detail ?? `upload failed (HTTP ${xhr.status})` });
      }
    };
    xhr.onerror = () => resolve({ ok: false, error: "network error" });
    xhr.onabort = () => resolve({ ok: false, error: "cancelled" });
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });

    // Sending the File itself lets the browser stream from disk instead of
    // materialising the bytes in JS memory.
    xhr.send(file);
  });
}

export async function listUploads(): Promise<UploadEntry[]> {
  const res = await fetch("/api/uploads", { headers: { Authorization: await authHeader() } });
  if (!res.ok) return [];
  const d = (await res.json().catch(() => ({}))) as { files?: UploadEntry[] };
  return d.files ?? [];
}

export async function deleteUpload(name: string): Promise<boolean> {
  const res = await fetch(`/api/uploads?name=${encodeURIComponent(name)}`, {
    method: "DELETE",
    headers: { Authorization: await authHeader() },
  });
  return res.ok;
}

/** "4.2 MB" — sizes here span a text note to a 100 MB video. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
