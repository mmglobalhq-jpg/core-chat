import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const push = vi.fn();
const replace = vi.fn();
let currentParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
  useSearchParams: () => currentParams,
}));

vi.mock("@/lib/supabaseClient", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "tok" } } }) } },
}));

import FundsPage from "@/app/funds/page";
import type { HoldingRow, HoldingsFundStatus, HoldingsResponse } from "@/lib/fundHoldings";

const OPTIONS = {
  managers: ["Allspring", "JP Morgan", "Regan"],
  funds: [
    { ticker: "AS_CORE_PLUS", fund_manager: "Allspring" },
    { ticker: "JMTG", fund_manager: "JP Morgan" },
    { ticker: "JBND", fund_manager: "JP Morgan" },
    { ticker: "MBSX", fund_manager: "Regan" },
  ],
  latestDate: "2026-10-23",
};

function row(over: Partial<HoldingRow>): HoldingRow {
  return {
    fund_manager: "JP Morgan",
    fund_ticker: "JMTG",
    as_of_date: "2026-10-23",
    comparison_basis: "PAR",
    security_id: "SEC0001",
    description: "Treasury Note",
    security_type: "TREASURY NOTES",
    sector_type: "UST",
    position_amount: "1000.0000000000",
    last_change_date: "2026-10-20",
    last_change_kind: "added",
    since_first: false,
    metadata_conflict: false,
    conflict_fields: [],
    conflict_reason: null,
    ...over,
  };
}

function status(over: Partial<HoldingsFundStatus>): HoldingsFundStatus {
  return {
    fund_manager: "JP Morgan",
    fund_ticker: "JMTG",
    comparison_basis: "PAR",
    as_of_date: "2026-10-23",
    holding_count: 1,
    stale: false,
    last_error: null,
    ...over,
  };
}

function response(rows: HoldingRow[], fundStatus: HoldingsFundStatus[]): HoldingsResponse {
  return {
    holdings: rows,
    fund_status: fundStatus,
    pagination: { page: 1, page_size: 100, total_rows: rows.length, total_pages: 1 },
  };
}

const PAR_HOLDINGS = response(
  [
    row({ security_id: "ADD0001", last_change_kind: "added", last_change_date: "2026-10-22" }),
    row({
      fund_ticker: "JBND",
      as_of_date: "2026-10-21",
      security_id: "UP00001",
      description: "Up Bond",
      last_change_kind: "par_increased",
      last_change_date: "2026-10-14",
    }),
    row({
      security_id: "DN00001",
      description: "Down Bond",
      last_change_kind: "par_decreased",
      last_change_date: "2026-10-07",
    }),
    row({
      security_id: "OLD0001",
      description: "Old Bond",
      last_change_kind: null,
      last_change_date: "2026-07-15",
      since_first: true,
    }),
  ],
  [status({ holding_count: 3 }), status({ fund_ticker: "JBND", as_of_date: "2026-10-21" })],
);

const MV_HOLDINGS = response(
  [
    row({
      fund_manager: "Allspring",
      fund_ticker: "AS_CORE_PLUS",
      as_of_date: "2026-09-30",
      comparison_basis: "MARKET_VALUE",
      security_id: "MV00001",
      description: "Corporate Note",
      security_type: "Fixed Rate",
      sector_type: "Corporate",
      position_amount: "5000000.0000000000",
      last_change_date: "2026-08-31",
      last_change_kind: "added",
    }),
  ],
  [
    status({
      fund_manager: "Allspring",
      fund_ticker: "AS_CORE_PLUS",
      comparison_basis: "MARKET_VALUE",
      as_of_date: "2026-09-30",
    }),
  ],
);

const FILTER_OPTIONS = {
  security_types: ["TREASURY NOTES"],
  sector_types: ["UST"],
  sector_has_null: true,
};

const EMPTY_CHANGES = {
  changes: [],
  fund_status: [],
  pagination: { page: 1, page_size: 100, total_rows: 0, total_pages: 0 },
};

function mockFetch(holdings: HoldingsResponse = PAR_HOLDINGS) {
  return vi.fn(async (url: string) => {
    if (url.startsWith("/api/funds/options")) return jsonResponse(OPTIONS);
    if (url.startsWith("/api/funds/latest-date")) return jsonResponse({ latestDate: "2026-10-23" });
    if (url.startsWith("/api/funds/holdings/filter-options")) return jsonResponse(FILTER_OPTIONS);
    if (url.startsWith("/api/funds/holdings/export")) {
      return {
        ok: true,
        status: 200,
        headers: new Headers({
          "Content-Disposition": 'attachment; filename="fund-holdings_2026-10-25.csv"',
        }),
        json: async () => ({}),
        blob: async () => new Blob(["a,b\n"]),
      } as unknown as Response;
    }
    if (url.startsWith("/api/funds/holdings")) return jsonResponse(holdings);
    if (url.startsWith("/api/funds/filter-options")) return jsonResponse(FILTER_OPTIONS);
    if (url.startsWith("/api/funds/changes")) return jsonResponse(EMPTY_CHANGES);
    return jsonResponse({});
  });
}
function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => body,
    blob: async () => new Blob(),
  } as unknown as Response;
}

function calledUrls(f: ReturnType<typeof mockFetch>): string[] {
  return f.mock.calls.map((c) => c[0] as string);
}
function lastUrl(fn: typeof push): URLSearchParams {
  return new URLSearchParams((fn.mock.calls.at(-1)![0] as string).split("?")[1]);
}

beforeEach(() => {
  push.mockReset();
  replace.mockReset();
  currentParams = new URLSearchParams();
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Holdings tab", () => {
  it("renders a Changes | Holdings tab switcher and opens Holdings from tab=holdings", async () => {
    currentParams = new URLSearchParams({ tab: "holdings" });
    vi.stubGlobal("fetch", mockFetch());
    render(<FundsPage />);

    const changesTab = screen.getByRole("tab", { name: "Changes" });
    const holdingsTab = screen.getByRole("tab", { name: "Holdings" });
    expect(holdingsTab).toHaveAttribute("aria-selected", "true");
    expect(changesTab).toHaveAttribute("aria-selected", "false");
    expect(await screen.findByText("ADD0001")).toBeInTheDocument();
  });

  it("holdings load without Submit and without dates", async () => {
    currentParams = new URLSearchParams({ tab: "holdings", manager: "JP Morgan" });
    const f = mockFetch();
    vi.stubGlobal("fetch", f);
    render(<FundsPage />);

    expect(await screen.findByText("ADD0001")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Submit" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Start Date")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("End Date")).not.toBeInTheDocument();

    const urls = calledUrls(f);
    const holdingsCall = urls.find(
      (u) => u.startsWith("/api/funds/holdings?") || u === "/api/funds/holdings",
    );
    expect(holdingsCall).toBeDefined();
    expect(holdingsCall).toContain("manager=JP+Morgan");
    expect(urls.some((u) => u.startsWith("/api/funds/changes"))).toBe(false);
    expect(
      urls.some((u) => u.startsWith("/api/funds/holdings/filter-options") && u.includes("manager=JP+Morgan")),
    ).toBe(true);
  });

  it("renders one ungrouped list with Fund and As of columns and no change column", async () => {
    currentParams = new URLSearchParams({ tab: "holdings" });
    vi.stubGlobal(
      "fetch",
      mockFetch(
        response(
          [...PAR_HOLDINGS.holdings, ...MV_HOLDINGS.holdings],
          [...PAR_HOLDINGS.fund_status, ...MV_HOLDINGS.fund_status],
        ),
      ),
    );
    render(<FundsPage />);
    expect(await screen.findByText("ADD0001")).toBeInTheDocument();

    const header = screen.getAllByRole("columnheader").map((th) => th.textContent ?? "");
    expect(header.slice(0, 3)).toEqual(["Fund", "As of", "CUSIP / Security ID"]);
    for (const h of ["Description", "Security Type", "Sector Type", "Last Change"]) {
      expect(header).toContain(h);
    }
    expect(header).not.toContain("Change Type");
    expect(header.some((h) => /Change$/.test(h) && h !== "Last Change")).toBe(false);
    // Mixed-basis result: Position Amount label plus the Basis column.
    expect(header).toContain("Position Amount");
    expect(header).toContain("Basis");

    // Ungrouped: no collapsible fund group header rows, and no baseline text.
    expect(screen.queryByText(/baseline/)).not.toBeInTheDocument();
    expect(document.querySelector("tbody [aria-expanded]")).toBeNull();

    // As of in DD/MM/YY on every row (each fund's own date).
    expect(screen.getAllByText("23/10/26").length).toBe(3);
    expect(screen.getByText("21/10/26")).toBeInTheDocument();
    expect(screen.getByText("30/09/26")).toBeInTheDocument();

    // Allspring fund shows its friendly name with the share-class aliases as a tooltip.
    const friendly = within(document.querySelector("tbody")!).getByText("Core Plus Bond");
    expect(friendly.closest("[title]")).toHaveAttribute("title", "STYAX / WIPIX / WFIPX");
  });

  it('shows Added / Par ↑ / Par ↓ tags and muted "unchanged since" text', async () => {
    currentParams = new URLSearchParams({ tab: "holdings" });
    vi.stubGlobal("fetch", mockFetch());
    render(<FundsPage />);
    expect(await screen.findByText("ADD0001")).toBeInTheDocument();

    const added = screen.getByText("Added");
    const up = screen.getByText("Par ↑");
    const down = screen.getByText("Par ↓");
    expect(added.className).toMatch(/emerald/);
    expect(up.className).toMatch(/emerald/);
    expect(down.className).toMatch(/red/);
    expect(screen.getByText("22/10/26")).toBeInTheDocument();
    const unchanged = screen.getByText("unchanged since 15/07/26");
    expect(unchanged.className).toMatch(/muted-foreground/);
  });

  it("Changed filter writes changed=7D to the URL and refetches", async () => {
    currentParams = new URLSearchParams({ tab: "holdings", manager: "Regan", h_page: "3" });
    const f = mockFetch();
    vi.stubGlobal("fetch", f);
    const { rerender } = render(<FundsPage />);
    expect(await screen.findByText("ADD0001")).toBeInTheDocument();

    const changed = screen.getByLabelText("Changed") as HTMLSelectElement;
    expect(changed.value).toBe("");
    expect(within(changed).getByRole("option", { name: "Changed: any time" })).toBeInTheDocument();
    fireEvent.change(changed, { target: { value: "7D" } });

    const url = lastUrl(replace);
    expect(url.get("changed")).toBe("7D");
    expect(url.get("h_page")).toBeNull(); // a filter change resets paging
    expect(url.get("manager")).toBe("Regan");
    expect(url.get("tab")).toBe("holdings");

    currentParams = url;
    rerender(<FundsPage />);
    await waitFor(() =>
      expect(
        calledUrls(f).some((u) => u.startsWith("/api/funds/holdings?") && u.includes("changed=7D")),
      ).toBe(true),
    );
  });

  it("CUSIP search is debounced into h_q_security and resets paging", async () => {
    currentParams = new URLSearchParams({ tab: "holdings", h_page: "4" });
    vi.stubGlobal("fetch", mockFetch());
    render(<FundsPage />);
    await screen.findByText("ADD0001");
    // Nothing is written on mount — the URL already matches the (empty) field.
    await new Promise((r) => setTimeout(r, 350));
    expect(replace).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Filter by CUSIP or Security ID"), {
      target: { value: "912" },
    });
    expect(replace).not.toHaveBeenCalled(); // debounced, not per keystroke
    await waitFor(() => expect(replace).toHaveBeenCalled());
    const url = lastUrl(replace);
    expect(url.get("h_q_security")).toBe("912");
    expect(url.get("h_page")).toBeNull();
    expect(url.get("q_security")).toBeNull(); // the Changes filter is untouched
  });

  it("market-value-only results label the amount Market Value and show the disclosure", async () => {
    currentParams = new URLSearchParams({ tab: "holdings", manager: "Allspring" });
    vi.stubGlobal("fetch", mockFetch(MV_HOLDINGS));
    render(<FundsPage />);
    expect(await screen.findByText("MV00001")).toBeInTheDocument();
    const header = screen.getAllByRole("columnheader").map((th) => th.textContent ?? "");
    expect(header).toContain("Market Value");
    expect(header).not.toContain("Basis");
    expect(screen.getByText(/do not necessarily represent purchases or sales/i)).toBeInTheDocument();
    expect(screen.getByText("5,000,000")).toBeInTheDocument();
  });

  it("shows a stale notice for a fund whose last-change data is behind", async () => {
    currentParams = new URLSearchParams({ tab: "holdings" });
    vi.stubGlobal(
      "fetch",
      mockFetch(
        response(PAR_HOLDINGS.holdings, [
          status({ stale: true, last_error: "boom" }),
          status({ fund_ticker: "JBND", stale: false }),
        ]),
      ),
    );
    render(<FundsPage />);
    expect(
      await screen.findByText("JMTG: last-change data is behind its latest snapshot"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/JBND: last-change data/)).not.toBeInTheDocument();
    // The rows are still shown — staleness is surfaced, never used to hide data.
    expect(screen.getByText("ADD0001")).toBeInTheDocument();
  });

  it("marks a metadata-conflict row and shows sector as Conflicting", async () => {
    currentParams = new URLSearchParams({ tab: "holdings" });
    vi.stubGlobal(
      "fetch",
      mockFetch(
        response(
          [
            row({
              security_id: "CONF001",
              sector_type: "Conflicting",
              metadata_conflict: true,
              conflict_fields: ["sector_type"],
              conflict_reason: "Duplicate rows in the latest snapshot disagree on: sector_type",
            }),
          ],
          [status({})],
        ),
      ),
    );
    render(<FundsPage />);
    const cell = (await screen.findByText("Conflicting")).closest("td")!;
    expect(cell.className).toMatch(/amber/);
    expect(
      within(cell).getByLabelText("Duplicate rows in the latest snapshot disagree on: sector_type"),
    ).toBeInTheDocument();
    // The position still has a size on Holdings (only its labels disagree).
    expect(screen.getByText("1,000")).toBeInTheDocument();
  });

  it("switching tabs keeps manager and fund and the Changes query", async () => {
    currentParams = new URLSearchParams("preset=1D&manager=Regan&tab=holdings");
    vi.stubGlobal("fetch", mockFetch());
    render(<FundsPage />);
    await screen.findByText("ADD0001");

    fireEvent.click(screen.getByRole("tab", { name: "Changes" }));
    const url = lastUrl(push);
    expect(url.get("tab")).toBeNull();
    expect(url.get("preset")).toBe("1D");
    expect(url.get("manager")).toBe("Regan");
  });

  it("switching to Holdings sets tab=holdings and leaves the Changes params alone", async () => {
    currentParams = new URLSearchParams("start=2026-10-01&end=2026-10-23&manager=Regan");
    vi.stubGlobal("fetch", mockFetch());
    render(<FundsPage />);
    await screen.findByText(/No position changes found/); // Changes is the default tab
    fireEvent.click(screen.getByRole("tab", { name: "Holdings" }));
    const url = lastUrl(push);
    expect(url.get("tab")).toBe("holdings");
    expect(url.get("start")).toBe("2026-10-01");
    expect(url.get("manager")).toBe("Regan");
  });

  it("a scope change on Holdings writes the URL immediately and resets paging", async () => {
    currentParams = new URLSearchParams({ tab: "holdings", manager: "JP Morgan", fund: "JMTG", h_page: "2" });
    vi.stubGlobal("fetch", mockFetch());
    render(<FundsPage />);
    await screen.findByText("ADD0001");
    await screen.findByRole("option", { name: "Regan" });

    fireEvent.change(screen.getByLabelText("Fund Manager"), { target: { value: "Regan" } });
    const url = lastUrl(replace);
    expect(url.get("manager")).toBe("Regan");
    expect(url.get("fund")).toBeNull(); // a fund belongs to its manager
    expect(url.get("h_page")).toBeNull();
    expect(url.get("tab")).toBe("holdings");
  });

  it("a scope change on Holdings also clears Changes' page and scope-dependent filters", async () => {
    // Otherwise returning to Changes shows "Page 7 / 2" over an empty table that reads
    // as "no changes", or applies a hidden filter from the old scope.
    currentParams = new URLSearchParams({
      tab: "holdings",
      manager: "JP Morgan",
      preset: "1D",
      page: "7",
      f_sector_type: "UST",
      f_security_type: "TREASURY NOTES",
    });
    vi.stubGlobal("fetch", mockFetch());
    render(<FundsPage />);
    await screen.findByText("ADD0001");
    await screen.findByRole("option", { name: "Regan" });

    fireEvent.change(screen.getByLabelText("Fund Manager"), { target: { value: "Regan" } });
    const url = lastUrl(replace);
    expect(url.get("manager")).toBe("Regan");
    expect(url.get("page")).toBeNull();
    expect(url.get("f_sector_type")).toBeNull();
    expect(url.get("f_security_type")).toBeNull();
    expect(url.get("preset")).toBe("1D"); // the Changes comparison itself is kept
  });

  it("submitting a Changes comparison keeps the Holdings query in the URL", async () => {
    currentParams = new URLSearchParams({
      start: "2026-10-01",
      end: "2026-10-23",
      h_sort: "description",
      changed: "7D",
    });
    vi.stubGlobal("fetch", mockFetch());
    render(<FundsPage />);
    await screen.findByText(/No position changes found/);

    fireEvent.click(screen.getByText("Submit"));
    const url = lastUrl(push);
    expect(url.get("start")).toBe("2026-10-01");
    expect(url.get("h_sort")).toBe("description");
    expect(url.get("changed")).toBe("7D");
  });

  it("the header clears the iPhone status bar and has 44pt touch targets on touch", async () => {
    currentParams = new URLSearchParams({ tab: "holdings" });
    vi.stubGlobal("fetch", mockFetch());
    const { container } = render(<FundsPage />);
    await screen.findByText("ADD0001");

    const header = container.querySelector("header")!;
    expect(header.className).toContain("pt-[env(safe-area-inset-top)]");
    expect(screen.getByRole("link", { name: "Back to chat" }).className).toContain(
      "pointer-coarse:size-11",
    );
    expect(screen.getByRole("button", { name: /Export CSV/ }).className).toContain(
      "pointer-coarse:h-11",
    );
    expect(screen.getByRole("button", { name: /Columns/ }).className).toContain(
      "pointer-coarse:h-11",
    );
  });

  it("header clicks re-sort server-side via h_sort / h_dir", async () => {
    currentParams = new URLSearchParams({ tab: "holdings" });
    vi.stubGlobal("fetch", mockFetch());
    render(<FundsPage />);
    await screen.findByText("ADD0001");

    fireEvent.click(screen.getByRole("button", { name: /^Description/ }));
    let url = lastUrl(replace);
    expect(url.get("h_sort")).toBe("description");
    expect(url.get("h_dir")).toBe("asc");

    // Default sort is last_change desc; clicking it flips the direction.
    fireEvent.click(screen.getByRole("button", { name: /^Last Change/ }));
    url = lastUrl(replace);
    expect(url.get("h_dir")).toBe("asc");
    // Changes' own sort params are never touched.
    expect(url.get("sort")).toBeNull();
  });

  it("Export CSV on the Holdings tab downloads from the holdings export route", async () => {
    currentParams = new URLSearchParams({
      tab: "holdings",
      manager: "JP Morgan",
      changed: "30D",
      h_page: "2",
      preset: "1D",
    });
    const f = mockFetch();
    vi.stubGlobal("fetch", f);
    const createObjectURL = vi.fn(() => "blob:x");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    // jsdom cannot navigate; the download anchor's click is all that matters here.
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<FundsPage />);
    await screen.findByText("ADD0001");

    fireEvent.click(screen.getByRole("button", { name: /Export CSV/ }));
    await waitFor(() =>
      expect(calledUrls(f).some((u) => u.startsWith("/api/funds/holdings/export"))).toBe(true),
    );
    const exportUrl = calledUrls(f).find((u) => u.startsWith("/api/funds/holdings/export"))!;
    const p = new URLSearchParams(exportUrl.split("?")[1]);
    expect(p.get("manager")).toBe("JP Morgan");
    expect(p.get("changed")).toBe("30D");
    expect(p.get("h_page")).toBeNull();
    expect(p.get("preset")).toBeNull(); // Changes params never leak into a Holdings request
    expect(calledUrls(f).some((u) => u.startsWith("/api/funds/export"))).toBe(false);
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(createObjectURL).toHaveBeenCalled();
    click.mockRestore();
  });
});
