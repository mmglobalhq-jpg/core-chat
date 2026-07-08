import { NextResponse } from "next/server";
import { backendHeaders, backendUrl } from "@/lib/backendProxy";

/**
 * Server-side proxy to the core-heartbeat `POST /documents/parse` endpoint.
 * Forwards the user's Bearer JWT + CF-Access headers (via backendHeaders). Generous
 * timeout because a first docling parse may download models + parse a large PDF.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: { doc_id?: unknown; filename?: unknown; content_type?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ status: "error", error: "invalid body" }, { status: 400 });
  }
  const doc_id = typeof body.doc_id === "string" ? body.doc_id : "";
  const filename = typeof body.filename === "string" ? body.filename : "";
  const content_type = typeof body.content_type === "string" ? body.content_type : null;
  if (!doc_id || !filename) {
    return NextResponse.json(
      { status: "error", error: "doc_id and filename required" },
      { status: 400 },
    );
  }
  try {
    const res = await fetch(backendUrl("/documents/parse"), {
      method: "POST",
      headers: backendHeaders(request),
      body: JSON.stringify({ doc_id, filename, content_type }),
      signal: AbortSignal.timeout(200_000),
    });
    const data = await res
      .json()
      .catch(() => ({ status: "error", error: `HTTP ${res.status}` }));
    return NextResponse.json(data, { status: res.ok ? 200 : res.status });
  } catch (e) {
    return NextResponse.json(
      { status: "error", error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
