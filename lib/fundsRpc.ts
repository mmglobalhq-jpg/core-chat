/**
 * Server-only helpers for the /api/funds/* routes: a single place to call the
 * poller-project RPCs and to translate PostgreSQL/PostgREST errors into safe HTTP
 * responses. Import only from route handlers — it pulls in the server-only funds
 * client (service-role key).
 */
import { NextResponse } from "next/server";
import type { PostgrestError } from "@supabase/supabase-js";
import { getSupabaseFunds } from "@/lib/supabaseFunds";

// Validation errors the RPCs raise with SQLSTATE 22023 map to 400, not 500.
const CLIENT_ERROR_TOKENS = [
  "invalid_date_range",
  "invalid_page_size",
  "invalid_sort_column",
  "invalid_sort_direction",
  "export_limit_exceeded",
  "start and end dates are required",
];

export function mapRpcError(error: PostgrestError): NextResponse {
  const msg = error.message ?? "database error";
  const isClient = CLIENT_ERROR_TOKENS.some((t) => msg.includes(t));
  if (isClient) {
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  // Don't leak internal SQL detail to the browser on unexpected failures.
  return NextResponse.json({ error: "Fund data service error" }, { status: 502 });
}

export async function callRpc<T>(
  fn: string,
  args: Record<string, unknown>,
): Promise<{ data: T; error: null } | { data: null; error: NextResponse }> {
  const { data, error } = await getSupabaseFunds().rpc(fn, args);
  if (error) return { data: null, error: mapRpcError(error) };
  return { data: data as T, error: null };
}
