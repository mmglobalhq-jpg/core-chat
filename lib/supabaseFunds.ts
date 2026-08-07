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
import { serverSecret } from "@/lib/serverSecret";

// Hard server-only boundary: importing this module in the browser is a bug.
if (typeof window !== "undefined") {
  throw new Error("lib/supabaseFunds is server-only and must never be imported in the browser");
}

/**
 * Supabase server keys come in two generations needing DIFFERENT auth headers:
 *
 *  - legacy JWT service-role key — PostgREST resolves the role from the Bearer
 *    JWT. With `apikey` alone the request is admitted but runs as `anon`, which
 *    holds no grant on the poller RPCs (verified in production on the sibling
 *    REITS client: 401 "permission denied for function"). BOTH headers are required.
 *  - `sb_secret_*` — opaque, not a JWT. `apikey` alone resolves the role, and
 *    duplicating it into Authorization risks rejection as an invalid JWT.
 *
 * supabase-js sends both headers for every key shape, so for a secret key we strip
 * exactly one header on the way out. Detection is a prefix check — the key is never
 * decoded, validated, logged, or serialized. Mirrors lib/supabaseReits.ts.
 */
const SECRET_KEY_PREFIX = "sb_secret_";

/**
 * A fetch wrapper that removes ONLY the Authorization header, scoped to this
 * client via the SDK's documented `global.fetch` hook. Global fetch is never
 * mutated; every other header (apikey, content-profile, x-client-info, …), the
 * request body, the method, and all error/timeout behavior pass through untouched.
 */
function secretKeyFetch(): typeof fetch {
  return (input, init) => {
    // supabase-js calls fetch(url, init); handle a Request first arg defensively.
    const source =
      init?.headers ??
      (typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined);
    const headers = new Headers(source as HeadersInit | undefined);
    headers.delete("Authorization");
    // Resolved at call time, not captured at construction, so the ambient fetch
    // (or a test double) is always the one actually used.
    return globalThis.fetch(input, { ...init, headers });
  };
}

let client: SupabaseClient | null = null;

export function getSupabaseFunds(): SupabaseClient {
  if (client) return client;
  const url = process.env.FUNDS_SUPABASE_URL;
  const key = serverSecret("FUNDS_SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error("Missing FUNDS_SUPABASE_URL / FUNDS_SUPABASE_SERVICE_ROLE_KEY");
  }
  // Legacy keys keep the SDK's default headers untouched; only a secret key gets
  // the wrapper. Both generations therefore work from the same deployed code, so
  // this can ship before the key is rotated — no flag day.
  const isSecretKey = key.startsWith(SECRET_KEY_PREFIX);
  client = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    ...(isSecretKey ? { global: { fetch: secretKeyFetch() } } : {}),
  });
  return client;
}
