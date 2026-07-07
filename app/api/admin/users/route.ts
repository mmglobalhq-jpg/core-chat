import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { getSupabaseAdmin, getSupabaseAsUser } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

/** List all profiles + their ban status (admin-only). */
export async function GET(request: Request) {
  const gate = await requireAdmin(request);
  if ("error" in gate) return gate.error;

  // List as the authenticated admin so RLS (profiles_select_admin) grants
  // read-all — this works without service_role.
  const { data: profiles, error } = await getSupabaseAsUser(gate.token)
    .from("profiles")
    .select("id, first_name, last_name, username, email, is_approved, is_admin, created_at")
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Ban status (banned_until) needs service_role; best-effort so the list still
  // renders if the admin client isn't a real service_role key.
  const banned = new Set<string>();
  try {
    const { data: list } = await getSupabaseAdmin().auth.admin.listUsers({ page: 1, perPage: 1000 });
    for (const u of list?.users ?? []) {
      const until = (u as { banned_until?: string | null }).banned_until;
      if (until && new Date(until).getTime() > Date.now()) banned.add(u.id);
    }
  } catch {
    // service_role unavailable — leave paused=false for all.
  }
  const rows = (profiles ?? []).map((p) => ({ ...p, paused: banned.has(p.id as string) }));
  return NextResponse.json({ users: rows });
}
