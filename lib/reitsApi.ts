/**
 * Shared response helpers for the `/api/reits/*` route handlers: always
 * `Cache-Control: no-store`, and a single place to translate a `ReitServiceError`
 * (or any unexpected failure) into a sanitized HTTP response that never leaks
 * SQL detail or credentials.
 */
import { NextResponse } from "next/server";
import { ReitServiceError } from "@/lib/reitResearch";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export function reitJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export function reitErrorResponse(err: unknown): NextResponse {
  if (err instanceof ReitServiceError) {
    return NextResponse.json({ error: err.message }, { status: err.httpStatus, headers: NO_STORE });
  }
  return NextResponse.json(
    { error: "REIT research data service error" },
    { status: 502, headers: NO_STORE },
  );
}
