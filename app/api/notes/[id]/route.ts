/**
 * One note: edit and delete.
 *
 * Every query is scoped to `id` AND `user_id`. The id alone would let any
 * signed-in user edit or delete anyone's note by guessing a uuid — the same
 * reasoning recorded on the sources route's DELETE.
 *
 * A miss therefore returns 404 rather than 403. Distinguishing "exists but is
 * not yours" from "does not exist" would confirm the existence of other
 * people's rows to anyone probing ids.
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/reqUser";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const COLUMNS = "id, title, body, created_at, updated_at";

// Must match the CHECK constraints in migration 0011 and the constants in
// lib/notes.ts. Enforced here so the user gets a message rather than a 500 from
// a constraint violation.
const TITLE_MAX = 200;
const BODY_MAX = 100000;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireUser(request);
  if ("error" in gate) return gate.error;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  let body: { title?: unknown; body?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title : "";
  const text = typeof body.body === "string" ? body.body : "";

  if (title.length > TITLE_MAX) {
    return NextResponse.json(
      { error: `Titles are limited to ${TITLE_MAX} characters.` },
      { status: 400 },
    );
  }
  if (text.length > BODY_MAX) {
    return NextResponse.json(
      { error: "That note is too long to save." },
      { status: 400 },
    );
  }

  const { data, error } = await getSupabaseAdmin()
    .from("notes")
    // updated_at is set here rather than by a trigger — the convention `chats`
    // set in 0004. The list is ordered by it, so it must move on every edit.
    .update({ title, body: text, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", gate.user.id)
    .select(COLUMNS)
    .maybeSingle();

  if (error) {
    console.error("note update failed", error.message);
    return NextResponse.json({ error: "Could not save that note" }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "Note not found" }, { status: 404 });

  return NextResponse.json({ note: data });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireUser(request);
  if ("error" in gate) return gate.error;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  // `select` so a delete that matched nothing is reported as 404 instead of a
  // silent success — the caller removes the note from its list on a 2xx.
  const { data, error } = await getSupabaseAdmin()
    .from("notes")
    .delete()
    .eq("id", id)
    .eq("user_id", gate.user.id)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("note delete failed", error.message);
    return NextResponse.json({ error: "Could not delete that note" }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "Note not found" }, { status: 404 });

  return NextResponse.json({ ok: true });
}
