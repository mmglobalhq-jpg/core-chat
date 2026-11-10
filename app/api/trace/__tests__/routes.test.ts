import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextResponse } from "next/server";

const requireUser = vi.fn();
vi.mock("@/lib/reqUser", () => ({ requireUser: (r: Request) => requireUser(r) }));

const fetchSpy = vi.fn();

function post(path: string, body: unknown): Request {
  return new Request(`https://app${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer t" },
    body: JSON.stringify(body),
  });
}

/** FINRA's envelope: data is a JSON string; Record-Total is a header list. */
function finra(rows: unknown[], total = rows.length): Response {
  return new Response(
    JSON.stringify({
      status: "success",
      returnBody: { data: JSON.stringify(rows), headers: { "Record-Total": [String(total)] } },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}
function tokenResponse(): Response {
  return new Response("{}", { status: 200, headers: { "set-cookie": "XSRF-TOKEN=tok123; Path=/" } });
}

beforeEach(() => {
  vi.resetModules(); // fresh token cache per test
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ user: { id: "u" }, token: "t" });
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => vi.unstubAllGlobals());

const lookupRoute = async () => (await import("@/app/api/trace/lookup/route")).POST;
const tradesRoute = async () => (await import("@/app/api/trace/trades/route")).POST;

describe("auth", () => {
  it("refuses both routes without an approved user, before touching FINRA", async () => {
    requireUser.mockResolvedValue({ error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) });
    expect((await (await lookupRoute())(post("/api/trace/lookup", { cusips: ["31418EBR0"] }))).status).toBe(401);
    expect(
      (await (await tradesRoute())(post("/api/trace/trades", { cusips: ["31418EBR0"], days: ["2026-11-10"] }))).status,
    ).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("POST /api/trace/lookup", () => {
  it("classifies invalid, not-found, non-MBS and MBS CUSIPs", async () => {
    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      if (!init?.method) return tokenResponse();
      const body = JSON.parse(String(init.body));
      const c = body.multiFieldMatchFilters[0].searchValue;
      if (c === "31418EBR0") return finra([{ cusip: c, issueSymbolIdentifier: "FNMA5296004", bondType: "MBS" }]);
      if (c === "037833100") return finra([{ cusip: c, issueSymbolIdentifier: "AAPL", bondType: "CA" }]);
      return finra([]);
    });
    const res = await (await lookupRoute())(
      post("/api/trace/lookup", { cusips: ["31418ebr0", "31418EBR1", "037833100", "3140QNNM0"] }),
    );
    expect(res.status).toBe(200);
    const { results } = await res.json();
    expect(results.map((r: { status: string }) => r.status)).toEqual(["mbs", "invalid", "other", "notfound"]);
    expect(results[0].symbol).toBe("FNMA5296004");
    // The XSRF token is echoed back as header and cookie.
    const call = fetchSpy.mock.calls.find(([, i]) => i?.method === "POST")!;
    expect(call[1].headers["X-XSRF-TOKEN"]).toBe("tok123");
    expect(call[1].headers.Cookie).toBe("XSRF-TOKEN=tok123");
  });

  it("rejects an empty list and more than 100 CUSIPs", async () => {
    const POST = await lookupRoute();
    expect((await POST(post("/api/trace/lookup", { cusips: [] }))).status).toBe(400);
    const many = Array.from({ length: 101 }, (_, i) => `C${i}`);
    expect((await POST(post("/api/trace/lookup", { cusips: many }))).status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns 502 with FINRA's message when FINRA fails", async () => {
    fetchSpy.mockImplementation(async (_u: string, init?: RequestInit) =>
      !init?.method
        ? tokenResponse()
        : new Response(JSON.stringify({ status: "error", statusMessage: "Service unavailable" }), { status: 500 }),
    );
    const res = await (await lookupRoute())(post("/api/trace/lookup", { cusips: ["31418EBR0"] }));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("Service unavailable");
  });
});

describe("POST /api/trace/trades", () => {
  it("asks FINRA one CUSIP-day at a time on the exact CUSIP and tags each trade", async () => {
    const asked: string[] = [];
    fetchSpy.mockImplementation(async (_u: string, init?: RequestInit) => {
      if (!init?.method) return tokenResponse();
      const b = JSON.parse(String(init.body));
      const day = b.dateRangeFilters[0];
      expect(day.startDate).toBe(day.endDate);
      expect(b.compareFilters[0]).toMatchObject({ fieldName: "cusip", compareType: "EQUAL" });
      asked.push(`${b.compareFilters[0].fieldValue}|${day.startDate}`);
      return finra([{ tradeExecutionDate: day.startDate, tradeExecutionTime: "10:00:00", lastSalePrice: 91.3125 }]);
    });
    const res = await (await tradesRoute())(
      post("/api/trace/trades", { cusips: ["31418EBR0"], days: ["2026-11-09", "2026-11-10"] }),
    );
    expect(res.status).toBe(200);
    const { trades } = await res.json();
    expect(asked.sort()).toEqual(["31418EBR0|2026-11-09", "31418EBR0|2026-11-10"]);
    expect(trades).toHaveLength(2);
    expect(trades[0].cusip).toBe("31418EBR0");
  });

  it("pages past FINRA's 5000-row cap", async () => {
    let calls = 0;
    fetchSpy.mockImplementation(async (_u: string, init?: RequestInit) => {
      if (!init?.method) return tokenResponse();
      const { offset } = JSON.parse(String(init.body));
      calls++;
      const n = offset === 0 ? 5000 : 3;
      return finra(Array.from({ length: n }, () => ({ tradeExecutionDate: "2026-11-10" })), 5003);
    });
    const res = await (await tradesRoute())(post("/api/trace/trades", { cusips: ["31418EBR0"], days: ["2026-11-10"] }));
    expect((await res.json()).trades).toHaveLength(5003);
    expect(calls).toBe(2);
  });

  it("refreshes the session once on a 403", async () => {
    let posts = 0;
    fetchSpy.mockImplementation(async (_u: string, init?: RequestInit) => {
      if (!init?.method) return tokenResponse();
      posts++;
      return posts === 1 ? new Response("{}", { status: 403 }) : finra([]);
    });
    const res = await (await tradesRoute())(post("/api/trace/trades", { cusips: ["31418EBR0"], days: ["2026-11-10"] }));
    expect(res.status).toBe(200);
    expect(fetchSpy.mock.calls.filter(([, i]) => !i?.method)).toHaveLength(2);
  });

  it("validates CUSIPs, dates and batch size before calling FINRA", async () => {
    const POST = await tradesRoute();
    const bad = [
      { cusips: ["31418EBR1"], days: ["2026-11-10"] },
      { cusips: ["31418EBR0"], days: ["2026-13-01"] },
      { cusips: ["31418EBR0"], days: [] },
      { cusips: ["31418EBR0"], days: Array.from({ length: 41 }, () => "2026-11-10") },
    ];
    for (const b of bad) expect((await POST(post("/api/trace/trades", b))).status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
