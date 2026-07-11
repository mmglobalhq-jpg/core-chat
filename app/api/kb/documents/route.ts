import { NextResponse } from "next/server";
import { backendHeaders, backendUrl } from "@/lib/backendProxy";

// List the caller's knowledge-base documents (own + global). Proxies to the
// core-heartbeat gateway, forwarding the user's Bearer JWT + CF-Access headers.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const res = await fetch(backendUrl("/kb/documents"), {
      headers: backendHeaders(request),
      signal: AbortSignal.timeout(30_000),
    });
    const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    return NextResponse.json(data, { status: res.ok ? 200 : res.status });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
