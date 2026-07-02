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
    const last =
      orch?.messages && orch.messages.length > 0
        ? orch.messages[orch.messages.length - 1]?.content ?? null
        : null;

    // Accepted but orchestration could not produce a real answer (e.g. the backend
    // Supervisor is missing its model credential -> status "degraded"). Render the
    // truthful state instead of a fake reply.
    if (orch?.status && orch.status !== "success") {
      return NextResponse.json({
        ok: true,
        text: `⚠️ Gateway reached (intent “${data?.intent}”, outcome “${data?.outcome}”), but orchestration is ${orch.status}${last ? `: ${last}` : ""}.`,
        outcome: data?.outcome ?? null,
        status: orch.status,
      });
    }

    return NextResponse.json({
      ok: true,
      text: last ?? data?.detail ?? "(gateway returned no output)",
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
