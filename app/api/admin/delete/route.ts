import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

/** Permanently delete a user (admin-only). body: { userId }. The profiles row
 *  cascades via the ON DELETE CASCADE FK. */
export async function POST(request: Request) {
  const gate = await requireAdmin(request);
  if ("error" in gate) return gate.error;

  const { userId } = (await request.json().catch(() => ({}))) as { userId?: string };
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });
  if (userId === gate.user.id) {
    return NextResponse.json({ error: "You cannot delete your own admin account." }, { status: 400 });
  }

  const { error } = await getSupabaseAdmin().auth.admin.deleteUser(userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
