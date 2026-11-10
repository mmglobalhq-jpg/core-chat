/**
 * Shared response helpers for the `/api/trace/*` routes: always no-store, and FINRA
 * failures surfaced as a 502 with a plain message (FINRA's own status text is
 * public-service output, never a credential, so it is safe to pass through).
 */
import { NextResponse } from "next/server";
import { FinraError } from "@/lib/trace/finra";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export function traceJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export function traceError(err: unknown): NextResponse {
  const msg =
    err instanceof FinraError
      ? err.message
      : err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")
        ? "FINRA did not answer in time"
        : "FINRA request failed";
  return traceJson({ error: msg }, 502);
}

/** Parse a JSON body, or null if it is missing or malformed. */
export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const b: unknown = await request.json();
    return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
