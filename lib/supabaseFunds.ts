/**
 * Server-ONLY Supabase client for the JP Fund poller project.
 *
 * chat.mmglobal.us and the poller run in SEPARATE Supabase projects. This client
 * targets the POLLER project and is used exclusively by the /api/funds/* route
 * handlers to call the read-only position-change RPCs. It authenticates with the
 * poller project's service-role key.
 *
 * NEVER import this from a client component, and never expose FUNDS_SUPABASE_URL /
 * FUNDS_SUPABASE_SERVICE_ROLE_KEY to the browser (no NEXT_PUBLIC_ prefix). The
 * runtime guard below turns any accidental client-bundle import into an immediate
 * throw. Built lazily so a missing key surfaces at request time, not build time.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Hard server-only boundary: importing this module in the browser is a bug.
if (typeof window !== "undefined") {
  throw new Error("lib/supabaseFunds is server-only and must never be imported in the browser");
}

let client: SupabaseClient | null = null;

export function getSupabaseFunds(): SupabaseClient {
  if (client) return client;
  const url = process.env.FUNDS_SUPABASE_URL;
  const key = process.env.FUNDS_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing FUNDS_SUPABASE_URL / FUNDS_SUPABASE_SERVICE_ROLE_KEY");
  }
  client = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return client;
}
