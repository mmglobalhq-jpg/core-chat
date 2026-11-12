import { NextResponse } from "next/server";
import { backendUrl } from "@/lib/backendProxy";

/**
 * GET ?t=<ticket> — step two: stream one file from the mini PC's Uploads folder.
 *
 * Deliberately NOT behind the user gate: this is reached by a plain browser
 * navigation (so iOS Safari can hand a 600 MB audiobook to its download manager),
 * which cannot carry a Bearer header. The ticket is the authorisation — HMAC-signed
 * by core-heartbeat, minted only through the admin-gated /download-ticket route,
 * bound to one file and valid for 15 minutes — and core-heartbeat verifies it.
 *
 * The body is streamed straight through, never buffered, and Range is forwarded
 * so an interrupted download can resume.
 */
export const dynamic = "force-dynamic";

const PASS_HEADERS = [
  "content-type",
  "content-length",
  "content-disposition",
  "content-range",
  "accept-ranges",
  "last-modified",
  "etag",
];

export async function GET(request: Request): Promise<Response> {
  const t = new URL(request.url).searchParams.get("t") ?? "";
  if (!t)
    return NextResponse.json(
      { detail: "download link is missing" },
      { status: 403 },
    );

  const headers: Record<string, string> = {};
  const range = request.headers.get("range");
  if (range) headers.Range = range;
  const cfId = process.env.CF_ACCESS_CLIENT_ID;
  const cfSecret = process.env.CF_ACCESS_CLIENT_SECRET;
  if (cfId && cfSecret) {
    headers["CF-Access-Client-Id"] = cfId;
    headers["CF-Access-Client-Secret"] = cfSecret;
  }
  try {
    // Only the connection is time-limited; a long body over a phone link is fine.
    const res = await fetch(
      backendUrl(`/uploads/download?t=${encodeURIComponent(t)}`),
      {
        headers,
        signal: AbortSignal.timeout(6 * 60 * 60_000),
      },
    );
    if (!res.ok || !res.body) {
      const data = await res
        .json()
        .catch(() => ({ detail: `HTTP ${res.status}` }));
      return NextResponse.json(data, { status: res.status });
    }
    const out = new Headers({ "Cache-Control": "private, no-store" });
    for (const h of PASS_HEADERS) {
      const v = res.headers.get(h);
      if (v) out.set(h, v);
    }
    return new Response(res.body, { status: res.status, headers: out });
  } catch (e) {
    return NextResponse.json(
      { detail: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
