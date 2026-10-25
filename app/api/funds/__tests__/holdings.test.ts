import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const requireUser = vi.fn();
const rpc = vi.fn();

vi.mock("@/lib/reqUser", () => ({ requireUser: (req: Request) => requireUser(req) }));
vi.mock("@/lib/supabaseFunds", () => ({ getSupabaseFunds: () => ({ rpc }) }));

import { GET as listGET } from "@/app/api/funds/holdings/route";
import { GET as exportGET } from "@/app/api/funds/holdings/export/route";
import { GET as optionsGET } from "@/app/api/funds/holdings/filter-options/route";

function req(path: string, qs = ""): Request {
  return new Request(`https://app/api/funds/${path}?${qs}`, {
    headers: { authorization: "Bearer t" },
  });
}

function row(over: Record<string, unknown>): Record<string, unknown> {
  return {
    fund_manager: "JP Morgan",
    fund_ticker: "JBND",
    as_of_date: "2026-10-23",
    comparison_basis: "PAR",
    security_id: "AAA",
    description: "Some bond",
    security_type: "TREASURY NOTES",
    sector_type: "UST",
    position_amount: "123456789.1234567890",
    last_change_date: "2026-10-20",
    last_change_kind: "par_increased",
    since_first: false,
    metadata_conflict: false,
    conflict_fields: [],
    conflict_reason: null,
    ...over,
  };
}

async function csv(res: Response): Promise<string[]> {
  return (await res.text()).trimEnd().split("\n");
}

const unauthorized = () =>
  requireUser.mockResolvedValue({ error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) });

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ user: { id: "u1" }, token: "t" });
});

describe("auth gate", () => {
  it.each([
    ["holdings", listGET],
    ["holdings/export", exportGET],
    ["holdings/filter-options", optionsGET],
  ])("%s 401s without a session and makes no RPC call", async (path, handler) => {
    unauthorized();
    const res = await handler(req(path));
    expect(res.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("/api/funds/holdings", () => {
  it("forwards validated args with defaults", async () => {
    const payload = { holdings: [], fund_status: [], pagination: { page: 1 } };
    rpc.mockResolvedValue({ data: payload, error: null });
    const res = await listGET(req("holdings", "manager=JP%20Morgan&changed=30D"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(payload);
    const [fn, args] = rpc.mock.calls[0];
    expect(fn).toBe("get_fund_holdings");
    expect(args).toMatchObject({
      p_manager: "JP Morgan",
      p_changed_within: 21,
      p_sort_column: "last_change",
      p_page: 1,
    });
  });

  it("400s on invalid input without calling the database", async () => {
    const res = await listGET(req("holdings", "h_sort=nope"));
    expect(res.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps invalid_changed_within from the RPC to a 400", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "invalid_changed_within: 5" } });
    const res = await listGET(req("holdings"));
    expect(res.status).toBe(400);
  });
});

describe("/api/funds/holdings/filter-options", () => {
  it("forwards manager/fund, treating all as null", async () => {
    const payload = { security_types: ["A"], sector_types: ["UST"], sector_has_null: true };
    rpc.mockResolvedValue({ data: payload, error: null });
    const res = await optionsGET(req("holdings/filter-options", "manager=JP%20Morgan&fund=all"));
    expect(await res.json()).toEqual(payload);
    expect(rpc).toHaveBeenCalledWith("get_fund_holdings_filter_options", {
      p_manager: "JP Morgan",
      p_fund: null,
    });
  });
});

describe("/api/funds/holdings/export", () => {
  it("makes exactly one RPC call and names the file for today", async () => {
    rpc.mockResolvedValue({ data: { total_rows: 1, rows: [row({})] }, error: null });
    const res = await exportGET(req("holdings/export", "manager=JP%20Morgan&changed=7D"));
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = rpc.mock.calls[0];
    expect(fn).toBe("get_fund_holdings_export_json");
    expect(args).toMatchObject({ p_manager: "JP Morgan", p_changed_within: 5, p_max_rows: 100000 });
    const today = new Date().toISOString().slice(0, 10);
    expect(res.headers.get("content-disposition")).toContain(`fund-holdings_${today}.csv`);
    expect(res.headers.get("content-type")).toContain("text/csv");
  });

  it("writes PAR headers, exact decimals and the change columns", async () => {
    rpc.mockResolvedValue({ data: { total_rows: 1, rows: [row({})] }, error: null });
    const lines = await csv(await exportGET(req("holdings/export")));
    expect(lines[0]).toBe(
      "Fund,As Of,CUSIP / Security ID,Description,Security Type,Sector Type,Par Amount,Last Change,Last Change Type,Metadata Conflict,Conflict Fields,Conflict Reason",
    );
    expect(lines[1]).toBe(
      "JBND,2026-10-23,AAA,Some bond,TREASURY NOTES,UST,123456789.1234567890,2026-10-20,Par Increased,false,,",
    );
  });

  it("adds a Comparison Basis column for mixed results; null sector is Unmapped, null type blank", async () => {
    rpc.mockResolvedValue({
      data: {
        total_rows: 2,
        rows: [
          row({}),
          row({
            fund_ticker: "AS_CORE_PLUS",
            comparison_basis: "MARKET_VALUE",
            sector_type: null,
            security_type: null,
            last_change_kind: "added",
          }),
        ],
      },
      error: null,
    });
    const lines = await csv(await exportGET(req("holdings/export")));
    expect(lines[0]).toContain("Position Amount,Comparison Basis,Last Change,");
    expect(lines[1]).toContain(",123456789.1234567890,Par,2026-10-20,Par Increased,");
    expect(lines[2]).toContain("AS_CORE_PLUS,2026-10-23,AAA,Some bond,,Unmapped,");
    expect(lines[2]).toContain(",Market Value,2026-10-20,Added,");
  });

  it("labels since_first rows by basis and handles par decreased / missing data", async () => {
    rpc.mockResolvedValue({
      data: {
        total_rows: 3,
        rows: [
          row({ since_first: true, last_change_kind: null }),
          row({ last_change_kind: "par_decreased", security_id: "BBB" }),
          row({ last_change_date: null, last_change_kind: null, security_id: "CCC" }),
        ],
      },
      error: null,
    });
    const lines = await csv(await exportGET(req("holdings/export")));
    expect(lines[1]).toContain(",2026-10-20,Unchanged since first record,");
    expect(lines[2]).toContain(",Par Decreased,");
    expect(lines[3]).toContain("CCC,Some bond,TREASURY NOTES,UST,123456789.1234567890,,,false");

    rpc.mockResolvedValue({
      data: {
        total_rows: 1,
        rows: [row({ comparison_basis: "MARKET_VALUE", since_first: true, last_change_kind: null })],
      },
      error: null,
    });
    const mv = await csv(await exportGET(req("holdings/export")));
    expect(mv[0]).toContain("Market Value,Last Change");
    expect(mv[1]).toContain("Held since first record");
  });

  it("serialises conflict fields and quotes special cells", async () => {
    rpc.mockResolvedValue({
      data: {
        total_rows: 1,
        rows: [
          row({
            description: 'FNMA 4%, "A"',
            metadata_conflict: true,
            conflict_fields: ["sector_type", "security_type"],
            conflict_reason: "differs",
          }),
        ],
      },
      error: null,
    });
    const lines = await csv(await exportGET(req("holdings/export")));
    expect(lines[1]).toContain('"FNMA 4%, ""A"""');
    expect(lines[1]).toContain(',true,"sector_type, security_type",differs');
  });

  it("maps export_limit_exceeded to a 400", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "export_limit_exceeded: 150000 rows exceed the limit of 100000" },
    });
    const res = await exportGET(req("holdings/export"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("export_limit_exceeded");
  });
});
