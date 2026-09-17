/**
 * Client for Knowledge chat: POST /api/kb/chat (same-origin proxy) → core-heartbeat
 * /kb/chat/stream. The stream carries `token`, `tool_call`, `sources` and a final
 * `status`, in the same SSE framing as the main chat (lib/api.ts).
 */
import { authHeaders } from "@/lib/api";
import type { KnowledgeSource } from "@/lib/types";

export interface KnowledgeTurn {
  role: "user" | "assistant";
  content: string;
  /** Assistant turns: the documents the answer cited, so a follow-up can be resolved
   *  to the same document ("what else did that report say?"). */
  sources?: { document_id: string | null; title: string }[];
}

export interface KnowledgeResult {
  reply: string;
  status: string;
  sources: KnowledgeSource[];
}

export async function sendKnowledgeChat(
  text: string,
  history: KnowledgeTurn[],
  chatId: string,
  handlers: {
    onToken?: (token: string) => void;
    onActivity?: (toolName: string) => void;
  } = {},
  signal?: AbortSignal,
): Promise<KnowledgeResult> {
  const res = await fetch("/api/kb/chat", {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({
      text,
      history,
      chat_id: chatId,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }),
    signal,
  });

  const contentType = res.headers.get("content-type") ?? "";
  if (!res.ok || !res.body || !contentType.includes("text/event-stream")) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `request failed (HTTP ${res.status})`);
  }

  let reply = "";
  let status = "completed";
  let sources: KnowledgeSource[] = [];

  const handleEvent = (rawEvent: string) => {
    const json = rawEvent
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("");
    if (!json) return;
    let evt: {
      token?: string;
      status?: string;
      tool_call?: { name?: unknown };
      sources?: unknown;
    };
    try {
      evt = JSON.parse(json);
    } catch {
      return;
    }
    if (typeof evt.token === "string") {
      reply += evt.token;
      handlers.onToken?.(evt.token);
    }
    if (evt.tool_call && typeof evt.tool_call.name === "string") {
      handlers.onActivity?.(evt.tool_call.name);
    }
    if (Array.isArray(evt.sources)) sources = parseSources(evt.sources);
    if (typeof evt.status === "string") status = evt.status;
  };

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        handleEvent(buffer.slice(0, sep));
        buffer = buffer.slice(sep + 2);
      }
    }
    if (buffer.trim()) handleEvent(buffer);
  } catch (err) {
    if (signal?.aborted || (err instanceof DOMException && err.name === "AbortError")) {
      await reader.cancel().catch(() => {});
      return { reply, status: "aborted", sources };
    }
    throw err;
  }
  return { reply, status, sources };
}

/** Keep only well-formed source entries (the stream is untrusted input to the UI). */
export function parseSources(raw: unknown[]): KnowledgeSource[] {
  const out: KnowledgeSource[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (typeof o.n !== "number" || typeof o.title !== "string") continue;
    out.push({
      n: o.n,
      title: o.title,
      document_id: typeof o.document_id === "string" ? o.document_id : null,
      chunk_index: typeof o.chunk_index === "number" ? o.chunk_index : null,
      excerpt: typeof o.excerpt === "string" ? o.excerpt : "",
    });
  }
  return out;
}

/** The history sent with a turn: every settled message, with each assistant answer's
 *  cited documents (deduplicated) attached. */
export function toKnowledgeHistory(
  messages: { role: "user" | "assistant"; content: string; sources?: KnowledgeSource[] }[],
): KnowledgeTurn[] {
  return messages
    .filter((m) => m.content.trim().length > 0)
    .map((m) => {
      if (m.role !== "assistant" || !m.sources?.length) return { role: m.role, content: m.content };
      const seen = new Set<string>();
      const docs: { document_id: string | null; title: string }[] = [];
      for (const s of m.sources) {
        const key = s.document_id ?? s.title;
        if (seen.has(key)) continue;
        seen.add(key);
        docs.push({ document_id: s.document_id, title: s.title });
      }
      return { role: m.role, content: m.content, sources: docs };
    });
}
