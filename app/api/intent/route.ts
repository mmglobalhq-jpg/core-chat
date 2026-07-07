import { NextResponse } from "next/server";

/**
 * Streaming server-side proxy to the core-heartbeat FastAPI gateway.
 *
 * Runs on the Next.js server (never the browser). The browser POSTs
 * `{ text, model }` (with the user's Supabase JWT in its Authorization header);
 * we build the backend IntentPayload contract, POST it to `/intent/stream`, and
 * pipe the resulting SSE token stream (`data: {"token": "..."}` ...
 * `data: {"status": "..."}`) straight back to the browser as `text/event-stream`.
 *
 * Auth forwarding: the incoming `Authorization: Bearer <supabase-jwt>` is passed
 * through so the backend can verify it and resolve the real user_id. When the
 * target is the Cloudflare-protected edge (api.mmglobal.us), the CF Access service
 * token headers are added from server-only env so the request clears Zero Trust.
 *
 * A threshold/validation rejection returns JSON (not a stream) from the backend;
 * we forward that as a JSON error so the client can render it.
 */

export const dynamic = "force-dynamic"; // per-request stream, never cached

const BACKEND_URL =
  process.env.CORE_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  process.env.API_BASE_URL ??
  "https://api.mmglobal.us";

// Confidence the gateway must clear to be accepted (threshold defaults to 0.5).
const UI_CONFIDENCE = 0.95;

// The UI dropdown ids differ from the backend's supervisor model registry
// (core-heartbeat: gemini-2.5-flash | gpt-4o-mini | claude-3.5-haiku). Map each
// dropdown value to a backend-supported preference; unknown falls back to default.
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

// Prior conversation turns forwarded to the backend as IntentPayload.history so
// the agent has context. Coerced to the strict {role, content} contract, dropping
// anything malformed; content is length-capped and the list is bounded (the
// backend also caps to its own last-N, this just limits payload size on the wire).
const MAX_HISTORY_TURNS = 40;
const MAX_HISTORY_CONTENT = 8000;

function toHistory(
  raw: unknown,
): { role: "user" | "assistant"; content: string }[] {
  if (!Array.isArray(raw)) return [];
  const turns: { role: "user" | "assistant"; content: string }[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const role = (item as { role?: unknown }).role;
    const content = (item as { content?: unknown }).content;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") {
      continue;
    }
    turns.push({ role, content: content.slice(0, MAX_HISTORY_CONTENT) });
  }
  // Keep the most recent turns if the client sent an unusually long history.
  return turns.slice(-MAX_HISTORY_TURNS);
}

export async function POST(request: Request) {
  let text: string;
  let modelPreference: string;
  let history: { role: "user" | "assistant"; content: string }[];
  try {
    const body = await request.json();
    text = typeof body?.text === "string" ? body.text : "";
    modelPreference = toModelPreference(body?.model);
    history = toHistory(body?.history);
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
  };

  // Forward the user's Supabase Bearer JWT (identity) and, when hitting the
  // Cloudflare-protected edge, the Access service token (edge gate).
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
  };
  const authHeader = request.headers.get("authorization");
  if (authHeader) headers.Authorization = authHeader;
  const cfClientId = process.env.CF_ACCESS_CLIENT_ID;
  const cfClientSecret = process.env.CF_ACCESS_CLIENT_SECRET;
  if (cfClientId && cfClientSecret) {
    headers["CF-Access-Client-Id"] = cfClientId;
    headers["CF-Access-Client-Secret"] = cfClientSecret;
  }

  let res: Response;
  try {
    res = await fetch(`${BACKEND_URL}/intent/stream`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (err) {
    return NextResponse.json(
      { error: `backend unreachable at ${BACKEND_URL}: ${String(err)}` },
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
