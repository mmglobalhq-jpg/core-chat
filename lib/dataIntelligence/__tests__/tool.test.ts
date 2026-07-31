// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Capture what the tool sends to the gateway, and control the response.
const postQuery = vi.fn();
vi.mock("@/lib/dataIntelligence/gatewayClient", () => ({
  postQuery: (...args: unknown[]) => postQuery(...args),
  GatewayNetworkError: class extends Error {},
}));

import { runQueryData } from "@/lib/dataIntelligence/tool";
import type { ServerContext } from "@/lib/dataIntelligence/types";

const CTX: ServerContext = {
  requestId: "req-1",
  conversationId: "conv-1",
  turnIndex: 3,
  userSubject: "user-abc",
  correlationId: "corr-1",
};

describe("runQueryData", () => {
  let saved: string | undefined;
  beforeEach(() => {
    postQuery.mockReset();
    saved = process.env.DATA_INTELLIGENCE_SIGNING_SECRET;
    process.env.DATA_INTELLIGENCE_SIGNING_SECRET = "tool-test-secret-000000000000000000";
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.DATA_INTELLIGENCE_SIGNING_SECRET;
    else process.env.DATA_INTELLIGENCE_SIGNING_SECRET = saved;
  });

  function gatewayReturns(body: Record<string, unknown>) {
    postQuery.mockResolvedValue({ status: 200, body });
  }

  it("maps an answer and preserves provenance + verification", async () => {
    gatewayReturns({
      outcome: "answer",
      answer_text: "PARX: 5 holdings",
      correlation_id: "corr-1",
      request_id: "req-1",
      provenance: { operation: "list_funds", objects_used: ["public.funds"] },
      verification: { status: "verified", secondary_method: "holdings_history total" },
      assumptions: [{ text: "used latest date", basis: "no as-of", material: false }],
    });
    const r = await runQueryData({ mode: "funds", question: "what funds?" }, CTX);
    expect(r.ok).toBe(true);
    expect(r.outcome).toBe("answer");
    expect(r.provenance?.operation).toBe("list_funds");
    expect(r.verification?.status).toBe("verified");
    expect(r.assumptions).toHaveLength(1);
  });

  it("preserves clarification and abstention outcomes", async () => {
    gatewayReturns({
      outcome: "clarification_required",
      correlation_id: "corr-1",
      clarification: { question: "Which fund?", blocking_ambiguity: "fund not specified" },
    });
    const c = await runQueryData({ mode: "funds", question: "holdings" }, CTX);
    expect(c.ok).toBe(false);
    expect(c.outcome).toBe("clarification_required");
    expect(c.clarification?.blocking_ambiguity).toBe("fund not specified");

    gatewayReturns({
      outcome: "abstention",
      correlation_id: "corr-1",
      abstention: { reason_code: "no_such_fund", explanation: "no match" },
    });
    const a = await runQueryData({ mode: "funds", question: "holdings", scope: { fund: "X" } }, CTX);
    expect(a.outcome).toBe("abstention");
    expect(a.abstention?.reason_code).toBe("no_such_fund");
  });

  it("only forwards allowed scope fields (drops route/sql/unknown)", async () => {
    gatewayReturns({ outcome: "answer", correlation_id: "corr-1" });
    // Smuggle disallowed keys through an untyped scope; the tool must strip them.
    const smuggled = {
      mode: "funds",
      question: "holdings",
      scope: { fund: "PARX", route: "generated_sql", sql: "DELETE FROM funds" },
      constraints: { max_rows: 99999 },
    } as unknown as Parameters<typeof runQueryData>[0];
    await runQueryData(smuggled, CTX);
    const sent = postQuery.mock.calls[0][0] as { scope: Record<string, unknown>; constraints: { max_rows: number } };
    expect(sent.scope).toEqual({ fund: "PARX" });
    expect(sent.constraints.max_rows).toBe(500); // clamped
  });

  it("isolates gateway failure into a safe error result (never throws)", async () => {
    postQuery.mockRejectedValue(new Error("boom"));
    const r = await runQueryData({ mode: "funds", question: "what funds?" }, CTX);
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe("error");
    expect(r.userMessage).toMatch(/unavailable/i);
  });

  it("treats a non-200 response as a safe error", async () => {
    postQuery.mockResolvedValue({ status: 503, body: null });
    const r = await runQueryData({ mode: "funds", question: "what funds?" }, CTX);
    expect(r.outcome).toBe("error");
  });
});
