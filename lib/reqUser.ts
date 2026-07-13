/**
 * Server-side gate for authenticated (non-admin) API routes: verifies the caller's
 * Supabase access token (Bearer) with the service_role client and returns the user.
 * Mirrors requireAdmin without the admin-email check.
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
  const { data, error } = await getSupabaseAdmin().auth.getUser(token);
  if (error || !data.user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { user: data.user, token };
}
