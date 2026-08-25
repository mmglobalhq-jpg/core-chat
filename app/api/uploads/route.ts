import { NextResponse } from "next/server";
import { backendHeaders, backendUrl } from "@/lib/backendProxy";

/**
 * Server-side proxy to core-heartbeat's `/uploads` endpoints (Settings → File
 * Upload). Admin gating, name hardening and every disk write happen in the
 * BACKEND — this file only forwards the caller's Bearer JWT so the gateway can
 * identify them. Nothing here should ever become a trust decision.
 *
 * The POST deliberately streams `request.body` straight through: calling
 * `request.formData()` or `.arrayBuffer()` would buffer the whole file (up to
 * 100 MB) into this container's heap before a single byte reached the backend.
 */
export const dynamic = "force-dynamic";

// The Windows upload folder is a 9p/DrvFs mount, which is markedly slower than
// ext4 — a 100 MB file over a phone connection plus a slow mount needs real room.
const UPLOAD_TIMEOUT_MS = 30 * 60_000;
const READ_TIMEOUT_MS = 30_000;

/** `fetch` has no typed `duplex`, which undici requires for a streaming body. */
type StreamingInit = RequestInit & { duplex: "half" };

export async function POST(request: Request): Promise<Response> {
  const filename = request.headers.get("x-upload-filename") ?? "";
  if (!filename.trim()) {
    return NextResponse.json({ detail: "X-Upload-Filename is required" }, { status: 400 });
  }
  if (!request.body) {
    return NextResponse.json({ detail: "empty request body" }, { status: 400 });
  }
  try {
    const res = await fetch(backendUrl("/uploads"), {
      method: "POST",
      headers: backendHeaders(request, {
        "Content-Type": "application/octet-stream",
        "X-Upload-Filename": filename,
      }),
      body: request.body,
      duplex: "half",
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    } as StreamingInit);
    const data = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }));
    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    return NextResponse.json(
      { detail: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}

export async function GET(request: Request): Promise<Response> {
  try {
    const res = await fetch(backendUrl("/uploads"), {
      headers: backendHeaders(request),
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    });
    const data = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }));
    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    return NextResponse.json(
      { detail: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}

export async function DELETE(request: Request): Promise<Response> {
  const name = new URL(request.url).searchParams.get("name") ?? "";
  if (!name) {
    return NextResponse.json({ detail: "name is required" }, { status: 400 });
  }
  try {
    const res = await fetch(backendUrl(`/uploads/${encodeURIComponent(name)}`), {
      method: "DELETE",
      headers: backendHeaders(request),
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    });
    const data = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }));
    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    return NextResponse.json(
      { detail: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
