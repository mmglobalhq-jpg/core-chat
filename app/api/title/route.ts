import { NextResponse } from "next/server";

/**
 * Server-side proxy to the core-heartbeat `POST /title` endpoint.
 *
 * The browser POSTs `{ messages: {role, content}[] }` (a conversation); we forward
 * it to the backend, which runs the local model and returns `{ title: string | null }`.
 * Mirrors app/api/intent/route.ts for auth: pass through the caller's Supabase
 * Bearer JWT and, when hitting the Cloudflare-protected edge, add the CF Access
 * service-token headers from server-only env.
 *
 * Best-effort: any failure returns `{ title: null }` (HTTP 200) so the client
 * simply keeps its existing title — a missing/old backend never breaks the UI.
 */

export const dynamic = "force-dynamic";

const BACKEND_URL =
  process.env.CORE_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  process.env.API_BASE_URL ??
  "https://api.mmglobal.us";

type Turn = { role: "user" | "assistant"; content: string };

function toMessages(raw: unknown): Turn[] {
  if (!Array.isArray(raw)) return [];
  const out: Turn[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const role = (item as { role?: unknown }).role;
    const content = (item as { content?: unknown }).content;
    if ((role === "user" || role === "assistant") && typeof content === "string") {
      out.push({ role, content: content.slice(0, 8000) });
    }
  }
  return out.slice(-40);
}

export async function POST(request: Request) {
  let messages: Turn[];
  try {
    const body = await request.json();
    messages = toMessages(body?.messages);
  } catch {
    return NextResponse.json({ title: null });
  }
  if (messages.length === 0) return NextResponse.json({ title: null });

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const authHeader = request.headers.get("authorization");
  if (authHeader) headers.Authorization = authHeader;
  const cfClientId = process.env.CF_ACCESS_CLIENT_ID;
  const cfClientSecret = process.env.CF_ACCESS_CLIENT_SECRET;
  if (cfClientId && cfClientSecret) {
    headers["CF-Access-Client-Id"] = cfClientId;
    headers["CF-Access-Client-Secret"] = cfClientSecret;
  }

  try {
    const res = await fetch(`${BACKEND_URL}/title`, {
      method: "POST",
      headers,
      body: JSON.stringify({ messages }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return NextResponse.json({ title: null });
    const data = (await res.json().catch(() => ({}))) as { title?: unknown };
    const title = typeof data.title === "string" ? data.title : null;
    return NextResponse.json({ title });
  } catch {
    return NextResponse.json({ title: null });
  }
}
