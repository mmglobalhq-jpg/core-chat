/**
 * The user's notes: list and create.
 *
 * ISOLATION IS THE `.eq("user_id", …)` FILTER, NOT RLS. These routes use the
 * service-role client, which bypasses RLS entirely — the same posture as every
 * other authenticated route here. The
 * policies in migration 0011 are defence in depth for any future caller that
 * uses the anon key; they are not what protects this path.
 *
 * `user_id` ALWAYS COMES FROM THE VERIFIED TOKEN, never from the request body.
 * A body-supplied owner would let any signed-in user write into someone else's
 * notebook.
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/reqUser";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const COLUMNS = "id, title, body, created_at, updated_at";

// A ceiling, not a product decision. Without one, a scripted client holding a
// valid token could grow this table without bound in a shared database.
const MAX_NOTES = 500;

export async function GET(request: Request) {
  const gate = await requireUser(request);
  if ("error" in gate) return gate.error;

  const { data, error } = await getSupabaseAdmin()
    .from("notes")
    .select(COLUMNS)
    .eq("user_id", gate.user.id)
    .order("updated_at", { ascending: false });

  if (error) {
    console.error("note list failed", error.message);
    return NextResponse.json({ error: "Could not load your notes" }, { status: 500 });
  }
  return NextResponse.json({ notes: data ?? [] });
}

/**
 * Create an empty note and return it.
 *
 * Takes no body on purpose. The page creates a blank note, then saves content
 * through PATCH as the user types, so there is exactly one write path for note
 * content instead of two that could validate differently.
 */
export async function POST(request: Request) {
  const gate = await requireUser(request);
  if ("error" in gate) return gate.error;

  const admin = getSupabaseAdmin();

  const { count, error: countError } = await admin
    .from("notes")
    .select("id", { count: "exact", head: true })
    .eq("user_id", gate.user.id);

  if (countError) {
    console.error("note count failed", countError.message);
    return NextResponse.json({ error: "Could not create that note" }, { status: 500 });
  }
  if ((count ?? 0) >= MAX_NOTES) {
    return NextResponse.json(
      { error: `You can have up to ${MAX_NOTES} notes. Delete one first.` },
      { status: 400 },
    );
  }

  const { data, error } = await admin
    .from("notes")
    .insert({ user_id: gate.user.id })
    .select(COLUMNS)
    .single();

  if (error) {
    console.error("note insert failed", error.message);
    return NextResponse.json({ error: "Could not create that note" }, { status: 500 });
  }
  return NextResponse.json({ note: data }, { status: 201 });
}
