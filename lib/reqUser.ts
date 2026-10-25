/**
 * Server-side gate for authenticated (non-admin) API routes: verifies the caller's
 * Supabase access token (Bearer) with the service_role client, then requires the
 * account to be APPROVED (`profiles.is_approved`), and returns the user.
 *
 * The approval check is the point. Signup is open on the chat project, so a valid
 * token proves only that someone confirmed an email address. AuthGuard shows such an
 * account the "pending approval" screen, but that is browser UX — the account's own
 * Bearer token reached every route behind this gate directly until 2026-10-25. This
 * function, not AuthGuard, is the security boundary.
 *
 * Fails closed: if the approval lookup itself errors, the request is refused (503)
 * rather than admitted.
 */
import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

type Gate = { user: User; token: string } | { error: NextResponse };

export async function requireUser(request: Request): Promise<Gate> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (!token) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("is_approved")
    .eq("id", data.user.id)
    .maybeSingle();
  if (profileError) {
    return {
      error: NextResponse.json({ error: "Could not verify account approval" }, { status: 503 }),
    };
  }
  if (!(profile as { is_approved?: boolean } | null)?.is_approved) {
    return { error: NextResponse.json({ error: "Account pending approval" }, { status: 403 }) };
  }
  return { user: data.user, token };
}
