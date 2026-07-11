import { NextResponse } from "next/server";
import { backendHeaders, backendUrl } from "@/lib/backendProxy";

// Poll a KB ingest job's status. Proxies to the core-heartbeat gateway.
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const res = await fetch(backendUrl(`/kb/jobs/${encodeURIComponent(id)}`), {
      headers: backendHeaders(request),
      signal: AbortSignal.timeout(30_000),
    });
    const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    return NextResponse.json(data, { status: res.ok ? 200 : res.status });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
