import { NextResponse } from "next/server";
import { backendHeaders, backendUrl } from "@/lib/backendProxy";
import { requireUser } from "@/lib/reqUser";

/**
 * Proxy for the Audiobooks page to core-heartbeat's `/audiobooks/*` routes.
 *
 * The admin check and every validation that matters happen in the BACKEND (services/audiobooks.py); this route
 * only forwards the caller's Bearer JWT. It does two things itself:
 *   1. gates on a signed-in, APPROVED user before anything reaches the backend (heartbeat maps a missing token
 *      to its sandbox user, so this is the only check that the caller is a real account — lib/reqUser.ts), and
 *   2. forwards ONLY the path shapes listed below, so this catch-all can never become a general proxy into the
 *      gateway.
 */
export const dynamic = "force-dynamic";

const JOB = /^[0-9a-f]{16}$/;
const VOICE = /^[a-z]{2}-[A-Z]{2}-[A-Za-z]+Neural$/;
const ACTIONS = new Set(["confirm", "cancel", "retry"]);

type Ctx = { params: Promise<{ path?: string[] }> };

/** The gateway path for an allowed request, or null. */
export function allowedPath(method: string, parts: string[]): string | null {
  const [a, b, c, ...rest] = parts;
  if (rest.length) return null;
  if (method === "GET") {
    if (a === "voices" && b === undefined) return "/audiobooks/voices";
    if (a === "voices" && b && VOICE.test(b) && c === "sample") return `/audiobooks/voices/${b}/sample`;
    if (a === "jobs" && b === undefined) return "/audiobooks/jobs";
    if (a === "jobs" && b && JOB.test(b) && c === undefined) return `/audiobooks/jobs/${b}`;
  }
  if (method === "POST") {
    if (a === "jobs" && b === undefined) return "/audiobooks/jobs";
    if (a === "jobs" && b && JOB.test(b) && c && ACTIONS.has(c)) return `/audiobooks/jobs/${b}/${c}`;
  }
  if (method === "DELETE" && a === "jobs" && b && JOB.test(b) && c === undefined) return `/audiobooks/jobs/${b}`;
  return null;
}

/** Called only after the handler's own requireUser gate (one per exported handler: authGate.test.ts). */
async function forward(request: Request, ctx: Ctx): Promise<Response> {
  const parts = (await ctx.params).path ?? [];
  const path = allowedPath(request.method, parts);
  if (!path) return NextResponse.json({ detail: "not found" }, { status: 404 });

  const init: RequestInit = {
    method: request.method,
    headers: backendHeaders(request, request.method === "POST" ? { "Content-Type": "application/json" } : undefined),
    signal: AbortSignal.timeout(30_000),
  };
  if (request.method === "POST") {
    const text = await request.text();
    if (text.length > 64_000) return NextResponse.json({ detail: "request too large" }, { status: 413 });
    init.body = text || "{}";
  }
  try {
    const res = await fetch(backendUrl(path), init);
    if (path.endsWith("/sample") && res.ok) {
      // A voice sample (~170 KB mp3), fetched by the page with the Bearer header and played from a blob.
      return new Response(res.body, {
        status: 200,
        headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=3600" },
      });
    }
    const data = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }));
    return NextResponse.json(data, { status: res.status, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ detail: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}

export async function GET(request: Request, ctx: Ctx): Promise<Response> {
  const gate = await requireUser(request);
  if ("error" in gate) return gate.error;
  return forward(request, ctx);
}

export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  const gate = await requireUser(request);
  if ("error" in gate) return gate.error;
  return forward(request, ctx);
}

export async function DELETE(request: Request, ctx: Ctx): Promise<Response> {
  const gate = await requireUser(request);
  if ("error" in gate) return gate.error;
  return forward(request, ctx);
}
