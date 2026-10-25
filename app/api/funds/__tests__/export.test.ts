import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

// The export used to page through a PL/pgSQL row-set RPC 1,000 rows at a time
// (Supabase's max-rows), and PostgREST cannot push LIMIT/OFFSET into such a
// function — every chunk re-ran the whole comparison, plus a probe and a limit
// check. It now makes ONE call to get_fund_position_changes_export_json (migration
// 0011), which returns every row in a single scalar.

const requireUser = vi.fn();
const rpc = vi.fn();

vi.mock("@/lib/reqUser", () => ({ requireUser: (req: Request) => requireUser(req) }));
vi.mock("@/lib/supabaseFunds", () => ({ getSupabaseFunds: () => ({ rpc }) }));

import { GET } from "@/app/api/funds/export/route";

function req(qs: string): Request {
  return new Request(`https://app/api/funds/export?${qs}`, {
    headers: { authorization: "Bearer t" },
  });
}

function row(over: Record<string, unknown>): Record<string, unknown> {
  return {
    fund_manager: "JP Morgan",
    fund_ticker: "JBND",
    security_id: "AAA",
    description: "Some bond",
    security_type: "TREASURY NOTES",
    sector_type: "UST",
    comparison_basis: "PAR",
    position_amount: "123456789.1234567890",
    position_change: "-0.0000000001",
    change_type: "Decreased",
    requested_start_date: "2026-10-22",
    actual_start_date: "2026-10-22",
    requested_end_date: "2026-10-23",
    actual_end_date: "2026-10-23",
    metadata_conflict: false,
    conflict_fields: "",
    conflict_reason: null,
    ...over,
  };
}

async function csv(res: Response): Promise<string[]> {
  return (await res.text()).trimEnd().split("\n");
}

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ user: { id: "u1" }, token: "t" });
});

describe("/api/funds/export", () => {
  it("401s before touching the database", async () => {
    requireUser.mockResolvedValue({
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const res = await GET(req("preset=1D"));
    expect(res.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("makes exactly one RPC call, to the single-pass export", async () => {
    rpc.mockResolvedValue({ data: { total_rows: 1, rows: [row({})] }, error: null });
    const res = await GET(req("preset=1D&manager=JP%20Morgan"));
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = rpc.mock.calls[0];
    expect(fn).toBe("get_fund_position_changes_export_json");
    expect(args).toMatchObject({ p_manager: "JP Morgan", p_lookback: 1, p_max_rows: 100000 });
  });

  it("writes PAR headers and exact decimal strings", async () => {
    rpc.mockResolvedValue({ data: { total_rows: 1, rows: [row({})] }, error: null });
    const lines = await csv(await GET(req("start=2026-10-23&end=2026-10-23")));
    expect(lines[0]).toContain("Par Amount,Par Change,Change Type");
    expect(lines[0]).not.toContain("Comparison Basis");
    expect(lines[1]).toContain(",123456789.1234567890,-0.0000000001,Decreased,");
    expect(lines).toHaveLength(2);
  });

  it("adds a basis column for mixed results, and renders a null sector as Unmapped", async () => {
    rpc.mockResolvedValue({
      data: {
        total_rows: 2,
        rows: [
          row({}),
          row({
            fund_manager: "Allspring",
            fund_ticker: "AS_CORE_PLUS",
            comparison_basis: "MARKET_VALUE",
            sector_type: null,
            security_type: null,
          }),
        ],
      },
      error: null,
    });
    const lines = await csv(await GET(req("preset=30D")));
    expect(lines[0]).toContain("Position Amount,Position Change,Comparison Basis,Change Type");
    expect(lines[1]).toContain(",Par,");
    expect(lines[2]).toContain(",Market Value,");
    expect(lines[2]).toContain("AS_CORE_PLUS,AAA,Some bond,,Unmapped,");
  });

  it("returns a header-only file when nothing changed", async () => {
    rpc.mockResolvedValue({ data: { total_rows: 0, rows: [] }, error: null });
    const lines = await csv(await GET(req("preset=1D")));
    expect(lines).toHaveLength(1);
    expect(lines[0].startsWith("Fund,")).toBe(true);
  });

  it("maps the row-limit refusal to a 400, without writing a partial file", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "export_limit_exceeded: 150000 rows exceed the limit of 100000" },
    });
    const res = await GET(req("preset=1Y"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("export_limit_exceeded");
  });

  it("quotes cells containing commas, quotes or newlines", async () => {
    rpc.mockResolvedValue({
      data: { total_rows: 1, rows: [row({ description: 'FNMA 4%, "A" tranche' })] },
      error: null,
    });
    const lines = await csv(await GET(req("preset=1D")));
    expect(lines[1]).toContain(',"FNMA 4%, ""A"" tranche",');
  });
});
