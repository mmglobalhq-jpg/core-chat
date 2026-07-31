import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextResponse } from "next/server";

const requireUser = vi.fn();
const runQueryData = vi.fn();

vi.mock("@/lib/reqUser", () => ({ requireUser: (req: Request) => requireUser(req) }));
vi.mock("@/lib/dataIntelligence/tool", () => ({
  runQueryData: (...a: unknown[]) => runQueryData(...a),
}));

import { POST } from "@/app/api/query-data/route";

function req(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://app/api/query-data", {
    method: "POST",
    headers: { authorization: "Bearer chat-jwt", "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const KEYS = ["DATA_INTELLIGENCE_ENABLED", "DATA_INTELLIGENCE_FUNDS_ENABLED"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  requireUser.mockReset();
  runQueryData.mockReset();
  requireUser.mockResolvedValue({ user: { id: "verified-user-1" }, token: "t" });
  runQueryData.mockResolvedValue({ ok: true, outcome: "answer", answerText: "hi" });
  for (const k of KEYS) {
    saved[k] = process.env[k];
    process.env[k] = "true";
  }
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("POST /api/query-data", () => {
  it("returns 401 when unauthenticated (never runs the tool)", async () => {
    requireUser.mockResolvedValue({
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const res = await POST(req({ mode: "funds", question: "hi" }));
    expect(res.status).toBe(401);
    expect(runQueryData).not.toHaveBeenCalled();
  });

  it("is a 404 when the feature is disabled (invisible)", async () => {
    process.env.DATA_INTELLIGENCE_FUNDS_ENABLED = "false";
    const res = await POST(req({ mode: "funds", question: "hi" }));
    expect(res.status).toBe(404);
    expect(runQueryData).not.toHaveBeenCalled();
  });

  it("rejects model attempts to set identity/roles/request_id (400)", async () => {
    for (const field of ["roles", "sub", "request_id", "route", "sql"]) {
      const res = await POST(req({ mode: "funds", question: "hi", [field]: "x" }));
      expect(res.status).toBe(400);
    }
    expect(runQueryData).not.toHaveBeenCalled();
  });

  it("rejects non-funds mode (database not exposed)", async () => {
    const res = await POST(req({ mode: "database", question: "hi" }));
    expect(res.status).toBe(400);
  });

  it("passes server-generated context; identity comes from the verified session", async () => {
    const res = await POST(
      req({ mode: "funds", question: "what funds?", conversation_id: "c9", turn_index: 2 }),
    );
    expect(res.status).toBe(200);
    const [input, ctx] = runQueryData.mock.calls[0];
    expect(input.mode).toBe("funds");
    expect(ctx.userSubject).toBe("verified-user-1"); // from requireUser, not body
    expect(ctx.requestId).toBeTruthy(); // server-generated
    expect(ctx.conversationId).toBe("c9");
    expect(ctx.turnIndex).toBe(2);
  });
});
