/**
 * Types for the `query_data` tool and the gateway contract.
 *
 * The tool INPUT the chat model may provide is deliberately minimal: mode,
 * question, and an optional scope/constraints. It has NO field for user
 * identity, roles, request IDs, capability permissions, raw SQL, or a "route"
 * — those are either server-generated or disallowed.
 */

/** Fields the chat model is allowed to provide. */
export type QueryDataToolInput = {
  mode: "funds";
  question: string;
  scope?: {
    fund?: string;
    manager?: string;
    start_date?: string; // ISO date
    end_date?: string; // ISO date
    as_of?: string; // ISO date
    security?: string;
    search_mode?: "cusip" | "name";
    limit?: number;
  };
  constraints?: {
    max_rows?: number;
  };
};

/** Server-generated context — the model never controls these. */
export type ServerContext = {
  requestId: string;
  conversationId: string | null;
  turnIndex: number | null;
  userSubject: string; // from the verified chat session, never the body
  correlationId: string;
};

/** Subset of the gateway's structured response we surface to the model/UI. */
export type GatewayProvenance = {
  capability_id?: string;
  capability_version?: string;
  plan_id?: string;
  plan_type?: string;
  operation?: string | null;
  objects_used?: string[];
  rpcs_used?: string[];
  requested_start_date?: string | null;
  requested_end_date?: string | null;
  resolved_start_date?: string | null;
  resolved_end_date?: string | null;
  comparison_basis?: string | null;
  row_count?: number;
  truncated?: boolean;
  catalog_version?: string | null;
};

export type GatewayVerification = {
  status?: string;
  secondary_method?: string | null;
  agreement?: string;
  notes?: string[];
};

export type GatewayQueryResponse = {
  request_id: string | null;
  correlation_id: string;
  outcome: "answer" | "qualified_answer" | "clarification_required" | "abstention" | "error";
  answer_text?: string | null;
  data?: unknown;
  assumptions?: Array<{ text: string; basis: string; material: boolean }>;
  clarification?: { question: string; blocking_ambiguity: string } | null;
  abstention?: {
    reason_code: string;
    explanation: string;
    what_would_help?: string | null;
  } | null;
  provenance?: GatewayProvenance | null;
  verification?: GatewayVerification | null;
  retry?: { total_attempts: number; corrective_retries: number } | null;
};

/** What the tool returns to the caller (chat backend / UI). Caveats, verification
 * status, and resolved dates are always preserved and cannot be dropped. */
export type QueryDataToolResult = {
  ok: boolean;
  outcome: GatewayQueryResponse["outcome"] | "error";
  /** Natural-language summary (from the gateway; deterministic, no local LLM). */
  answerText: string | null;
  structuredData: unknown;
  assumptions: Array<{ text: string; basis: string; material: boolean }>;
  clarification: { question: string; blocking_ambiguity: string } | null;
  abstention: { reason_code: string; explanation: string; what_would_help?: string | null } | null;
  provenance: GatewayProvenance | null;
  verification: GatewayVerification | null;
  correlationId: string;
  requestId: string | null;
  /** Safe, user-facing failure message (never internal detail). */
  userMessage?: string;
};
