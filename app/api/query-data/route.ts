/**
 * POST /api/query-data — server-side surface for the `query_data` tool.
 *
 * Trust flow:
 *   1. The caller's chat Supabase JWT is verified by requireUser (identity).
 *   2. The feature must be enabled (funds mode); otherwise the route is a 404 —
 *      no tool exists and ordinary chat is unaffected.
 *   3. The user's Supabase JWT is NEVER forwarded; a short-lived HS256 service
 *      token is minted server-side with the verified user id as subject.
 *   4. request_id / correlation_id are server-generated; the model cannot set
 *      identity, roles, request IDs, capability permissions, raw SQL, or route.
 *
 * A gateway failure returns a query_data-specific error only; it never throws,
 * so it cannot degrade the rest of the chat request.
 */

import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requireUser } from "@/lib/reqUser";
import { isFundsModeEnabled } from "@/lib/dataIntelligence/flags";
import { runQueryData } from "@/lib/dataIntelligence/tool";
import type { QueryDataToolInput, ServerContext } from "@/lib/dataIntelligence/types";

export const dynamic = "force-dynamic";

// Fields the model must never set — identity, permissions, routing, or raw SQL.
const FORBIDDEN_KEYS = [
  "sub",
  "user_id",
  "userId",
  "roles",
  "role",
  "request_id",
  "requestId",
  "capability",
  "permissions",
  "identity",
  "context",
  "route",
  "sql",
  "token",
];

export async function POST(request: Request): Promise<Response> {
  const gate = await requireUser(request);
  if ("error" in gate) return gate.error; // 401

  // Disabled → invisible. Ordinary Core Chat behavior is unchanged.
  if (!isFundsModeEnabled()) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== "object") throw new Error("bad");
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_request_body" }, { status: 400 });
  }

  for (const key of FORBIDDEN_KEYS) {
    if (key in body) {
      return NextResponse.json({ error: `forbidden_field:${key}` }, { status: 400 });
    }
  }

  // Only funds mode is exposed in this milestone (database mode is not).
  if (body.mode !== "funds") {
    return NextResponse.json({ error: "unsupported_mode" }, { status: 400 });
  }
  const question = typeof body.question === "string" ? body.question : "";
  if (!question.trim()) {
    return NextResponse.json({ error: "empty_question" }, { status: 400 });
  }

  const scope =
    body.scope && typeof body.scope === "object"
      ? (body.scope as QueryDataToolInput["scope"])
      : undefined;
  const constraints =
    body.constraints && typeof body.constraints === "object"
      ? (body.constraints as QueryDataToolInput["constraints"])
      : undefined;

  const input: QueryDataToolInput = { mode: "funds", question, scope, constraints };

  const ctx: ServerContext = {
    requestId: randomUUID(), // server-generated; never from the body
    conversationId: typeof body.conversation_id === "string" ? body.conversation_id : null,
    turnIndex: Number.isInteger(body.turn_index) ? (body.turn_index as number) : null,
    userSubject: gate.user.id, // from the verified session, never the body
    correlationId: request.headers.get("x-correlation-id") || randomUUID(),
  };

  const result = await runQueryData(input, ctx);
  return NextResponse.json(result, {
    headers: { "X-Correlation-ID": ctx.correlationId },
  });
}
