import { NextResponse } from "next/server";

/**
 * Server-side proxy to the core-heartbeat gateway's POST /intent.
 *
 * The browser calls this same-origin route (no CORS); we call the backend
 * server-to-server and translate its strict IntentPayload contract + orchestration
 * envelope into a small { ok, text, outcome, status } shape the chat UI can render.
 *
 * Backend contract (IntentPayload, extra="forbid"):
 *   required: intent, confidence (0..1), raw_input, source
 *   optional: entities (map), model_preference, timestamp
 */

interface SubmitBody {
  intent: string;
  rawInput: string;
  modelPreference: string;
  entities?: string[];
}

interface OrchestrationMessage {
  source?: string;
  content?: string;
  step?: number;
}
interface Orchestration {
  status?: string;
  messages?: OrchestrationMessage[];
  nodes_executed?: string[];
}
interface GatewayResponse {
  outcome?: string;
  intent?: string;
  detail?: string;
  orchestration?: Orchestration;
}

export async function POST(request: Request) {
  const base = process.env.NEXT_PUBLIC_API_URL;
  if (!base) {
    return NextResponse.json(
      { ok: false, text: "Backend URL is not configured (NEXT_PUBLIC_API_URL)." },
      { status: 500 },
    );
  }

  let body: SubmitBody;
  try {
    body = (await request.json()) as SubmitBody;
  } catch {
    return NextResponse.json({ ok: false, text: "Invalid request body." }, { status: 400 });
  }

  const payload = {
    intent: body.intent || "chat",
    confidence: 1.0,
    raw_input: body.rawInput,
    source: "core-chat-web",
    model_preference: body.modelPreference,
    entities: Object.fromEntries((body.entities ?? []).map((e) => [e, true])),
  };

  try {
    const res = await fetch(`${base}/intent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
    const data = (await res.json().catch(() => null)) as GatewayResponse | null;

    // Threshold/validation rejection (e.g. 422) — surface the gateway's reason.
    if (!res.ok) {
      const detail = data?.detail ?? `Gateway error (${res.status}).`;
      return NextResponse.json({
        ok: false,
        text: `⚠️ Gateway rejected the request: ${detail}`,
        outcome: data?.outcome ?? null,
        status: null,
      });
    }

    const orch = data?.orchestration;
    const messages = orch?.messages ?? [];

    // The assistant's actual answer comes from a worker node (e.g. "local_llm").
    // The supervisor only emits routing traces ("route -> local_llm",
    // "route -> finish"), so pick the last non-supervisor message with content.
    const answer =
      [...messages]
        .reverse()
        .find((m) => m.source !== "supervisor" && (m.content ?? "").trim().length > 0)
        ?.content ?? null;

    if (answer) {
      return NextResponse.json({
        ok: true,
        text: answer,
        outcome: data?.outcome ?? null,
        status: orch?.status ?? null,
        route: orch?.nodes_executed ?? [],
      });
    }

    // No worker answer (e.g. orchestration "degraded" from a missing credential).
    // Surface the true state rather than a routing trace or a fake reply.
    const lastTrace =
      messages.length > 0 ? messages[messages.length - 1]?.content ?? null : null;
    return NextResponse.json({
      ok: false,
      text: `⚠️ Gateway reached (intent “${data?.intent}”, outcome “${data?.outcome}”), but no answer was produced${orch?.status ? ` (orchestration ${orch.status})` : ""}${lastTrace ? `: ${lastTrace}` : ""}.`,
      outcome: data?.outcome ?? null,
      status: orch?.status ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, text: `⚠️ Could not reach the gateway at ${base}: ${(err as Error).message}`, status: null },
      { status: 502 },
    );
  }
}
