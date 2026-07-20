/**
 * Server-ONLY Supabase client for the REIT Research project (the ARR research
 * engine's database).
 *
 * The `/api/reits/*` route handlers use this client exclusively to read the
 * read-only `reit_arr_*` tables. Those tables have forced row-level security with
 * browser roles revoked, so only the service-role key (which bypasses RLS) can
 * read them — hence a dedicated server-only client.
 *
 * NEVER import this from a client component, and never expose REITS_SUPABASE_URL /
 * REITS_SUPABASE_SERVICE_ROLE_KEY to the browser (no NEXT_PUBLIC_ prefix). The
 * runtime guard below turns any accidental client-bundle import into an immediate
 * throw. Built lazily so a missing key surfaces at request time, not build time.
 *
 * The REIT project may or may not be the same Supabase project as Core Chat; this
 * module stays explicit and isolated either way (dedicated env vars, own client).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Hard server-only boundary: importing this module in the browser is a bug.
if (typeof window !== "undefined") {
  throw new Error("lib/supabaseReits is server-only and must never be imported in the browser");
}

let client: SupabaseClient | null = null;

export function getSupabaseReits(): SupabaseClient {
  if (client) return client;
  const url = process.env.REITS_SUPABASE_URL;
  const key = process.env.REITS_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing REITS_SUPABASE_URL / REITS_SUPABASE_SERVICE_ROLE_KEY");
  }
  client = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return client;
}
