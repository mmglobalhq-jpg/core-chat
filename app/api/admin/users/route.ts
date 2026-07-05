import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

/** List all profiles + their ban status (admin-only). */
export async function GET(request: Request) {
  const gate = await requireAdmin(request);
  if ("error" in gate) return gate.error;

  const admin = getSupabaseAdmin();
  const { data: profiles, error } = await admin
    .from("profiles")
    .select("id, first_name, last_name, username, email, is_approved, is_admin, created_at")
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Merge ban status from auth (banned_until) so the UI can show Paused state.
  const banned = new Set<string>();
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  for (const u of list?.users ?? []) {
    const until = (u as { banned_until?: string | null }).banned_until;
    if (until && new Date(until).getTime() > Date.now()) banned.add(u.id);
  }
  const rows = (profiles ?? []).map((p) => ({ ...p, paused: banned.has(p.id as string) }));
  return NextResponse.json({ users: rows });
}
