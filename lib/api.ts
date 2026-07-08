/**
 * Client-side entry point for sending a chat message to the backend.
 *
 * Calls the same-origin Next.js proxy route (`/api/intent`), which streams the
 * backend's SSE token events. Reads the response body progressively with a
 * reader loop, invoking `onToken` for each `{"token": ...}` fragment as it
 * arrives, and resolves with the fully-accumulated reply + terminal status.
 * Throws with a human-readable message on any failure (non-stream error
 * envelope, threshold rejection, or backend unreachable).
 */
import { supabase } from "@/lib/supabaseClient";

export interface ChatResult {
  reply: string;
  status: string;
}

/**
 * Same-origin JSON headers plus the active user's Supabase Bearer JWT, so the
 * proxy can forward identity to the backend. Absent a session the call proceeds
 * unauthenticated (the backend treats it as the sandbox user). Shared by every
 * client→proxy call so the session/header logic lives in one place.
 */
export async function authHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (session?.access_token) {
    headers.Authorization = `Bearer ${session.access_token}`;
  }
  return headers;
}

/**
 * Ask the backend (local model) for a short title summarizing a conversation.
 * Best-effort: returns null on any failure so the caller keeps its current title.
 * Forwards the Supabase session JWT so the same-origin proxy can clear the edge.
 */
export async function generateTitle(
  messages: { role: string; content: string }[],
): Promise<string | null> {
  try {
    const res = await fetch("/api/title", {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ messages }),
    });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => ({}))) as { title?: unknown };
    return typeof data.title === "string" && data.title.trim() ? data.title : null;
  } catch {
    return null;
  }
}

export async function sendChat(
  text: string,
  model?: string,
  onToken?: (token: string) => void,
  signal?: AbortSignal,
  history?: { role: string; content: string }[],
): Promise<ChatResult> {
  const res = await fetch("/api/intent", {
    method: "POST",
    headers: await authHeaders(),
    // `history` carries prior conversation turns so the backend can seed the
    // agent with context (see /api/intent proxy + IntentPayload.history).
    body: JSON.stringify({ text, model, history }),
    signal,
  });

  // A non-stream response is an error envelope (threshold reject, backend down).
  const contentType = res.headers.get("content-type") ?? "";
  if (!res.ok || !res.body || !contentType.includes("text/event-stream")) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `request failed (HTTP ${res.status})`);
  }

  let reply = "";
  let status = "completed";

  const handleEvent = (rawEvent: string) => {
    // One SSE event: take its `data:` payload (join multi-line data fields).
    const json = rawEvent
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("");
    if (!json) return;
    let evt: { token?: string; status?: string };
    try {
      evt = JSON.parse(json);
    } catch {
      return; // ignore keep-alives / partial noise
    }
    if (typeof evt.token === "string") {
      reply += evt.token;
      onToken?.(evt.token);
    }
    if (typeof evt.status === "string") {
      status = evt.status;
    }
  };

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE events are separated by a blank line ("\n\n").
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        handleEvent(buffer.slice(0, sep));
        buffer = buffer.slice(sep + 2);
      }
    }
    if (buffer.trim()) handleEvent(buffer); // flush a trailing event, if any
  } catch (err) {
    // User pressed Stop: aborting the fetch rejects the pending read(). Cancel
    // the reader (which drops the proxy->backend stream) and return the partial
    // reply gathered so far rather than surfacing an error.
    if (signal?.aborted || (err instanceof DOMException && err.name === "AbortError")) {
      await reader.cancel().catch(() => {});
      return { reply, status: "aborted" };
    }
    throw err;
  }

  return { reply, status };
}
