import { NextResponse } from "next/server";
import { requireUser } from "@/lib/reqUser";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { revokeToken } from "@/lib/googleOAuth";

export const runtime = "nodejs";

// Revoke the token at Google (best-effort) and delete our stored copy.
export async function POST(request: Request) {
  const gate = await requireUser(request);
  if ("error" in gate) return gate.error;
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("google_credentials")
    .select("refresh_token")
    .eq("user_id", gate.user.id)
    .maybeSingle();
  if (data?.refresh_token) await revokeToken(data.refresh_token);
  await admin.from("google_credentials").delete().eq("user_id", gate.user.id);
  return NextResponse.json({ ok: true });
}
