/**
 * The user's own briefing sources.
 *
 * VALIDATION HAPPENS IN THE BACKEND, not here. Deciding whether a URL is usable
 * means checking robots.txt with the right agent, fetching through the
 * SSRF-guarded client, spotting paywalls, and parsing feeds — all of which lives
 * in Python. Re-implementing any of it here would create a second set of rules
 * that disagrees with the one the pipeline actually follows.
 *
 * As with every other briefing route, isolation is the `.eq("user_id", …)`
 * filter keyed to the verified token, NOT RLS: these use the service-role
 * client, which bypasses RLS entirely.
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/reqUser";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { BACKEND_URL } from "@/lib/backendProxy";

export const dynamic = "force-dynamic";

const MAX_SOURCES = 20;

interface SourceRow {
  id: string;
  kind: string;
  url: string;
  name: string;
  topic: string;
  is_active: boolean;
  last_ok_at: string | null;
  last_error: string | null;
}

export async function GET(request: Request) {
  const gate = await requireUser(request);
  if ("error" in gate) return gate.error;

  const { data, error } = await getSupabaseAdmin()
    .from("briefing_user_sources")
    .select("id, kind, url, name, topic, is_active, last_ok_at, last_error")
    .eq("user_id", gate.user.id)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("source list failed", error.message);
    return NextResponse.json({ error: "Could not load sources" }, { status: 500 });
  }
  return NextResponse.json({ sources: (data ?? []) as unknown as SourceRow[] });
}

export async function POST(request: Request) {
  const gate = await requireUser(request);
  if ("error" in gate) return gate.error;

  let body: { url?: unknown; topic?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!url) return NextResponse.json({ error: "A URL is required" }, { status: 400 });

  const admin = getSupabaseAdmin();

  // A cap, because each source is fetched every run. Without one, a user could
  // quietly turn their own briefing into a crawl of a hundred sites.
  const { count } = await admin
    .from("briefing_user_sources")
    .select("id", { count: "exact", head: true })
    .eq("user_id", gate.user.id);
  if ((count ?? 0) >= MAX_SOURCES) {
    return NextResponse.json(
      { error: `You can have up to ${MAX_SOURCES} sources. Remove one first.` },
      { status: 400 },
    );
  }

  // Ask the pipeline whether it would actually be allowed to read this.
  let checked: { ok?: boolean; kind?: string; url?: string; name?: string; reason?: string };
  try {
    const res = await fetch(`${BACKEND_URL}/briefing/check-source`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${gate.token}`,
      },
      body: JSON.stringify({ url }),
      // Discovery may try several feed paths on a slow origin.
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) throw new Error(`backend ${res.status}`);
    checked = await res.json();
  } catch (err) {
    console.error("source check failed", err);
    return NextResponse.json(
      { error: "Could not check that address just now. Try again." },
      { status: 502 },
    );
  }

  if (!checked.ok) {
    // The backend's reason is written for a person to read; pass it through
    // rather than replacing it with something vaguer.
    return NextResponse.json(
      { error: checked.reason ?? "That address cannot be used as a source." },
      { status: 400 },
    );
  }

  const topic = typeof body.topic === "string" && body.topic.trim()
    ? body.topic.trim().slice(0, 60)
    : "custom";

  const { error } = await admin.from("briefing_user_sources").upsert(
    {
      user_id: gate.user.id, // from the token, never the body
      kind: checked.kind ?? "rss",
      url: checked.url ?? url,
      name: (checked.name ?? url).slice(0, 120),
      topic,
      is_active: true,
    },
    { onConflict: "user_id,url" },
  );

  if (error) {
    console.error("source insert failed", error.message);
    return NextResponse.json({ error: "Could not save that source" }, { status: 500 });
  }
  return NextResponse.json({
    ok: true,
    kind: checked.kind,
    url: checked.url,
    name: checked.name,
  });
}

export async function DELETE(request: Request) {
  const gate = await requireUser(request);
  if ("error" in gate) return gate.error;

  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  // Scoped to the caller as well as the id: an id alone would let anyone delete
  // anyone's source by guessing a uuid.
  const { error } = await getSupabaseAdmin()
    .from("briefing_user_sources")
    .delete()
    .eq("id", id)
    .eq("user_id", gate.user.id);

  if (error) {
    console.error("source delete failed", error.message);
    return NextResponse.json({ error: "Could not remove that source" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
