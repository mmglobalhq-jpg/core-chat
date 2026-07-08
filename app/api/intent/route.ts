import { NextResponse } from "next/server";
import { backendHeaders, backendUrl, toTurns } from "@/lib/backendProxy";

/**
 * Streaming server-side proxy to the core-heartbeat FastAPI gateway.
 *
 * The browser POSTs `{ text, model, history }` (with the user's Supabase JWT in its
 * Authorization header); we build the backend IntentPayload contract, POST it to
 * `/intent/stream`, and pipe the resulting SSE token stream straight back. A
 * threshold/validation rejection returns JSON (not a stream); we forward that as a
 * JSON error. Shared URL/header/history logic lives in lib/backendProxy.
 */

export const dynamic = "force-dynamic"; // per-request stream, never cached

// Confidence the gateway must clear to be accepted (threshold defaults to 0.5).
const UI_CONFIDENCE = 0.95;

// The UI dropdown ids differ from the backend's supervisor model registry; map
// each dropdown value to a backend-supported preference; unknown -> default.
const DEFAULT_MODEL_PREFERENCE = "gemini-2.5-flash";
const MODEL_PREFERENCE_MAP: Record<string, string> = {
  "gemini-2.5-flash": "gemini-2.5-flash",
  "gpt-5.5": "gpt-4o-mini",
  "deepseek-v4-pro": "claude-3.5-haiku",
};

function toModelPreference(uiModel: unknown): string {
  if (typeof uiModel !== "string") return DEFAULT_MODEL_PREFERENCE;
  return MODEL_PREFERENCE_MAP[uiModel] ?? DEFAULT_MODEL_PREFERENCE;
}

export async function POST(request: Request) {
  let text: string;
  let modelPreference: string;
  let history;
  let documentIds: string[] = [];
  try {
    const body = await request.json();
    text = typeof body?.text === "string" ? body.text : "";
    modelPreference = toModelPreference(body?.model);
    history = toTurns(body?.history);
    documentIds = Array.isArray(body?.document_ids)
      ? body.document_ids.filter((d: unknown) => typeof d === "string").slice(0, 10)
      : [];
  } catch {
    return NextResponse.json({ error: "invalid request body" }, { status: 400 });
  }
  if (!text.trim()) {
    return NextResponse.json({ error: "empty message" }, { status: 400 });
  }

  const payload = {
    intent: "chat",
    confidence: UI_CONFIDENCE,
    raw_input: text,
    source: "core-chat-ui",
    model_preference: modelPreference,
    history,
    document_ids: documentIds,
  };

  let res: Response;
  try {
    res = await fetch(backendUrl("/intent/stream"), {
      method: "POST",
      headers: backendHeaders(request, { Accept: "text/event-stream" }),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (err) {
    return NextResponse.json(
      { error: `backend unreachable: ${String(err)}` },
      { status: 502 },
    );
  }

  // Not a stream (threshold/validation rejection, or an error envelope) -> JSON.
  const contentType = res.headers.get("content-type") ?? "";
  if (!res.ok || !res.body || !contentType.includes("text/event-stream")) {
    const data = (await res.json().catch(() => ({}))) as { detail?: string };
    return NextResponse.json(
      { error: data.detail ?? `backend error (HTTP ${res.status})` },
      { status: res.ok ? 502 : res.status },
    );
  }

  // Pipe the backend's SSE token stream straight through to the browser.
  return new Response(res.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
