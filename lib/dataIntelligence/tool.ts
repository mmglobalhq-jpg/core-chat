/**
 * The `query_data` tool implementation (server-side only).
 *
 * Builds a gateway request from the (already sanitized) tool input plus the
 * server-generated context, mints a short-lived service token, calls the
 * gateway, and maps the outcome. Gateway caveats, verification status, and
 * resolved dates are always preserved. A gateway failure returns a safe error
 * result — it NEVER throws, so an optional tool call cannot break the request.
 */

import { postQuery } from "./gatewayClient";
import { mintServiceToken } from "./serviceToken";
import type {
  GatewayQueryResponse,
  QueryDataToolInput,
  QueryDataToolResult,
  ServerContext,
} from "./types";

const MAX_ROWS_CEILING = 500;
const DEFAULT_MAX_ROWS = 200;

function clampMaxRows(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) return DEFAULT_MAX_ROWS;
  return Math.min(Math.floor(value), MAX_ROWS_CEILING);
}

/** Keep only the allowed scope fields; never a `route`/`sql`/identity field. */
function sanitizeScope(scope: QueryDataToolInput["scope"]): Record<string, unknown> {
  if (!scope || typeof scope !== "object") return {};
  const out: Record<string, unknown> = {};
  const allow = [
    "fund",
    "manager",
    "start_date",
    "end_date",
    "as_of",
    "security",
    "search_mode",
    "limit",
  ] as const;
  for (const key of allow) {
    const v = (scope as Record<string, unknown>)[key];
    if (v !== undefined && v !== null) out[key] = v;
  }
  return out;
}

function errorResult(ctx: ServerContext, message: string): QueryDataToolResult {
  return {
    ok: false,
    outcome: "error",
    answerText: null,
    structuredData: null,
    assumptions: [],
    clarification: null,
    abstention: null,
    provenance: null,
    verification: null,
    correlationId: ctx.correlationId,
    requestId: ctx.requestId,
    userMessage: message,
  };
}

function mapOutcome(gw: GatewayQueryResponse, ctx: ServerContext): QueryDataToolResult {
  return {
    ok: gw.outcome === "answer" || gw.outcome === "qualified_answer",
    outcome: gw.outcome,
    answerText: gw.answer_text ?? null,
    structuredData: gw.data ?? null,
    assumptions: gw.assumptions ?? [],
    clarification: gw.clarification ?? null,
    abstention: gw.abstention ?? null,
    provenance: gw.provenance ?? null,
    verification: gw.verification ?? null,
    correlationId: gw.correlation_id ?? ctx.correlationId,
    requestId: gw.request_id ?? ctx.requestId,
  };
}

export async function runQueryData(
  input: QueryDataToolInput,
  ctx: ServerContext,
): Promise<QueryDataToolResult> {
  // Funds mode only; generated SQL is never permitted (no route/sql field is
  // ever forwarded, and funds mode disables it gateway-side regardless).
  const request = {
    mode: "funds" as const,
    question: input.question,
    scope: sanitizeScope(input.scope),
    constraints: { max_rows: clampMaxRows(input.constraints?.max_rows) },
    context: {
      request_id: ctx.requestId,
      conversation_id: ctx.conversationId,
      turn_index: ctx.turnIndex,
    },
  };

  let token: string;
  try {
    token = await mintServiceToken({
      subject: ctx.userSubject,
      conversationId: ctx.conversationId,
      requestId: ctx.requestId,
    });
  } catch {
    return errorResult(ctx, "The data service is not configured.");
  }

  let call;
  try {
    call = await postQuery(request, { token, correlationId: ctx.correlationId });
  } catch {
    return errorResult(ctx, "The data service is temporarily unavailable.");
  }

  if (call.status !== 200 || !call.body || typeof call.body !== "object") {
    return errorResult(ctx, "The data service could not process the request.");
  }
  return mapOutcome(call.body as GatewayQueryResponse, ctx);
}
