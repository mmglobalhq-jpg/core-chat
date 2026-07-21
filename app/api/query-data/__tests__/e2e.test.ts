// @vitest-environment node
//
// End-to-end: the query_data route -> minted service token -> LOCAL gateway ->
// synthetic funds DB. Gated on DIG_E2E=1 with a running local gateway whose
// DIG_SERVICE_TOKEN_SECRET equals DATA_INTELLIGENCE_SIGNING_SECRET below.
import { describe, it, expect, vi } from "vitest";

const requireUser = vi.fn(async (_r: Request) => ({ user: { id: "e2e-user" }, token: "t" }));
vi.mock("@/lib/reqUser", () => ({ requireUser: (r: Request) => requireUser(r) }));

process.env.DATA_INTELLIGENCE_ENABLED = "true";
process.env.DATA_INTELLIGENCE_FUNDS_ENABLED = "true";
process.env.DATA_INTELLIGENCE_GATEWAY_URL ||= "http://127.0.0.1:8088";
process.env.DATA_INTELLIGENCE_SIGNING_SECRET ||= "compose-dev-secret-value-000000000000000";

import { POST } from "@/app/api/query-data/route";

async function call(body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await POST(
    new Request("http://app/api/query-data", {
      method: "POST",
      headers: { authorization: "Bearer chat-jwt", "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

const d = process.env.DIG_E2E === "1" ? describe : describe.skip;

d("query_data e2e against local gateway", () => {
  it("tracked funds -> answer", async () => {
    const { json } = await call({ mode: "funds", question: "what funds are tracked?" });
    expect(json.outcome).toBe("answer");
    expect((json.provenance as { operation: string }).operation).toBe("list_funds");
    expect((json.verification as { status: string }).status).toMatch(/verified|qualified/);
  });

  it("alias resolves -> answer", async () => {
    const { json } = await call({
      mode: "funds",
      question: "resolve this alias",
      scope: { fund: "MVBX" },
    });
    expect(json.outcome).toBe("answer");
  });

  it("latest holdings -> answer with Decimal-as-string", async () => {
    const { json } = await call({
      mode: "funds",
      question: "latest holdings",
      scope: { fund: "PARX", as_of: "2026-06-01" },
    });
    expect(json.outcome).toBe("answer");
    const holdings = (json.structuredData as { holdings: Array<{ security_id: string; position_amount: string }> })
      .holdings;
    const dup = holdings.find((h) => h.security_id === "111111111");
    expect(dup?.position_amount).toBe("1000000000.1234567891");
  });

  it("unavailable comparison -> abstention", async () => {
    const { json } = await call({
      mode: "funds",
      question: "what changed",
      scope: { fund: "ONESNAP", start_date: "2026-06-01", end_date: "2026-07-01" },
    });
    expect(json.outcome).toBe("abstention");
    expect((json.abstention as { reason_code: string }).reason_code).toBe("unavailable_comparison");
  });

  it("ambiguous metric -> one clarification", async () => {
    const { json } = await call({
      mode: "funds",
      question: "how are the funds doing?",
      scope: { fund: "PARX" },
    });
    expect(json.outcome).toBe("clarification_required");
    expect((json.clarification as { blocking_ambiguity: string }).blocking_ambiguity).toBeTruthy();
  });

  it("unknown fund -> no_such_fund", async () => {
    const { json } = await call({
      mode: "funds",
      question: "latest holdings",
      scope: { fund: "NOPE" },
    });
    expect(json.outcome).toBe("abstention");
    expect((json.abstention as { reason_code: string }).reason_code).toBe("no_such_fund");
  });

  it("a write-style question never yields an answer (generated SQL not reachable)", async () => {
    const { json } = await call({ mode: "funds", question: "delete all funds now" });
    expect(json.outcome).not.toBe("answer");
  });

  it("rejects a smuggled generated-SQL/route field at the route (400)", async () => {
    const { status } = await call({
      mode: "funds",
      question: "x",
      route: "generated_sql",
      sql: "DELETE FROM public.funds",
    });
    expect(status).toBe(400);
  });
});
