import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import { makeFakeReitsClient, SAMPLE, REPORT_IDS } from "@/lib/__tests__/reitFake";

// Mock the auth gate and the server-only REIT client. The real validators, query
// layer and error mapping still run (only the DB client is faked).
const requireUser = vi.fn();
vi.mock("@/lib/reqUser", () => ({ requireUser: (req: Request) => requireUser(req) }));

const holder = vi.hoisted(() => ({ client: null as unknown, fail: false }));
vi.mock("@/lib/supabaseReits", () => ({
  getSupabaseReits: () => {
    if (holder.fail) throw new Error("Missing REITS_SUPABASE_URL / REITS_SUPABASE_SERVICE_ROLE_KEY");
    return holder.client;
  },
}));

import { GET as issuersGET } from "@/app/api/reits/issuers/route";
import { GET as reportsGET } from "@/app/api/reits/reports/route";
import { GET as reportDetailGET } from "@/app/api/reits/reports/[reportId]/route";

function req(url: string): Request {
  return new Request(url, { headers: { authorization: "Bearer test-token" } });
}

beforeEach(() => {
  requireUser.mockReset();
  requireUser.mockResolvedValue({ user: { id: "u1" }, token: "t" });
  holder.client = makeFakeReitsClient(SAMPLE);
  holder.fail = false;
});

describe("GET /api/reits/issuers", () => {
  it("returns 401 when unauthenticated", async () => {
    requireUser.mockResolvedValue({
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const res = await issuersGET(req("https://app/api/reits/issuers"));
    expect(res.status).toBe(401);
  });

  it("returns the data-driven issuer list (ARR + ORC) with no-store", async () => {
    const res = await issuersGET(req("https://app/api/reits/issuers"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    const symbols = body.issuers.map((i: { symbol: string }) => i.symbol);
    expect(symbols).toContain("ARR");
    expect(symbols).toContain("ORC");
  });

  it("returns a sanitized 502 when the service is misconfigured", async () => {
    holder.fail = true;
    const res = await issuersGET(req("https://app/api/reits/issuers"));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toMatch(/REITS_SUPABASE|service_role|key/i);
  });
});

describe("GET /api/reits/reports", () => {
  it("returns 401 when unauthenticated", async () => {
    requireUser.mockResolvedValue({
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const res = await reportsGET(req("https://app/api/reits/reports?issuer=ARR"));
    expect(res.status).toBe(401);
  });

  it("returns 400 for a malformed issuer symbol", async () => {
    const res = await reportsGET(req("https://app/api/reits/reports?issuer=not%20valid!"));
    expect(res.status).toBe(400);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns completed ARR reports newest first (namespaced ids)", async () => {
    const res = await reportsGET(req("https://app/api/reits/reports?issuer=ARR"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reports.map((r: { id: string }) => r.id)).toEqual([
      REPORT_IDS.ARR_A,
      REPORT_IDS.ARR_B,
    ]);
  });

  it("returns ORC reports with orc: ids", async () => {
    const res = await reportsGET(req("https://app/api/reits/reports?issuer=ORC"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reports.map((r: { id: string }) => r.id)).toEqual([REPORT_IDS.ORC_A]);
  });
});

describe("GET /api/reits/reports/[reportId]", () => {
  function callDetail(reportId: string) {
    return reportDetailGET(
      req(`https://app/api/reits/reports/${encodeURIComponent(reportId)}`),
      { params: Promise.resolve({ reportId }) },
    );
  }

  it("returns 401 when unauthenticated", async () => {
    requireUser.mockResolvedValue({
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const res = await callDetail(REPORT_IDS.ARR_A);
    expect(res.status).toBe(401);
  });

  it("returns 400 for a malformed report id", async () => {
    const res = await callDetail("not-a-uuid");
    expect(res.status).toBe(400);
  });

  it("returns 404 for an unknown / non-current report", async () => {
    const unknown = await callDetail("arr:00000000-0000-4000-8000-000000000000");
    expect(unknown.status).toBe(404);
    const superseded = await callDetail(REPORT_IDS.ARR_SUP);
    expect(superseded.status).toBe(404);
  });

  it("returns the ARR report body with no-store (namespaced id)", async () => {
    const res = await callDetail(REPORT_IDS.ARR_A);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body.report.bodyMarkdown).toContain("# Executive summary");
  });

  it("resolves an orc: id to the ORC report body", async () => {
    const res = await callDetail(REPORT_IDS.ORC_A);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.report.issuerSymbol).toBe("ORC");
    expect(body.report.bodyMarkdown).toBe("# ORC body");
  });

  it("resolves a legacy bare UUID to the ARR report", async () => {
    const res = await callDetail(REPORT_IDS.UUID_A);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.report.issuerSymbol).toBe("ARR");
  });
});
