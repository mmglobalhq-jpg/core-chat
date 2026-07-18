import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

// Mock the auth gate and the server-only poller client wrapper so the route can be
// exercised without a Supabase connection or the browser guard in supabaseFunds.
const requireUser = vi.fn();
const callRpc = vi.fn();

vi.mock("@/lib/reqUser", () => ({ requireUser: (req: Request) => requireUser(req) }));
vi.mock("@/lib/fundsRpc", () => ({
  callRpc: (fn: string, args: Record<string, unknown>) => callRpc(fn, args),
}));

import { GET as changesGET } from "@/app/api/funds/changes/route";
import { GET as optionsGET } from "@/app/api/funds/options/route";
import { GET as filterOptionsGET } from "@/app/api/funds/filter-options/route";

function req(url: string): Request {
  return new Request(url, { headers: { authorization: "Bearer test-token" } });
}

beforeEach(() => {
  requireUser.mockReset();
  callRpc.mockReset();
  requireUser.mockResolvedValue({ user: { id: "u1", email: "x@example.com" }, token: "t" });
});

describe("/api/funds/changes", () => {
  it("returns 401 when unauthenticated (never reaches the RPC)", async () => {
    requireUser.mockResolvedValue({ error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) });
    const res = await changesGET(req("https://app/api/funds/changes?start=2026-06-01&end=2026-06-02"));
    expect(res.status).toBe(401);
    expect(callRpc).not.toHaveBeenCalled();
  });

  it("returns 400 on invalid params before calling the RPC", async () => {
    const res = await changesGET(req("https://app/api/funds/changes?start=2026-06-02&end=2026-06-01"));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("invalid_date_range") });
    expect(callRpc).not.toHaveBeenCalled();
  });

  it("forwards validated args to get_fund_position_changes", async () => {
    callRpc.mockResolvedValue({
      data: { changes: [], fund_status: [], pagination: { page: 1, page_size: 100, total_rows: 0, total_pages: 0 } },
      error: null,
    });
    const res = await changesGET(
      req(
        "https://app/api/funds/changes?manager=JP%20Morgan&fund=JBND&start=2026-06-01&end=2026-06-02&page=2&page_size=250&sort=par_amount&dir=asc&q_security=abc&change_type=Added,Removed",
      ),
    );
    expect(res.status).toBe(200);
    expect(callRpc).toHaveBeenCalledTimes(1);
    const [fn, args] = callRpc.mock.calls[0];
    expect(fn).toBe("get_fund_position_changes");
    expect(args).toMatchObject({
      p_manager: "JP Morgan",
      p_fund: "JBND",
      p_start_date: "2026-06-01",
      p_end_date: "2026-06-02",
      p_page: 2,
      p_page_size: 250,
      p_sort_column: "par_amount",
      p_sort_direction: "asc",
      p_security_id_search: "abc",
      p_change_types: ["Added", "Removed"],
    });
  });

  it("defaults the sort column to the basis-aware position_change", async () => {
    callRpc.mockResolvedValue({
      data: { changes: [], fund_status: [], pagination: { page: 1, page_size: 100, total_rows: 0, total_pages: 0 } },
      error: null,
    });
    await changesGET(req("https://app/api/funds/changes?start=2026-06-01&end=2026-06-02"));
    const [, args] = callRpc.mock.calls[0];
    expect(args).toMatchObject({ p_sort_column: "position_change", p_sort_direction: "desc" });
  });

  it("forwards the __UNMAPPED__ null-sector token verbatim (never a literal 'Unmapped')", async () => {
    callRpc.mockResolvedValue({
      data: { changes: [], fund_status: [], pagination: { page: 1, page_size: 100, total_rows: 0, total_pages: 0 } },
      error: null,
    });
    await changesGET(
      req("https://app/api/funds/changes?start=2026-06-01&end=2026-06-02&f_sector_type=__UNMAPPED__"),
    );
    const [, args] = callRpc.mock.calls[0];
    expect(args.p_sector_type).toBe("__UNMAPPED__");
  });

  it("passes basis-aware RPC fields through to the client untouched (no coercion)", async () => {
    const row = {
      fund_manager: "Allspring",
      fund_ticker: "AS_CORE_PLUS",
      security_id: "123456789",
      description: "Some Bond",
      security_type: null,
      sector_type: null,
      comparison_basis: "MARKET_VALUE",
      position_amount: "1234567890123456789.1234567890",
      position_change: "-98765432109876543.9876543210",
      par_amount: null,
      par_change: null,
      market_value_amount: "1234567890123456789.1234567890",
      market_value_change: "-98765432109876543.9876543210",
      change_type: "Increased",
    };
    callRpc.mockResolvedValue({
      data: {
        changes: [row],
        fund_status: [{ comparison_basis: "MARKET_VALUE", status: "ok" }],
        pagination: { page: 1, page_size: 100, total_rows: 1, total_pages: 1 },
      },
      error: null,
    });
    const res = await changesGET(req("https://app/api/funds/changes?start=2026-06-01&end=2026-06-02"));
    const body = await res.json();
    expect(body.changes[0]).toMatchObject({
      comparison_basis: "MARKET_VALUE",
      position_amount: "1234567890123456789.1234567890", // exact string, not floated
      position_change: "-98765432109876543.9876543210",
      par_amount: null,
    });
  });
});

describe("/api/funds/filter-options", () => {
  it("forwards sector_has_null so the UI can offer the Unmapped filter", async () => {
    callRpc.mockResolvedValue({
      data: { security_types: ["Fixed Rate"], sector_types: ["Corporate"], sector_has_null: true },
      error: null,
    });
    const res = await filterOptionsGET(req("https://app/api/funds/filter-options?manager=Allspring"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      security_types: ["Fixed Rate"],
      sector_types: ["Corporate"],
      sector_has_null: true,
    });
  });
});

describe("/api/funds/options", () => {
  it("shapes managers, funds and latestDate for the UI", async () => {
    callRpc
      .mockResolvedValueOnce({ data: [{ manager: "JP Morgan" }], error: null })
      .mockResolvedValueOnce({ data: [{ ticker: "JBND", fund_manager: "JP Morgan" }], error: null })
      .mockResolvedValueOnce({ data: "2026-06-02", error: null });
    const res = await optionsGET(req("https://app/api/funds/options"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      managers: ["JP Morgan"],
      funds: [{ ticker: "JBND", fund_manager: "JP Morgan" }],
      latestDate: "2026-06-02",
    });
  });
});
