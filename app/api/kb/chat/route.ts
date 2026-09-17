import { NextResponse } from "next/server";
import { backendHeaders, backendUrl } from "@/lib/backendProxy";

/**
 * Streaming proxy for Knowledge chat → core-heartbeat POST /kb/chat/stream.
 *
 * Validates and bounds the body (the gateway validates again), then pipes the SSE
 * stream straight through. Same shape as /api/intent; a separate route because the
 * contract differs — no model choice, no attachments, and history turns carry the
 * documents each answer cited.
 */
export const dynamic = "force-dynamic";

const MAX_TURNS = 40;
const MAX_CONTENT = 8000;
const MAX_SOURCES = 40;

type Turn = {
  role: "user" | "assistant";
  content: string;
  sources?: { document_id: string | null; title: string }[];
};

function toTurns(raw: unknown): Turn[] {
  if (!Array.isArray(raw)) return [];
  const turns: Turn[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const { role, content, sources } = item as Record<string, unknown>;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") continue;
    const turn: Turn = { role, content: content.slice(0, MAX_CONTENT) };
    if (role === "assistant" && Array.isArray(sources)) {
      turn.sources = sources
        .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
        .filter((s) => typeof s.title === "string" && s.title.length > 0)
        .slice(0, MAX_SOURCES)
        .map((s) => ({
          document_id: typeof s.document_id === "string" ? s.document_id : null,
          title: String(s.title).slice(0, 300),
        }));
    }
    turns.push(turn);
  }
  return turns.slice(-MAX_TURNS);
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid request body" }, { status: 400 });
  }
  const text = typeof body.text === "string" ? body.text.trim().slice(0, MAX_CONTENT) : "";
  if (!text) return NextResponse.json({ error: "empty message" }, { status: 400 });

  const payload = {
    text,
    history: toTurns(body.history),
    chat_id: typeof body.chat_id === "string" ? body.chat_id : null,
    timezone: typeof body.timezone === "string" ? body.timezone : null,
  };

  let res: Response;
  try {
    res = await fetch(backendUrl("/kb/chat/stream"), {
      method: "POST",
      headers: backendHeaders(request, { Accept: "text/event-stream" }),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(180_000),
    });
  } catch (err) {
    return NextResponse.json({ error: `backend unreachable: ${String(err)}` }, { status: 502 });
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (!res.ok || !res.body || !contentType.includes("text/event-stream")) {
    const data = (await res.json().catch(() => ({}))) as { detail?: string };
    return NextResponse.json(
      { error: data.detail ?? `backend error (HTTP ${res.status})` },
      { status: res.ok ? 502 : res.status },
    );
  }

  return new Response(res.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
