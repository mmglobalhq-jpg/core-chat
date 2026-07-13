import { NextResponse } from "next/server";
import { requireUser } from "@/lib/reqUser";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

// Whether the signed-in user has connected Google Calendar, and which account.
// Never returns tokens — read via service role, only non-sensitive fields.
export async function GET(request: Request) {
  const gate = await requireUser(request);
  if ("error" in gate) return gate.error;
  const { data } = await getSupabaseAdmin()
    .from("google_credentials")
    .select("email")
    .eq("user_id", gate.user.id)
    .maybeSingle();
  return NextResponse.json({ connected: !!data, email: data?.email ?? null });
}
