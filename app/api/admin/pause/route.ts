import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

/** Toggle a login ban on a user (admin-only). body: { userId, pause: boolean } */
export async function POST(request: Request) {
  const gate = await requireAdmin(request);
  if ("error" in gate) return gate.error;

  const { userId, pause } = (await request.json().catch(() => ({}))) as {
    userId?: string;
    pause?: boolean;
  };
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });
  if (userId === gate.user.id) {
    return NextResponse.json({ error: "You cannot pause your own admin account." }, { status: 400 });
  }

  // ban_duration: a long horizon to pause, or "none" to lift the ban.
  const { error } = await getSupabaseAdmin().auth.admin.updateUserById(userId, {
    ban_duration: pause ? "876000h" : "none",
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, paused: !!pause });
}
