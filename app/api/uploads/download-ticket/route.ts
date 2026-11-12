import { NextResponse } from "next/server";
import { backendHeaders, backendUrl } from "@/lib/backendProxy";
import { requireUser } from "@/lib/reqUser";

/**
 * POST { name } → { ticket } — step one of downloading a file from the mini PC's
 * Uploads folder. The admin check happens in core-heartbeat; this route forwards
 * the caller's Bearer JWT so the gateway can identify them, and gates on an
 * approved user first so an anonymous request never reaches the backend.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const gate = await requireUser(request);
  if ("error" in gate) return gate.error;

  const body = (await request.json().catch(() => ({}))) as { name?: unknown };
  const name = typeof body.name === "string" ? body.name : "";
  if (!name.trim()) {
    return NextResponse.json({ detail: "name is required" }, { status: 400 });
  }
  try {
    const res = await fetch(backendUrl("/uploads/download-ticket"), {
      method: "POST",
      headers: backendHeaders(request),
      body: JSON.stringify({ name }),
      signal: AbortSignal.timeout(30_000),
    });
    const data = await res
      .json()
      .catch(() => ({ detail: `HTTP ${res.status}` }));
    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    return NextResponse.json(
      { detail: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
