/**
 * Read and update the caller's briefing preferences.
 *
 * As with the briefing route, the row is keyed by the id from the verified
 * token. `user_id` is never taken from the request body — accepting it would let
 * any signed-in user rewrite anyone's settings, including the address their
 * briefing is emailed to.
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/reqUser";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

// Seconds are optional because this API's OWN database returns `time` as
// HH:MM:SS. Requiring HH:MM meant a client that round-tripped a stored value
// unchanged got a 400 — the endpoint rejected what it had just served.
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_TOPICS = 12;
const MAX_TOPIC_LEN = 60;

export async function GET(request: Request) {
  const gate = await requireUser(request);
  if ("error" in gate) return gate.error;

  const { data, error } = await getSupabaseAdmin()
    .from("briefing_prefs")
    .select("enabled, topics, deliver_at, timezone, deliver_email, email_to")
    .eq("user_id", gate.user.id)
    .maybeSingle();

  if (error) {
    console.error("prefs fetch failed", error.message);
    return NextResponse.json({ error: "Could not load preferences" }, { status: 500 });
  }
  return NextResponse.json({ prefs: data ?? null });
}

export async function PUT(request: Request) {
  const gate = await requireUser(request);
  if ("error" in gate) return gate.error;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const rawTime = typeof body.deliver_at === "string" ? body.deliver_at : "06:30";
  if (!TIME_RE.test(rawTime)) {
    return NextResponse.json({ error: "deliver_at must be HH:MM" }, { status: 400 });
  }
  // Store canonically as HH:MM regardless of what arrived.
  const deliverAt = rawTime.slice(0, 5);

  const timezone = typeof body.timezone === "string" ? body.timezone : "America/Chicago";
  try {
    // Reject an unknown zone here rather than storing it and discovering the
    // problem when a job tries to work out which local day it is generating for.
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    return NextResponse.json({ error: "Unknown timezone" }, { status: 400 });
  }

  const emailTo = typeof body.email_to === "string" && body.email_to.trim()
    ? body.email_to.trim()
    : null;
  if (emailTo && !EMAIL_RE.test(emailTo)) {
    return NextResponse.json({ error: "email_to is not a valid address" }, { status: 400 });
  }

  const topics = Array.isArray(body.topics)
    ? body.topics
        .filter((t): t is string => typeof t === "string")
        .map((t) => t.trim().slice(0, MAX_TOPIC_LEN))
        .filter(Boolean)
        .slice(0, MAX_TOPICS)
    : [];

  const { error } = await getSupabaseAdmin().from("briefing_prefs").upsert(
    {
      user_id: gate.user.id, // from the token, never from the body
      enabled: Boolean(body.enabled),
      topics,
      deliver_at: deliverAt,
      timezone,
      deliver_email: Boolean(body.deliver_email),
      email_to: emailTo,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  if (error) {
    console.error("prefs save failed", error.message);
    return NextResponse.json({ error: "Could not save preferences" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
