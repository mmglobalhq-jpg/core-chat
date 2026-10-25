import { NextResponse } from "next/server";
import { backendHeaders, backendUrl, toTurns } from "@/lib/backendProxy";
import { requireUser } from "@/lib/reqUser";

/**
 * Server-side proxy to the core-heartbeat `POST /title` endpoint.
 *
 * The browser POSTs `{ messages: {role, content}[] }` (a conversation); we forward
 * it to the backend, which runs the local model and returns `{ title: string | null }`.
 * Best-effort: any failure returns `{ title: null }` (HTTP 200) so the client
 * simply keeps its existing title — a missing/old backend never breaks the UI.
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  // Gate BEFORE touching the body or the backend: core-heartbeat maps a missing or
  // unverifiable token to its sandbox user, so this route is the only check that the
  // caller is a signed-in, APPROVED user (lib/reqUser.ts).
  const gate = await requireUser(request);
  if ("error" in gate) return gate.error;

  let messages;
  try {
    messages = toTurns((await request.json())?.messages);
  } catch {
    return NextResponse.json({ title: null });
  }
  if (messages.length === 0) return NextResponse.json({ title: null });

  try {
    const res = await fetch(backendUrl("/title"), {
      method: "POST",
      headers: backendHeaders(request),
      body: JSON.stringify({ messages }),
      // Generous timeout: title generation is a local-model call that can be slow
      // on a cold/loaded Ollama. Too tight a bound silently drops titles while the
      // model warms up.
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) return NextResponse.json({ title: null });
    const data = (await res.json().catch(() => ({}))) as { title?: unknown };
    const title = typeof data.title === "string" ? data.title : null;
    return NextResponse.json({ title });
  } catch {
    return NextResponse.json({ title: null });
  }
}
