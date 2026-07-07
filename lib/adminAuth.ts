/**
 * Server-side admin gate for the /api/admin/* route handlers. Verifies the
 * caller's Supabase access token (Bearer) with the service_role client and
 * enforces a hard match on the admin email — anything else is a 401/403. This is
 * the real security boundary; the /settings/admin page's client check is only UX.
 */
import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { ADMIN_EMAIL } from "@/lib/constants";

export { ADMIN_EMAIL };

type Gate = { user: User; token: string } | { error: NextResponse };

export async function requireAdmin(request: Request): Promise<Gate> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (!token) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const { data, error } = await getSupabaseAdmin().auth.getUser(token);
  if (error || !data.user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if ((data.user.email ?? "").toLowerCase() !== ADMIN_EMAIL) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { user: data.user, token };
}
