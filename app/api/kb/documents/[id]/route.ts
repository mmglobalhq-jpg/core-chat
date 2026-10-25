import { NextResponse } from "next/server";
import { backendHeaders, backendUrl } from "@/lib/backendProxy";
import { requireUser } from "@/lib/reqUser";

// Delete a document from the knowledge base. ?scope=private|global — the gateway
// gates global deletes on admin. Proxies to the core-heartbeat gateway.
export const dynamic = "force-dynamic";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  // Gate BEFORE touching the body or the backend: core-heartbeat maps a missing or
  // unverifiable token to its sandbox user, so this route is the only check that the
  // caller is a signed-in, APPROVED user (lib/reqUser.ts).
  const gate = await requireUser(request);
  if ("error" in gate) return gate.error;

  const { id } = await params;
  const scope = new URL(request.url).searchParams.get("scope") ?? "private";
  try {
    const res = await fetch(
      backendUrl(`/kb/documents/${encodeURIComponent(id)}?scope=${encodeURIComponent(scope)}`),
      { method: "DELETE", headers: backendHeaders(request), signal: AbortSignal.timeout(30_000) },
    );
    const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    return NextResponse.json(data, { status: res.ok ? 200 : res.status });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
