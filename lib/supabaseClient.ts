/**
 * Browser-side Supabase client (singleton).
 *
 * Reads the PUBLIC project URL + anon key (both `NEXT_PUBLIC_*`, so they are
 * inlined into the client bundle and safe to expose). Persists the session in the
 * browser and detects the magic-link callback in the URL, so the auth guard and
 * the chat proxy can read the active user's access token.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
      "Copy .env.local.example to .env.local and fill them in.",
  );
}

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
