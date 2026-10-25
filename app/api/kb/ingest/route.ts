import { NextResponse } from "next/server";
import { backendHeaders, backendUrl } from "@/lib/backendProxy";
import { requireUser } from "@/lib/reqUser";

// Add an already-uploaded document to the knowledge base (async → returns job_id).
// Body: { doc_id, filename, content_type?, scope? }. The gateway gates scope=global
// on admin and fetches the original bytes from the user's storage.
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  // Gate BEFORE touching the body or the backend: core-heartbeat maps a missing or
  // unverifiable token to its sandbox user, so this route is the only check that the
  // caller is a signed-in, APPROVED user (lib/reqUser.ts).
  const gate = await requireUser(request);
  if ("error" in gate) return gate.error;

  const body = await request.json().catch(() => ({}));
  try {
    const res = await fetch(backendUrl("/kb/ingest"), {
      method: "POST",
      headers: backendHeaders(request),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    return NextResponse.json(data, { status: res.ok ? 200 : res.status });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
